import assert from "node:assert/strict";
import test from "node:test";

import { type LikeLedger, ageRanges, cooldown, spreadOrder, weight } from "./like-spread.ts";

const day = 86_400_000;
const now = Date.parse("2026-11-24T00:00:00Z");
const made = (id: string, daysAgo: number) => ({
  id,
  createdAt: new Date(now - daysAgo * day).toISOString(),
});
const ledger = (items: LikeLedger["items"] = {}, turns: LikeLedger["turns"] = {}): LikeLedger => ({
  turns,
  items,
});
/** Draws evenly across the range, so a weight's share of draws is its share of the total. */
const sweep = (steps: number) => {
  let step = 0;
  return (size: number) => Math.floor(((step++ % steps) + 0.5) * (size / steps));
};

test("Draws favour liked items used less often", () => {
  const items = [made("used", 1), made("fresh", 1)];
  const used = ledger({ used: { prompt: { uses: 3, last: now - 30 * day } } });
  const random = sweep(100);
  const firsts = Array.from(
    { length: 100 },
    () => spreadOrder(items, used, "prompt", now, random)[0].id,
  );
  assert.equal(firsts.filter((id) => id === "fresh").length, 80);
  assert.equal(weight(used.items.used.prompt, now), 0.25);
});

test("A recent use cools an item for its purpose only", () => {
  const recent = { uses: 1, last: now - day };
  assert.equal(weight(recent, now), cooldown.factor / 2);
  assert.equal(weight(recent, now + cooldown.ms), 0.5);
  const items = [made("cooling", 1), made("other", 1)];
  const cooling = ledger({ cooling: { prompt: recent } });
  // A draw 3% into the weights: past the cooled item's small share, within an unused one's.
  const early = (size: number) => Math.floor(size * 0.03);
  assert.equal(spreadOrder(items, cooling, "prompt", now, early)[0].id, "other");
  assert.equal(spreadOrder(items, cooling, "seed", now, early)[0].id, "cooling");
});

test("Age buckets take turns, so old favourites resurface among many recent likes", () => {
  const items = [
    ...Array.from({ length: 6 }, (_, index) => made(`week-${index}`, 1)),
    made("month", 20),
    made("half-year", 100),
    made("old", 400),
  ];
  const order = spreadOrder(items, ledger(), "prompt", now, () => 0).map(({ id }) => id);
  assert.deepEqual(order.slice(0, 4), ["week-0", "month", "half-year", "old"]);
  const turned = spreadOrder(items, ledger({}, { prompt: 3 }), "prompt", now, () => 0);
  assert.equal(turned[0].id, "old");
});

test("Age ranges cover every age without overlap", () => {
  const ranges = ageRanges(now);
  assert.deepEqual(ranges[0], { since: now - 7 * day });
  assert.deepEqual(ranges[1], { since: now - 30 * day, before: now - 7 * day - 1 });
  assert.deepEqual(ranges.at(-1), { before: now - 182 * day - 1 });
});
