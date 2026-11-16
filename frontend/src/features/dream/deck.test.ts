import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { deckCards } from "./deck.ts";
import type { DreamItem } from "./queries";

const items = (...ids: string[]) => ids.map((id) => ({ id, type: "image" }) as MediaItem);
const keys = (cards: ReturnType<typeof deckCards>) => cards.map((card) => card.key);

test("all unseen Dream generations precede calibration, regardless of judged count", () => {
  const dream = items("d1", "d2", "d3", "d4") as DreamItem[];
  const gallery = items("g1", "g2", "g3", "g4");
  assert.deepEqual(keys(deckCards(dream, gallery, 0, { depth: 6 })), [
    "d1",
    "d2",
    "d3",
    "d4",
    "g1",
    "g2",
  ]);
  assert.deepEqual(keys(deckCards(dream.slice(2), gallery, 3, { depth: 3 })), ["d3", "d4", "g1"]);
  assert.deepEqual(keys(deckCards([], gallery, 0, { depth: 5 })), ["g1", "g2", "g3", "g4"]);
});

test("while Dream is off every card compares two gallery images, and Dream's results wait", () => {
  const dream = items("d1") as DreamItem[];
  const gallery = items("g1", "g2", "g3", "g4", "g5");
  assert.deepEqual(keys(deckCards(dream, gallery, 1, { pairsOnly: true })), ["g1+g2", "g3+g4"]);
  // A single image left over makes no card.
  assert.deepEqual(keys(deckCards(dream, items("g1"), 0, { pairsOnly: true })), []);
});

test("media selection filters both pools before pairing, including Dream-off comparisons", () => {
  const images = items("a", "b");
  const videos = items("v1", "v2").map((item) => ({ ...item, type: "video" as const }));
  const mixed = [images[0], videos[0], images[1], videos[1]];
  assert.deepEqual(keys(deckCards([], mixed, 0, { pairsOnly: true })), ["a+b"]);
  const cards = deckCards([], mixed, 0, { pairsOnly: true, media: "video" });
  assert.deepEqual(keys(cards), ["v1+v2"]);
  assert.equal(cards[0].kind === "pair" && cards[0].question, "Which Video?");
  const dream = mixed.map((item, side) => ({
    ...item,
    dream: {
      pair: { id: "pair", side: side < 2 ? 0 : 1, question: "Which?", label: item.id },
    },
  })) as DreamItem[];
  for (const media of ["image", "video"] as const) {
    const [card] = deckCards(dream, [], 0, { media });
    assert.equal(card.kind, "pair");
    if (card.kind === "pair") assert.ok(card.items.every((item) => item.type === media));
  }
});

const dated = (id: string, day: number) =>
  ({
    ...items(id)[0],
    createdAt: `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  }) as DreamItem;
const pair = (id: string, day: number) =>
  [0, 1].map((side) => ({
    ...dated(`${id}-${side}`, day),
    dream: { pair: { id, side, question: "Which?", label: String(side) } },
  })) as DreamItem[];

test("newest generations lead, ties keep server order and comparisons retain A/B order", () => {
  const [a, b] = pair("pair", 15);
  b.createdAt = dated("b", 16).createdAt;
  const dream = [dated("old", 1), b, dated("tie-z", 12), a, dated("tie-a", 12), dated("new", 14)];
  const cards = deckCards(dream, items("g1", "g2"), 3, { depth: 6 });
  assert.deepEqual(keys(cards), ["pair", "new", "tie-z", "tie-a", "old", "g1"]);
  assert.deepEqual(cards[0].kind === "pair" && cards[0].items.map((item) => item.id), [
    "pair-0",
    "pair-1",
  ]);
  assert.deepEqual(keys(deckCards(dream, [], 3, { depth: 6 })), keys(cards).slice(0, -1));
});

test("arrivals wait behind the active Dream or calibration card, then become next", () => {
  const old = dated("old", 1);
  const [current] = deckCards([old], [], 0);
  const arrived = [old, dated("new", 16), dated("middle", 15)];
  assert.deepEqual(keys(deckCards(arrived, items("g"), 0, { current, depth: 4 })), [
    "old",
    "new",
    "middle",
    "g",
  ]);
  assert.deepEqual(keys(deckCards(arrived.slice(1), items("g"), 1)), ["new", "middle", "g"]);
  const gallery = items("g1", "g2", "g3");
  const [calibration] = deckCards([], gallery, 3);
  const next = deckCards(arrived, gallery, 3, { current: calibration, depth: 5 });
  assert.strictEqual(next[0], calibration);
  assert.deepEqual(keys(next), ["g1+g2", "new", "middle", "old", "g3"]);
});

test("Undo restores the exact comparison ahead of arrivals without repeating or splitting it", () => {
  const original = pair("original", 10);
  const [current] = deckCards(original, [], 0);
  const arrivals = [dated("new", 16), ...pair("new-pair", 15)];
  assert.deepEqual(keys(deckCards(arrivals, [], 1)), ["new", "new-pair"]);
  const restored = deckCards([...original, ...arrivals], [], 0, { current });
  assert.strictEqual(restored[0], current);
  assert.deepEqual(keys(restored), ["original", "new", "new-pair"]);
  // An externally removed card and a previous media choice cannot pin the deck.
  assert.deepEqual(keys(deckCards(arrivals, [], 1, { current })), ["new", "new-pair"]);
  assert.deepEqual(deckCards([...original, ...arrivals], [], 0, { current, media: "video" }), []);
});
