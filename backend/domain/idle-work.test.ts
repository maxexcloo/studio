import assert from "node:assert/strict";
import test from "node:test";

import { type IdleItem, createIdleWork } from "./idle-work.ts";

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

test("whole walks resume after the records the last one passed over, back at the top once a run steps aside", async () => {
  let clock = 1_000_000_000;
  const gallery: IdleItem[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, status: "done" }));
  const done = new Set(["a", "b"]);
  const reads: (string | undefined)[] = [];
  let abort = false;
  const work = createIdleWork({
    name: "Test work",
    enabled: () => true,
    unavailable: async () => "",
    idle: () => true,
    allowed: () => true,
    items: (_since, after) => {
      reads.push(after?.id);
      return gallery.slice(after ? gallery.indexOf(after) + 1 : 0);
    },
    changes: () => 0,
    visible: () => true,
    wanted: (item) => !done.has(item.id!),
    run: async (item): Promise<void> => {
      if (abort) work.interrupt();
      else done.add(item.id!);
    },
    now: () => clock,
  });
  for (const _ of [1, 2]) {
    assert.equal(await work.tick(), "done");
    clock += 10_000;
  }
  assert.deepEqual(reads, [undefined, "b"]);
  abort = true;
  assert.equal(await work.tick(), "yielded");
  clock += 10_000;
  abort = false;
  assert.equal(await work.tick(), "done");
  assert.deepEqual(reads, [undefined, "b", "c", undefined]);
});
