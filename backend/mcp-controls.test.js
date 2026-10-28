import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdjustable,
  cfgIgnoresNegative,
  mcpControls,
  mcpLoras,
  prepareLoras,
  resolveLoraName,
} from "./mcp-controls.js";

const profile = {
  id: "image:sdxl",
  label: "SDXL",
  kind: "image",
  family: "sdxl",
  workflow: "family:sdxl",
  capabilities: {
    negativePrompt: true,
    cfg: true,
    steps: true,
    seed: true,
    sampler: true,
    scheduler: true,
    lora: true,
  },
  constraints: {
    width: { min: 256, max: 4096 },
    height: { min: 256, max: 4096 },
    steps: { min: 1, max: 150 },
    cfg: { min: 0, max: 30 },
  },
  defaults: { width: 1024, height: 1024, steps: 25, cfg: 7, sampler: "euler", scheduler: "karras" },
  options: {
    samplers: ["euler", "dpmpp_2m"],
    schedulers: ["karras", "normal"],
    loras: ["style.safetensors"],
  },
  mediaInputs: [],
};

test("adjustable controls omit fixed, single-option and unsupported Generate arguments", () => {
  const controls = mcpControls(profile);
  assert.deepEqual(Object.keys(controls), [
    "width",
    "height",
    "count",
    "seed",
    "steps",
    "cfg",
    "negative_prompt",
    "sampler",
    "scheduler",
    "loras",
    "upscale_quality",
    "face_detail",
  ]);
  const turbo = mcpControls({
    ...profile,
    capabilities: { ...profile.capabilities, negativePrompt: true, sampler: false },
    constraints: { ...profile.constraints, steps: { min: 8, max: 8 }, cfg: { min: 1, max: 1 } },
    defaults: { ...profile.defaults, steps: 8, cfg: 1 },
    options: { ...profile.options, schedulers: ["simple"], loras: [] },
  });
  for (const key of ["steps", "cfg", "negative_prompt", "sampler", "scheduler", "loras"])
    assert.equal(turbo[key], undefined, key);
  assert.equal(mcpControls({ ...profile, kind: "video" }).upscale_quality, undefined);
});

test("negative prompts are refused with an explanation where CFG 1 ignores them", () => {
  assert.equal(cfgIgnoresNegative(1), true);
  assert.equal(cfgIgnoresNegative(0), false);
  assert.doesNotThrow(() => assertAdjustable(profile, { negative_prompt: "blurry" }));
  assert.throws(
    () =>
      assertAdjustable(
        { ...profile, defaults: { ...profile.defaults, cfg: 1 } },
        { negative_prompt: "blurry" },
      ),
    /no effect at cfg 1.*Set cfg above 1 \(up to 30\)/,
  );
  assert.doesNotThrow(() =>
    assertAdjustable(
      { ...profile, defaults: { ...profile.defaults, cfg: 1 } },
      { negative_prompt: "blurry", cfg: 5 },
    ),
  );
  assert.doesNotThrow(
    () =>
      assertAdjustable(
        { ...profile, capabilities: { ...profile.capabilities, negativePrompt: false } },
        { negative_prompt: "" },
      ),
    "an empty negative is harmless",
  );
  assert.throws(
    () => assertAdjustable(profile, { sampler: "heun" }),
    /Choose sampler from: euler, dpmpp_2m/,
  );
  assert.throws(() => assertAdjustable(profile, { steps: 200 }), /Choose steps from 1 to 150/);
});

