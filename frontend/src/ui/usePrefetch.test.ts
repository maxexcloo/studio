import assert from "node:assert/strict";
import test from "node:test";

import { retained } from "./usePrefetch.ts";

test("prefetching keeps the wanted images in order, then the most recent others, up to the cap", () => {
  assert.deepEqual(retained([], ["a", "b", "a", "c"], 2), ["a", "b"]);
  assert.deepEqual(retained(["a", "b", "c"], ["c", "d"], 4), ["c", "d", "a", "b"]);
  assert.deepEqual(retained(["a", "b", "c"], [], 2), ["a", "b"]);
});
