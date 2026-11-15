import assert from "node:assert/strict";
import test from "node:test";

import {
  availableResolutions,
  resolutionApplies,
  selectedResolution,
  withResolution,
} from "../../../../shared/resolution.ts";
import type { GenerationInput, Profile } from "../../types";
import { generationInput } from "./payload.ts";

const profile = {
  kind: "image",
  native: { "2k": "yes", "4k": "maybe" } as const,
  constraints: {
    width: { min: 64, max: 4096, step: 32 },
    height: { min: 64, max: 4096, step: 32 },
  },
};
const input = { kind: "image", width: 1536, height: 864 };

test("only confirmed native tiers within the profile's limits are available", () => {
  assert.deepEqual(availableResolutions(profile, input), ["1K", "2K"]);
  assert.deepEqual(availableResolutions({ ...profile, native: {} }, input), ["1K"]);
  const four = { ...profile, native: { "2k": "yes", "4k": "yes" } };
  assert.deepEqual(availableResolutions(four, input), ["1K", "2K", "4K"]);
  const limited = {
    ...four,
    constraints: { ...four.constraints, width: { min: 64, max: 2304, step: 32 } },
  };
  assert.deepEqual(availableResolutions(limited, input), ["1K", "2K"]);
  assert.deepEqual(availableResolutions(limited, { width: 864, height: 1536 }), ["1K", "2K", "4K"]);
  assert.equal(selectedResolution({ ...input, resolutionTier: "4K" }, profile), undefined);
});

test("native tiers set actual dimensions without adding or replacing explicit upscale settings", () => {
  const sized = withResolution({ ...input, resolutionTier: "2K" }, profile);
  assert.deepEqual([sized.width, sized.height], [2048, 1152]);
  assert.equal("autoUpscale" in sized, false);
  assert.equal("tiledDecode" in sized && sized.tiledDecode, true);
  const autoUpscale = { quality: "high", target: 4096 };
  const explicit = withResolution({ ...input, resolutionTier: "2K", autoUpscale }, profile);
  assert.equal(explicit.autoUpscale, autoUpscale);
  assert.deepEqual(withResolution(sized, profile), sized);
  assert.throws(
    () => withResolution({ ...input, resolutionTier: "4K" }, profile),
    /native resolution.*1K, 2K/,
  );
  const four = withResolution(
    { ...input, resolutionTier: "4K" },
    { ...profile, native: { "4k": "yes" } },
  );
  assert.deepEqual([four.width, four.height], [4096, 2304]);
  assert.equal("autoUpscale" in four, false);
});

test("pixel sizes, references, masks, videos and provider resolutions keep their own sizing", () => {
  const explicit = { ...input, width: 2048, height: 1152 };
  assert.equal(withResolution(explicit, profile), explicit);
  for (const run of [
    { ...input, inpaint: { mask: "painted" } },
    { ...input, kind: "video" },
    { ...input, referenceAssets: [{ assetId: "own-asset" }] },
  ]) {
    const framed = { ...profile, aspectPolicy: "reference" };
    assert.equal(resolutionApplies(run, framed), false);
    assert.deepEqual(availableResolutions(framed, run), []);
    assert.equal(withResolution(run, framed), run);
  }
  const provider = { ...profile, options: { resolutions: ["1k", "2k"] } };
  assert.equal(resolutionApplies(input, provider), false);
  assert.deepEqual(availableResolutions(provider), []);
  assert.deepEqual(availableResolutions({ ...profile, constraints: {} }), []);
  assert.equal(
    resolutionApplies(
      { ...input, referenceAssets: [{}], referenceRole: "reference" },
      {
        ...profile,
        aspectPolicy: "reference",
      },
    ),
    true,
  );
});

const listedProfile: Profile = {
  ...profile,
  id: "image-model",
  label: "Image Model",
  kind: "image",
  model: "model",
  workflow: "workflow",
  family: "image",
  defaults: { width: 2048, height: 2048 },
  capabilities: {},
};
const draft: GenerationInput = {
  ...input,
  kind: "image",
  profileId: listedProfile.id,
  prompt: "A landscape",
  negative: "",
  steps: 20,
  cfg: 5,
  seed: "",
  count: 1,
  denoise: 0.65,
  fps: 24,
  frames: 81,
  loras: [],
  referenceAssets: [],
};

test("generation payload preserves tierless configured defaults and exact draft pixels", () => {
  for (const size of [2048, 3104]) {
    const configured = { ...listedProfile, defaults: { width: size, height: size } };
    const result = generationInput({ ...draft, ...configured.defaults }, configured, []);
    assert.deepEqual([result.width, result.height], [size, size]);
    assert.equal(result.resolutionTier, undefined);
    assert.equal("autoUpscale" in result, false);
  }
  const result = generationInput(draft, listedProfile, []);
  assert.deepEqual([result.width, result.height], [1536, 864]);
  assert.equal(selectedResolution(draft, listedProfile), undefined);
});

test("generation payload applies supported explicit tiers and clears unsupported remembered tiers", () => {
  for (const [tier, size] of [
    ["1K", [1024, 576]],
    ["2K", [2048, 1152]],
  ] as const) {
    const result = generationInput({ ...draft, resolutionTier: tier }, listedProfile, []);
    assert.deepEqual([result.width, result.height], size);
    assert.equal(result.resolutionTier, tier);
    assert.equal("autoUpscale" in result, false);
  }
  const result = generationInput({ ...draft, resolutionTier: "4K" }, listedProfile, []);
  assert.deepEqual([result.width, result.height], [draft.width, draft.height]);
  assert.equal(result.resolutionTier, undefined);
});

test("generation payload retains provider enum sizing despite a remembered pixel tier", () => {
  const provider = {
    ...listedProfile,
    options: { resolutions: ["1k", "2k"] },
    defaults: { resolution: "2k", width: 2048, height: 2048 },
  };
  const result: GenerationInput = generationInput(
    { ...draft, ...provider.defaults, resolutionTier: "1K" },
    provider,
    [],
  );
  assert.equal(result.resolution, "2k");
  assert.deepEqual([result.width, result.height], [2048, 2048]);
  assert.equal(result.resolutionTier, undefined);
});
