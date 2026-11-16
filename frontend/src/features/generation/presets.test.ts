import assert from "node:assert/strict";
import test from "node:test";

import type { GenerationInput } from "../../types";
import { type Preset, loadPresetInput, presetReplacesUnsaved } from "./presets.ts";

const defaults: GenerationInput = {
  kind: "image",
  profileId: "default-image",
  model: "default.safetensors",
  prompt: "",
  negative: "",
  width: 1024,
  height: 1024,
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
const full: Preset = { id: "full", title: "Full", input: { ...defaults, prompt: "A copper bird" } };
const promptOnly: Preset = {
  id: "prompt",
  title: "Prompt",
  parts: ["prompt"],
  input: { prompt: "A copper bird" } as GenerationInput,
};
const load = (preset: Preset, current: GenerationInput) => ({
  ...defaults,
  ...loadPresetInput(preset, current),
});

test("blank-positive drafts confirm when a full preset overwrites any unsaved content or controls", () => {
  const changes: Partial<GenerationInput>[] = [
    { steps: 40 },
    { seed: "42" },
    { profileId: "chosen-image", model: "chosen.safetensors" },
    { width: 1536 },
    { negative: "haze" },
    { referenceAssets: [{ assetId: "own-image", slot: "image", strength: 0.7 }] },
    { loras: [{ name: "detail.safetensors", strength: 0.7, enabled: true }] },
  ];
  for (const change of changes) {
    const current = { ...defaults, ...change };
    assert.equal(
      presetReplacesUnsaved(current, load(full, current), defaults),
      true,
      JSON.stringify(change),
    );
    assert.equal(
      presetReplacesUnsaved(current, load(promptOnly, current), defaults),
      false,
      "a prompt-only load preserves the changed controls/references",
    );
  }
  assert.equal(
    presetReplacesUnsaved(defaults, load(full, defaults), defaults),
    false,
    "an untouched draft needs no confirmation",
  );
});

test("confirmation follows actual overwritten fields, including omitted full-preset fields", () => {
  const current = {
    ...defaults,
    seed: "42",
    negative: "haze",
    referenceAssets: [{ assetId: "own-image", slot: "image" }],
  };
  const sameSeed: Preset = {
    id: "seed",
    title: "Seed",
    parts: ["settings"],
    input: { seed: "42" } as GenerationInput,
  };
  const otherSeed = { ...sameSeed, input: { seed: "7" } as GenerationInput };
  assert.equal(presetReplacesUnsaved(current, load(sameSeed, current), defaults), false);
  assert.equal(presetReplacesUnsaved(current, load(otherSeed, current), defaults), true);
  const stepsOnly = { ...sameSeed, input: { steps: 30 } as GenerationInput };
  assert.equal(
    presetReplacesUnsaved(current, load(stepsOnly, current), defaults),
    false,
    "declaring Settings does not overwrite an absent seed field",
  );
  const sparseFull = { ...full, input: { prompt: "A bird" } as GenerationInput };
  assert.equal(
    presetReplacesUnsaved(current, load(sparseFull, current), defaults),
    true,
    "a full preset clears omitted fields through input defaults",
  );
  assert.deepEqual(load(promptOnly, current).referenceAssets, current.referenceAssets);
});

test("saved values are safe to replace, while edits outside a partial saved preset remain unsaved", () => {
  const saved: Preset = { ...full, input: { ...defaults, seed: "42", negative: "haze" } };
  assert.equal(presetReplacesUnsaved(saved.input, load(full, saved.input), defaults, saved), false);
  const edited = { ...saved.input, seed: "99" };
  assert.equal(presetReplacesUnsaved(edited, load(full, edited), defaults, saved), true);
  assert.equal(presetReplacesUnsaved(edited, load(promptOnly, edited), defaults, saved), false);
  const partialSaved: Preset = {
    ...promptOnly,
    input: { prompt: "A saved owl" } as GenerationInput,
  };
  const current = { ...defaults, ...partialSaved.input, negative: "haze" };
  assert.equal(
    presetReplacesUnsaved(current, load(promptOnly, current), defaults, partialSaved),
    false,
  );
  assert.equal(presetReplacesUnsaved(current, load(full, current), defaults, partialSaved), true);
});

test("display metadata changes do not count as overwritten work", () => {
  const current = { ...defaults, profileName: "Renamed Model", referenceDetails: [] };
  assert.equal(presetReplacesUnsaved(current, load(full, current), defaults), false);
});
