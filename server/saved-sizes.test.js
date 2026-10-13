import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-sizes-"));
const { cleanSize, loadSavedSizes, saveSavedSizes } = await import("./saved-sizes.js");

test("a saved size needs an id, a name and sides a model could draw", () => {
  assert.deepEqual(cleanSize({ id: "a", name: "  Poster  ", width: 800.4, height: 1408 }), { id: "a", name: "Poster", width: 800, height: 1408 });
  assert.equal(cleanSize({ id: "a", name: "", width: 800, height: 800 }), null);
  assert.equal(cleanSize({ id: "a", name: "Huge", width: 20000, height: 800 }), null);
  assert.equal(cleanSize({ name: "No id", width: 800, height: 800 }), null);
});

test("the list keeps its order, one per id, and survives a reload", () => {
  const saved = saveSavedSizes([
    { id: "b", name: "Wide", width: 1920, height: 1088 },
    { id: "a", name: "Tall", width: 800, height: 1408 },
    { id: "b", name: "Wide again", width: 1024, height: 512 },
    { id: "c", name: "Broken", width: 0, height: 0 }
  ]);
  assert.deepEqual(saved.map((item) => item.name), ["Wide", "Tall"]);
  assert.deepEqual(loadSavedSizes(), saved);
});
