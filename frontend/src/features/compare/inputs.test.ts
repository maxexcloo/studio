import assert from "node:assert/strict";
import test from "node:test";

import type { GenerationInput } from "../../types";
import type { Draft } from "../generation/GenerationProvider";
import { draftVariants, loraInputs, setVariants, strengthInputs, variantLabels } from "./inputs.ts";

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

test("every variant runs on the draft's settings, changing only what is compared", () => {
  const model = (from: GenerationInput, profileId: string) => ({ ...from, profileId, steps: 4 });
  const draft = (changed: Partial<GenerationInput>, compare: object) => ({
    input: { ...input, ...changed },
    references: [],
    compare: compare as never,
  });
  const wide = { width: 1216, height: 832 };
  const seeds = draftVariants(draft(wide, { axis: "Seed", seeds: ["8", "9"] }), model);
  assert.deepEqual(
    seeds.map((variant) => variant.input.seed),
    ["725", "8", "9"],
  );
  for (const variant of seeds)
    assert.deepEqual({ ...variant.input, seed: input.seed }, { ...input, ...wide });
  const prompts = draftVariants(draft({ prompt: "A fox\n\nA bird" }, { axis: "Prompt" }), model);
  assert.deepEqual(
    prompts.map((variant) => variant.input.prompt),
    ["A fox", "A bird"],
  );
  for (const variant of prompts)
    assert.deepEqual({ ...variant.input, prompt: input.prompt }, input);
  const models = draftVariants(draft(wide, { axis: "Model", profileIds: ["other"] }), model);
  assert.deepEqual(
    models.map((variant) => [variant.input.profileId, variant.input.width, variant.input.prompt]),
    [
      ["custom:exact", 1216, "A fox"],
      ["other", 1216, "A fox"],
    ],
  );
});

test("set variants keep only what sets them apart, so later edits reach every one", () => {
  const base: Draft = { input, references: [], sessionId: "", operation: "image" };
  const set = setVariants(base, [
    { input, references: [] },
    { input: { ...input, seed: "9", prompt: "A bird" }, references: [] },
  ]);
  const edited = { ...set, input: { ...set.input, width: 640, steps: 30 } };
  const variants = draftVariants(edited, () => undefined);
  assert.deepEqual(
    variants.map((variant) => [variant.input.seed, variant.input.prompt, variant.input.width]),
    [
      ["725", "A fox", 640],
      ["9", "A bird", 640],
    ],
  );
  assert.ok(variants.every((variant) => variant.input.steps === 30));
  assert.equal(setVariants(base, [{ input, references: [] }]).compare, undefined);
});

test("variant labels show provider resolution enums and native pixel sizes that differ", () => {
  const names = { profile: () => "Same Model", lora: (name: string) => name };
  const values = ["1k", "2k"].map((resolution) => ({
    input: { ...input, resolution },
    references: [],
  }));
  assert.deepEqual(variantLabels(values, names), ["1K", "2K"]);
  assert.deepEqual(
    values.map(({ input }) => input.resolution),
    ["1k", "2k"],
  );
  const native = [1024, 2048].map((size) => ({
    input: { ...input, width: size, height: size },
    references: [],
  }));
  assert.deepEqual(variantLabels(native, names), ["1024×1024", "2048×2048"]);
});
