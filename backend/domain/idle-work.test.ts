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
