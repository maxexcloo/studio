import assert from "node:assert/strict";
import test from "node:test";

import { createIdleWork } from "./idle-work.ts";

test("a walk over a large gallery gives the event loop turns, as the server answers meanwhile", async () => {
  // Each item costs a millisecond to read, so the walk holds the event loop unless it yields.
  function* items() {
    for (let index = 0; index < 100; index += 1) {
      const until = performance.now() + 1;
      while (performance.now() < until);
      yield { id: `item-${index}`, status: "done" };
    }
  }
  const work = createIdleWork({
    name: "Test work",
    enabled: () => true,
    unavailable: async () => "",
    idle: () => true,
    allowed: () => true,
    items,
    visible: () => true,
    wanted: () => false,
    run: async () => {},
  });
  let turns = 0;
  let waiting = true;
  const count = () => {
    turns += 1;
    if (waiting) setImmediate(count);
  };
  setImmediate(count);
  const walked = work.tick().finally(() => (waiting = false));
  assert.equal(await walked, "none");
  assert.ok(turns > 3, `other work ran ${turns} times during the walk`);
});

test("after a walk finds nothing, a gallery change reads only recent records until the next whole walk", async () => {
  let clock = 1_000_000_000;
  let changes = 0;
  const reads: (number | undefined)[] = [];
  const work = createIdleWork({
    name: "Test work",
    enabled: () => true,
    unavailable: async () => "",
    idle: () => true,
    allowed: () => true,
    items: (since) => {
      reads.push(since);
      return [{ id: "item", status: "done" }];
    },
    changes: () => changes,
    visible: () => true,
    wanted: () => false,
    run: async () => {},
    now: () => clock,
  });
  assert.equal(await work.tick(), "none");
  assert.equal(await work.tick(), "none");
  assert.deepEqual(reads, [undefined], "nothing changed, so nothing is read");
  changes += 1;
  clock += 60_000;
  assert.equal(await work.tick(), "none");
  assert.deepEqual(reads, [undefined, 1_000_000_000 - 3_600_000]);
  clock += 5 * 60_000;
  assert.equal(await work.tick(), "none");
  assert.deepEqual(reads, [undefined, 1_000_000_000 - 3_600_000, undefined]);
});
