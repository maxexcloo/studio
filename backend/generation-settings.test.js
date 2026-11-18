import assert from "node:assert/strict";
import test from "node:test";

import { temporaryFolder } from "./fixtures/temporary.js";

process.env.STUDIO_DATA_DIR = temporaryFolder("studio-data-");
const { generationSettings } = await import("./gallery/records.js");

test("a reference that only guided is kept with the run, so a retry runs it the same way", () => {
  const references = [{ slot: "reference", assetId: "a1" }];
  assert.equal(
    generationSettings({ kind: "image", referenceAssets: references, referenceRole: "reference" })
      .referenceRole,
    "reference",
  );
  // Edit is the default, and is what older runs without the field replay as.
  assert.equal(
    generationSettings({ kind: "image", referenceAssets: references, referenceRole: "edit" })
      .referenceRole,
    undefined,
  );
  assert.equal(
    generationSettings({ kind: "image", referenceAssets: [], referenceRole: "reference" })
      .referenceRole,
    undefined,
    "no reference, nothing to say",
  );
});

test("an output keeps its profile's name from when it ran", () => {
  assert.equal(
    generationSettings({
      kind: "image",
      profileId: "custom:image-moss-base",
      profileName: "MOSS Image Base · Fast · 8 Steps",
    }).profileName,
    "MOSS Image Base · Fast · 8 Steps",
  );
  assert.equal(
    generationSettings({ kind: "image", profileId: "custom:image-moss-base" }).profileName,
    undefined,
  );
});
