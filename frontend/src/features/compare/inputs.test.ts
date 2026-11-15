import assert from "node:assert/strict";
import test from "node:test";

import type { GenerationInput } from "../../types";
import { loraInputs, promptInputs, seedInputs, strengthInputs } from "./inputs.ts";

const input: GenerationInput = {
  kind: "image",
  profileId: "custom:exact",
  profileBackend: "radiance",
  prompt: "A fox",
  negative: "blur",
  width: 1024,
  height: 768,
  steps: 8,
  cfg: 1,
  seed: "725",
  count: 1,
  denoise: 0.65,
  fps: 24,
  frames: 81,
  loras: [{ name: "support.safetensors", strength: 0.7, enabled: true, triggers: false }],
  referenceAssets: [
    { slot: "outfit", assetId: "account-outfit" },
    { slot: "character", assetId: "account-character" },
  ],
};

test("LoRA comparisons add candidates to an existing stack without changing its settings or references", () => {
  const variants = loraInputs(
    input,
    [
      { name: "first.safetensors", strength: 0.8 },
      { name: "second.safetensors", strength: 1.2 },
    ],
    true,
  );
  assert.equal(variants.length, 3);
  assert.deepEqual(variants[0], input);
  for (const variant of variants) {
    assert.deepEqual({ ...variant, loras: input.loras }, input);
    assert.equal(variant.loras[0], input.loras[0]);
  }
  assert.deepEqual(
    variants.slice(1).map((variant) => variant.loras[1].name),
    ["first.safetensors", "second.safetensors"],
  );
  assert.deepEqual(
    input.loras.map((lora) => lora.name),
    ["support.safetensors"],
  );
});

test("strength comparisons can choose an unpicked LoRA and keep another LoRA's trigger choices", () => {
  const variants = strengthInputs(input, "new.safetensors", [0, 0.6, 1]);
  assert.deepEqual(variants[0], input);
  assert.deepEqual(
    variants.slice(1).map((variant) => variant.loras[1]),
    [
      { name: "new.safetensors", strength: 0.6, enabled: true, triggers: true },
      { name: "new.safetensors", strength: 1, enabled: true, triggers: true },
    ],
  );
  const own = strengthInputs(input, "support.safetensors", [0, 1.2]);
  assert.deepEqual(own[0].loras, []);
  assert.equal(own[1].loras[0].triggers, false);
  for (const variant of variants) assert.deepEqual({ ...variant, loras: input.loras }, input);
});

test("seed and prompt comparisons preserve every setting outside their selected axis", () => {
  const seeds = seedInputs(input, 3);
  assert.equal(seeds[0].seed, input.seed);
  for (const variant of seeds) assert.deepEqual({ ...variant, seed: input.seed }, input);
  const prompts = promptInputs({ ...input, prompt: "A fox\n\nA bird" });
  assert.deepEqual(
    prompts.map((variant) => variant.prompt),
    ["A fox", "A bird"],
  );
  for (const variant of prompts) assert.deepEqual({ ...variant, prompt: input.prompt }, input);
});
