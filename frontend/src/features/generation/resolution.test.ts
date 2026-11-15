import assert from "node:assert/strict";
import test from "node:test";

import {
  availableResolutions,
  resolutionApplies,
  selectedResolution,
  withResolution,
} from "../../../../shared/resolution.ts";

const profile = {
  kind: "image",
  native: { "2k": "yes", "4k": "maybe" },
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
  assert.equal(selectedResolution({ ...input, resolutionTier: "4K" }, profile), "1K");
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
