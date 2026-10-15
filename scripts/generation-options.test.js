import assert from "node:assert/strict";
import test from "node:test";
import { generationPlan, outputProfile, profileImageCount, profileImageSize, referenceImageSize } from "../src/app/generationOptions.js";

test("settings reuse restores the saved workflow when multiple workflows share a model", () => {
  const profiles = [
    { id: "builtin", kind: "image", model: "klein.safetensors", workflow: "family:klein" },
    { id: "custom:reference", kind: "image", model: "klein.safetensors", workflow: "custom:reference" }
  ];
  assert.equal(outputProfile(profiles, { type: "image", model: "klein.safetensors", settings: { profileId: "custom:reference" } }).id, "custom:reference");
  assert.equal(outputProfile(profiles, { type: "image", model: "klein.safetensors", settings: { workflow: "custom:reference" } }).id, "custom:reference");
  assert.equal(outputProfile(profiles, { type: "image", model: "klein.safetensors" }).id, "builtin");
  assert.equal(outputProfile(profiles, { type: "video", model: "klein.safetensors" }), undefined);
});

test("custom image count falls back to its declared constraint on older catalogues", () => {
  const profile = { kind: "image", defaults: {}, constraints: { count: { default: 4 } } };
  assert.equal(profileImageCount(profile, 1), 4);
  assert.equal(profileImageCount({ ...profile, defaults: { count: 2 } }, 1), 2);
  assert.equal(profileImageCount({ ...profile, capabilities: { variations: false } }, 4), 1);
  assert.equal(profileImageCount({ ...profile, kind: "video" }, 4), 1);
});

test("four reference variants become four single-image requests even in batch mode", () => {
  assert.deepEqual(generationPlan({ count: 4, kind: "image", references: [{ assetId: "reference" }], queueMode: "batch" }), { effectiveCount: 4, separate: true, imageRuns: 4, requestCount: 1 });
  assert.deepEqual(generationPlan({ count: 4, kind: "image", queueMode: "batch" }), { effectiveCount: 4, separate: false, imageRuns: 1, requestCount: 4 });
  assert.equal(generationPlan({ count: 4, kind: "image", queueMode: "separate" }).imageRuns, 4);
  assert.equal(generationPlan({ count: 4, kind: "video", references: [{}], queueMode: "separate" }).requestCount, 1);
  assert.equal(generationPlan({ count: 4, kind: "image", profile: { capabilities: { variations: false } }, references: [{}] }).imageRuns, 1);
});

test("photo and video profiles preserve their declared default canvas", () => {
  const profile = {
    kind: "image", defaults: { width: 768, height: 1280 },
    aspectPresets: [{ label: "1:1", w: 1024, h: 1024 }],
    constraints: { width: { min: 64, max: 8192, step: 16 }, height: { min: 64, max: 8192, step: 16 } }
  };
  assert.deepEqual(profileImageSize(profile), { width: 768, height: 1280 });
  assert.deepEqual(profileImageSize({ ...profile, kind: "video", aspectPresets: [{ label: "1:1", w: 640, h: 640 }] }), { width: 768, height: 1280 });
  assert.deepEqual(profileImageSize({ ...profile, aspectPolicy: "fixed" }), { width: 768, height: 1280 });
  assert.deepEqual(profileImageSize({ ...profile, kind: "video", aspectPresets: [], defaults: { width: 864, height: 480 } }), { width: 864, height: 480 });
});

test("a family's named starting aspect wins over its default canvas", () => {
  const profile = {
    kind: "video", defaults: { width: 1344, height: 768 }, aspectDefault: "16:9",
    aspectPresets: [{ label: "16:9", w: 1344, h: 768 }, { label: "1:1", w: 1024, h: 1024 }],
    constraints: { width: { min: 64, max: 8192, step: 32 }, height: { min: 64, max: 8192, step: 32 } }
  };
  assert.deepEqual(profileImageSize(profile), { width: 1344, height: 768 });
  assert.deepEqual(profileImageSize({ ...profile, aspectDefault: "" }), { width: 1344, height: 768 });
});

test("image selection stays within model count limits", () => {
  assert.equal(profileImageCount({ kind: "image", defaults: { count: 4 }, constraints: { count: { min: 1, max: 2 } } }, 4), 2);
  assert.equal(profileImageCount({ kind: "image", defaults: {}, constraints: { count: { default: 4, max: 8 } } }, 1), 4);
});

test('image and video references adopt portrait and landscape proportions at the canvas budget', () => {
  for (const kind of ['image', 'video']) {
    const profile = { kind, defaults: { width: 1024, height: 1024 } };
    for (const reference of [{ width: 900, height: 1600 }, { width: 1600, height: 900 }]) {
      const size = referenceImageSize(profile, reference);
      assert.ok(Math.abs(size.width / size.height - reference.width / reference.height) < 0.015);
      assert.ok(Math.abs(size.width * size.height / (1024 * 1024) - 1) < 0.02);
    }
  }
});

test('reference sizing respects joint limits, alignment and fixed canvases', () => {
  const profile = { defaults: { width: 1024, height: 1024 }, constraints: { width: { min: 64, max: 640, step: 32 }, height: { min: 64, max: 1024, step: 32 } } };
  assert.deepEqual(referenceImageSize(profile, { width: 1600, height: 800 }), { width: 640, height: 320 });
  const fixed = { ...profile, constraints: { width: { min: 512, max: 512 }, height: { min: 512, max: 512 } } };
  assert.deepEqual(referenceImageSize(fixed, { width: 1600, height: 900 }), { width: 512, height: 512 });
  assert.deepEqual(referenceImageSize(profile, { width: 320, height: 640 }, { resize: false }), { width: 320, height: 640 });
  assert.deepEqual(referenceImageSize(profile, { width: 4000, height: 8000 }, { resize: false }), { width: 512, height: 1024 });
});

test('missing reference dimensions leave the canvas alone', () => {
  for (const reference of [null, {}, { width: 0, height: 512 }, { width: Infinity, height: 512 }]) assert.equal(referenceImageSize(null, reference), null);
});
