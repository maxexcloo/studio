import assert from "node:assert/strict";
import test from "node:test";

import { retained, savingData } from "./usePrefetch.ts";

test("prefetching keeps the wanted images in order, then the most recent others, up to the cap", () => {
  assert.deepEqual(retained([], ["a", "b", "a", "c"], 2), ["a", "b"]);
  assert.deepEqual(retained(["a", "b", "c"], ["c", "d"], 4), ["c", "d", "a", "b"]);
  assert.deepEqual(retained(["a", "b", "c"], [], 2), ["a", "b"]);
});

test("videos load ahead unless the connection saves data or is 2G", () => {
  assert.equal(savingData(undefined), false);
  assert.equal(savingData({ effectiveType: "4g" }), false);
  assert.equal(savingData({ effectiveType: "4g", saveData: true }), true);
  assert.equal(savingData({ effectiveType: "slow-2g" }), true);
  assert.equal(savingData({ effectiveType: "2g" }), true);
});
