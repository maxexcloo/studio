import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.COMFY_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { generationSettings } = await import("./gallery-store.js");

test("a reference that only guided is kept with the run, so a retry runs it the same way", () => {
  const references = [{ slot: "reference", assetId: "a1" }];
  assert.equal(generationSettings({ kind: "image", referenceAssets: references, referenceRole: "reference" }).referenceRole, "reference");
  // Edit is the default, and is what older runs without the field replay as.
  assert.equal(generationSettings({ kind: "image", referenceAssets: references, referenceRole: "edit" }).referenceRole, undefined);
  assert.equal(generationSettings({ kind: "image", referenceAssets: [], referenceRole: "reference" }).referenceRole, undefined, "no reference, nothing to say");
});

test("an output keeps its profile's name from when it ran", () => {
  assert.equal(generationSettings({ kind: "image", profileId: "custom:image-moss-base", profileName: "MOSS Image Base · Fast · 8 Steps" }).profileName, "MOSS Image Base · Fast · 8 Steps");
  assert.equal(generationSettings({ kind: "image", profileId: "custom:image-moss-base" }).profileName, undefined);
});
