import assert from "node:assert/strict";
import test from "node:test";
import { isInside, pathKey, samePath } from "./paths.js";

test("POSIX paths keep their case", () => {
  assert.equal(isInside("/", "/x.png"), true);
  assert.equal(isInside("/data/out", "/data/out"), false);
  assert.equal(isInside("/data/out", "/data/out", { orSame: true }), true);
  assert.equal(samePath("/data/./out", "/data/out"), true);
  assert.equal(pathKey("/data/./out"), "/data/out");
  assert.equal(isInside("/data/Out", "/data/out/x.png"), false);
  assert.equal(isInside("/data/out", "/data/out/sub/x.png"), true);
  assert.equal(isInside("/data/out", "/data/outside/x.png"), false);
});
