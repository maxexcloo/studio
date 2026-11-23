import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { deckCards, deckPrefetch } from "./deck.ts";
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

test("a Dream set takes one card and opens on the first available result", () => {
  const result = (index: number, day: number) => ({
    ...dated(`result-${index}`, day),
    dream: { prompt: "", why: "", at: "", state: "unseen" as const },
    resultSet: { id: "night-out", title: "Night Out", index, source: "dream" },
  });
  const dream = [result(3, 10), dated("single", 12), result(1, 15), result(2, 14)];
  const [set, single] = deckCards(dream);
  assert.equal(set.kind, "set");
  assert.equal(single.key, "single");
  if (set.kind !== "set") return;
  assert.equal(set.item.id, "result-1");
  assert.deepEqual(
    set.items.map((item) => item.id),
    ["result-1", "result-2", "result-3"],
  );
});

test("only complete three-way comparisons group, in side order", () => {
  const triple = ([2, 0, 1] as const).map((side) => ({
    ...dated(`test-${side}`, 12),
    dream: {
      prompt: "",
      why: "",
      at: "",
      state: "unseen" as const,
      pair: { id: "test", size: 3 as const, side, question: "Which?", label: String(side) },
    },
  }));
  const [card] = deckCards(triple);
  assert.equal(card.kind, "pair");
  assert.deepEqual(card.kind === "pair" && card.items.map(({ id }) => id), [
    "test-0",
    "test-1",
    "test-2",
  ]);
  assert.deepEqual(keys(deckCards(triple.slice(1))), ["test-0", "test-1"]);
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

test("the deck loads the next cards' pictures ahead and the next two videos", () => {
  const image = (id: string) =>
    ({ id, type: "image", url: `/${id}.png`, thumbnailUrl: `/${id}.jpg` }) as DreamItem;
  const video = (id: string) =>
    ({ id, type: "video", url: `/${id}.mp4`, thumbnailUrl: `/${id}.jpg` }) as DreamItem;
  const cards = [image("top"), video("v1"), image("b"), video("v2"), video("v3")].map((item) => ({
    kind: "dream" as const,
    key: item.id,
    item,
  }));
  assert.deepEqual(deckPrefetch(cards), {
    images: ["/v1.jpg", "/b.png", "/v2.jpg", "/v3.jpg"],
    videos: ["/v1.mp4", "/v2.mp4"],
  });
});
