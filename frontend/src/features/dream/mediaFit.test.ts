import assert from "node:assert/strict";
import test from "node:test";

import { besideFits, covers } from "./mediaFit.ts";

test("media fills its box only where at most about 15% is cropped", () => {
  assert.equal(covers(832 / 1216, 0.8), true);
  assert.equal(covers(1, 430 / 932), false);
  assert.equal(covers(1216 / 832, 1), false);
});

test("a comparison's sides sit side by side when that wastes less room", () => {
  assert.equal(besideFits(832 / 1216, 1.6), true);
  assert.equal(besideFits(1216 / 832, 0.7), false);
});
