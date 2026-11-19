import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { deckCards } from "./deck.ts";
import type { DreamItem } from "./queries";

const items = (...ids: string[]) => ids.map((id) => ({ id, type: "image" }) as MediaItem);
const keys = (cards: ReturnType<typeof deckCards>) => cards.map((card) => card.key);

test("media selection filters Dream before grouping comparisons", () => {
  const images = items("a", "b");
  const videos = items("v1", "v2").map((item) => ({ ...item, type: "video" as const }));
  const mixed = [images[0], videos[0], images[1], videos[1]];
  const dream = mixed.map((item, side) => ({
    ...item,
    dream: {
      pair: { id: "pair", side: side < 2 ? 0 : 1, question: "Which?", label: item.id },
    },
  })) as DreamItem[];
  for (const media of ["image", "video"] as const) {
    const [card] = deckCards(dream, { media });
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
  const cards = deckCards(dream, { depth: 6 });
  assert.deepEqual(keys(cards), ["pair", "new", "tie-z", "tie-a", "old"]);
  assert.deepEqual(cards[0].kind === "pair" && cards[0].items.map((item) => item.id), [
    "pair-0",
    "pair-1",
  ]);
});

test("arrivals wait behind the active Dream card, then become next", () => {
  const old = dated("old", 1);
  const [current] = deckCards([old]);
  const arrived = [old, dated("new", 16), dated("middle", 15)];
  assert.deepEqual(keys(deckCards(arrived, { current })), ["old", "new", "middle"]);
  assert.deepEqual(keys(deckCards(arrived.slice(1))), ["new", "middle"]);
});

test("Undo restores the exact comparison ahead of arrivals without repeating or splitting it", () => {
  const original = pair("original", 10);
  const [current] = deckCards(original);
  const arrivals = [dated("new", 16), ...pair("new-pair", 15)];
  assert.deepEqual(keys(deckCards(arrivals)), ["new", "new-pair"]);
  const restored = deckCards([...original, ...arrivals], { current });
  assert.strictEqual(restored[0], current);
  assert.deepEqual(keys(restored), ["original", "new", "new-pair"]);
  // An externally removed card and a previous media choice cannot pin the deck.
  assert.deepEqual(keys(deckCards(arrivals, { current })), ["new", "new-pair"]);
  assert.deepEqual(deckCards([...original, ...arrivals], { current, media: "video" }), []);
});
