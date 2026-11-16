import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../../types";
import { deckCards } from "./deck.ts";
import type { DreamItem } from "./queries";

const items = (...ids: string[]) => ids.map((id) => ({ id, type: "image" }) as MediaItem);
const keys = (cards: ReturnType<typeof deckCards>) => cards.map((card) => card.key);

test("every fourth card compares two gallery images, between Dream's results or the gallery's", () => {
  const dream = items("d1", "d2", "d3", "d4") as DreamItem[];
  const gallery = items("g1", "g2", "g3", "g4");
  assert.deepEqual(keys(deckCards(dream, gallery, 0, { depth: 6 })), [
    "d1",
    "d2",
    "d3",
    "g1+g2",
    "d4",
    "g3",
  ]);
  // Counting from what was judged keeps the order as cards leave.
  assert.deepEqual(keys(deckCards(dream.slice(2), gallery, 2, { depth: 3 })), [
    "d3",
    "g1+g2",
    "d4",
  ]);
  assert.deepEqual(keys(deckCards([], gallery, 0, { depth: 5 })), ["g1", "g2", "g3", "g4"]);
  // Without two gallery images, Dream's results carry on.
  assert.deepEqual(keys(deckCards(dream, items("g1"), 3, { depth: 2 })), ["d1", "d2"]);
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