test("LoRA discovery indexes compatible optional effects compactly and bounds looked-up details", () => {
  const infos = {
    "styles/ink.safetensors": {
      families: ["sdxl"],
      base: "SDXL",
      title: "Ink Wash Painting",
      triggers: ["inkstyle", "wash"],
      description: "x".repeat(1000),
      sourceUrl: "https://example.test/style",
    },
    "lora_1234_v2.safetensors": {
      families: ["sdxl"],
      title: "Brutalist Concrete Architecture Photography LoRA by someone",
      triggers: ["lora"],
      strengthRange: { min: 0, max: 1.5, step: 0.1, default: 1.1 },
    },
    "PixelArtRedmond.safetensors": {
      families: ["sdxl"],
      title: "Pixel Art Redmond",
      triggers: ["pixel art"],
    },
    "speed.safetensors": { families: ["sdxl"], role: "acceleration" },
    "flux.safetensors": { families: ["flux"] },
  };
  const subject = { ...profile, options: { loras: Object.keys(infos) } };
  const { loras, total } = mcpLoras(subject, infos);
  assert.equal(total, 3);
  // A descriptive name needs no hint; a cryptic one gets the title's other words, at most 40 characters.
  // A trigger the name already spells out is left out too.
  assert.deepEqual(loras, [
    "lora_1234_v2 — Brutalist Concrete Architecture Photogr…",
    "PixelArtRedmond",
    "ink — Wash Painting [inkstyle]",
  ]);
  // Thumbs up lead and thumbs down trail, each alphabetical.
  const ratings = { "styles/ink.safetensors": "up", "lora_1234_v2.safetensors": "down" };
  assert.deepEqual(
    mcpLoras(subject, infos, { ratings }).loras.map((line) => line.split(" ")[0]),
    ["ink", "PixelArtRedmond", "lora_1234_v2"],
  );
  const detailed = mcpLoras(subject, infos, { query: "ink" });
  assert.equal(detailed.loras[0].description.length, 280);
  assert.deepEqual(detailed.loras[0].strength, { recommended: 0.7 });
  assert.deepEqual(mcpLoras(subject, infos, { names: ["LORA_1234_V2"] }).loras[0].strength, {
    recommended: 1.1,
    min: 0,
    max: 1.5,
  });
  assert.deepEqual(mcpLoras({ ...profile, capabilities: { lora: false } }, infos), {
    loras: [],
    total: 0,
  });
  // Lookups return at most five full entries; further matches stay in the compact form.
  const many = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `glow-${index}.safetensors`,
      { families: ["sdxl"], title: `Glow ${index}` },
    ]),
  );
  const capped = mcpLoras({ ...profile, options: { loras: Object.keys(many) } }, many, {
    query: "glow",
  });
  assert.equal(capped.loras.length, 5);
  assert.deepEqual(capped.more, ["glow-5", "glow-6", "glow-7"]);
});

test("Generate LoRA names resolve without folder, extension or case and take the recommended strength", () => {
  const infos = {
    "styles/Ink-Wash.safetensors": {
      families: ["sdxl"],
      strengthRange: { min: 0, max: 1.5, step: 0.1, default: 1.1 },
    },
  };
  const subject = { ...profile, options: { loras: Object.keys(infos) } };
  for (const name of ["styles/Ink-Wash.safetensors", "ink-wash", "Ink Wash", "styles/ink_wash"])
    assert.equal(resolveLoraName(subject, name), "styles/Ink-Wash.safetensors", name);
  assert.deepEqual(
    prepareLoras(subject, infos, [{ name: "ink wash" }, { name: "Ink-Wash", strength: 0.5 }]),
    [{ name: "styles/Ink-Wash.safetensors", strength: 1.1 }],
  );
  assert.deepEqual(prepareLoras(subject, infos, [{ name: "ink wash", triggers: false }]), [
    { name: "styles/Ink-Wash.safetensors", strength: 1.1, triggers: false },
  ]);
  assert.throws(
    () => prepareLoras(subject, infos, [{ name: "oil paint" }]),
    /^Error: No LoRA named oil paint for SDXL\. Call Models with lora_query to look one up\.$/,
  );
});

test("a distilled profile without CFG offers no cfg and refuses one with a clear note", () => {
  const distilled = {
    ...profile,
    id: "image:tesserafine-fast",
    label: "Tesserafine Fast",
    capabilities: { ...profile.capabilities, cfg: false },
    defaults: { ...profile.defaults, cfg: 1 },
  };
  assert.equal(mcpControls(distilled).cfg, undefined);
  assert.throws(
    () => assertAdjustable(distilled, { cfg: 3 }),
    /cfg cannot be adjusted for Tesserafine Fast\. This profile is guidance-distilled and runs at its own CFG; leave cfg out\./,
  );
  // The reference mode decides on its own.
  const modes = {
    ...profile,
    imageModes: { reference: { capabilities: { ...profile.capabilities, cfg: false } } },
  };
  assert.equal(mcpControls({ ...modes, ...modes.imageModes.reference }).cfg, undefined);
  assert.ok(mcpControls(modes).cfg);
});
