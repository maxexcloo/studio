import assert from "node:assert/strict";
import test from "node:test";

import { wordDiff } from "./wordDiff.ts";

test("a brief edit's diff marks only the words removed and added", () => {
  assert.deepEqual(wordDiff("film grain, cold light", "film grain, warm dusk light"), [
    { text: "film grain, " },
    { text: "cold ", change: "removed" },
    { text: "warm dusk ", change: "added" },
    { text: "light" },
  ]);
  assert.deepEqual(wordDiff("", "seabirds"), [{ text: "seabirds", change: "added" }]);
  assert.deepEqual(wordDiff("gulls", ""), [{ text: "gulls", change: "removed" }]);
});
