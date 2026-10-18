import assert from "node:assert/strict";
import test from "node:test";
import { clampProfileCount, generationPlan, outputProfile, profileCountRange, profileImageCount, profileImageSize, referenceImageSize } from "../src/app/generationOptions.js";

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

test("Civitai reuse matches the downloaded source model rather than an unrelated default workflow", () => {
  const profiles = [
    { id: 'unrelated', kind: 'image', model: 'other.safetensors', defaults: {} },
    { id: 'source-workflow', kind: 'image', model: 'custom:source', defaults: { model: 'source.safetensors' } }
  ];
  const item = { type: 'image', settings: { workflow: '', profileId: '' }, civitai: { resources: [{ folder: 'checkpoints', file: 'source.safetensors', status: 'missing' }] } };
  assert.equal(outputProfile(profiles, item).id, 'source-workflow');
  assert.equal(outputProfile(profiles.slice(0, 1), item), undefined);
  assert.equal(outputProfile(profiles, { ...item, civitai: { resources: [{ ...item.civitai.resources[0], status: 'conflict' }] } }), undefined);
});

test("image defaults use the selected preference rather than a workflow batch default", () => {
  const profile = { kind: "image", defaults: {}, constraints: { count: { default: 4 } } };
  assert.equal(profileImageCount(profile), 2);
  assert.equal(profileImageCount({ ...profile, defaults: { count: 2 } }), 2);
  assert.equal(profileImageCount(profile, 1), 1, "an explicit preferred count is retained");
  assert.equal(profileImageCount({ ...profile, capabilities: { variations: false } }, 4), 1);
  assert.equal(profileImageCount({ ...profile, kind: "video" }, 4), 4);
});

test("four reference variants become four single-image requests even in batch mode", () => {
  assert.deepEqual(generationPlan({ count: 4, kind: "image", references: [{ assetId: "reference" }], queueMode: "batch" }), { effectiveCount: 4, separate: true, imageRuns: 4, requestCount: 1 });
  assert.deepEqual(generationPlan({ count: 4, kind: "image", queueMode: "batch" }), { effectiveCount: 4, separate: false, imageRuns: 1, requestCount: 4 });
  assert.equal(generationPlan({ count: 4, kind: "image", queueMode: "separate" }).imageRuns, 4);
  assert.deepEqual(generationPlan({ count: 4, kind: "video", profile: { capabilities: { variations: false }, constraints: { count: { max: 1 } } }, references: [{}], queueMode: "batch" }), { effectiveCount: 4, separate: true, imageRuns: 4, requestCount: 1 });
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
  assert.equal(profileImageCount({ kind: "image", defaults: {}, constraints: { count: { default: 1, max: 8 } } }), 2);
});

test('count controls and payload planning honour model batch limits and alignment', () => {
  const profile = { kind: 'image', constraints: { count: { min: 2, max: 6, step: 2 } } };
  assert.deepEqual(profileCountRange(profile), { min: 2, max: 6, step: 2, offset: 0 });
  assert.equal(clampProfileCount(profile, 3), 4);
  assert.equal(clampProfileCount(profile, 12), 6);
  assert.deepEqual(generationPlan({ kind: 'image', count: 4, profile, queueMode: 'separate', references: [{}] }), { effectiveCount: 4, separate: false, imageRuns: 1, requestCount: 4 });
  assert.equal(generationPlan({ kind: 'image', count: 4, profile: { constraints: { count: { max: 2 } } } }).requestCount, 2);
  assert.deepEqual(profileCountRange({ kind: 'video', capabilities: { variations: false } }), { min: 1, max: 8, step: 1 });
  assert.equal(profileImageCount({ kind: 'video' }, 4), 4);
  assert.equal(clampProfileCount({ kind: 'video' }, Infinity), 8);
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


test('typed and restored dimensions follow the selected model stride and bounds', async () => {
  const { imageDimension } = await import('../src/app/generationOptions.js');
  for (const [value, metadata, expected] of [
    [880, {min: 64, max: 2048, step: 32}, 896],
    [1184, {min: 64, max: 2048, step: 32}, 1184],
    [880, {min: 64, max: 2048, step: 16}, 880],
    [65, {min: 64, max: 2048, step: 32}, 64],
    [2200, {min: 64, max: 2048, step: 32}, 2048],
  ]) assert.equal(imageDimension(value, metadata), expected);
});
