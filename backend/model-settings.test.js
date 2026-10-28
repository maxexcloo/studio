import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the data folder at a scratch tree before the modules read it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-settings-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { variantFor } = await import("./family-catalog.js");
const { inferModels } = await import("./models.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
const zimage = {
  "cap_embedder.1.weight": t([3840, 2560]),
  "noise_refiner.0.attention.k_norm.weight": t([128]),
};
const wan14b = {
  "head.modulation": t([1, 2, 5120]),
  "head.head.weight": t([64, 5120]),
  "patch_embedding.weight": t([5120, 16, 1, 2, 2]),
};

const list = (values) => ({ input: { required: values } });
const nodes = [
  "CLIPTextEncode",
  "VAEDecode",
  "SaveImage",
  "EmptyLatentImage",
  "EmptySD3LatentImage",
  "EmptyFlux2LatentImage",
  "Flux2Scheduler",
  "SamplerCustomAdvanced",
  "CFGGuider",
  "BasicGuider",
  "KSamplerSelect",
  "RandomNoise",
  "ConditioningZeroOut",
  "ModelSamplingSD3",
  "ModelSamplingAuraFlow",
  "KSamplerAdvanced",
  "EmptyHunyuanLatentVideo",
  "CreateVideo",
  "SaveVideo",
  "LoadImage",
  "VAEEncode",
];
function objectInfo({ unets = [], checkpoints = [], clips = [], vaeFiles = [], loras = [] } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({
      clip_name: [clips],
      type: [["lumina2", "flux2", "wan", "stable_diffusion"]],
    }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: [["sdxl"]] }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    LoraLoader: list({
      lora_name: [loras],
      strength_model: ["FLOAT", { default: 1, min: -100, max: 100, step: 0.01 }],
    }),
    KSampler: list({
      sampler_name: [
        [
          "euler",
          "res_multistep",
          "lcm",
          "ddim",
          "dpmpp_2m",
          "euler_ancestral",
          "uni_pc",
          "er_sde",
        ],
      ],
      scheduler: [["simple", "sgm_uniform", "karras", "normal", "beta"]],
    }),
  };
}

test("a renamed fine-tune runs at its family's usual settings: Turbo or Distilled unless the name says base or raw", () => {
  assert.equal(variantFor("zimage", "myZMerge_v3.safetensors").id, "turbo");
  assert.equal(variantFor("zimage", "z_image_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("zimage", "z_image_base_bf16.safetensors").id, "base");
  assert.equal(
    variantFor("zimage", "z_image_bf16.safetensors").id,
    "base",
    "the plain Z-Image release is the base model",
  );
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-4b-fp8.safetensors").id, "distilled");
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-base-4b.safetensors").id, "base");
  assert.equal(variantFor("flux2_klein_9b", "myKleinMerge.safetensors").id, "distilled");
  assert.equal(
    variantFor("krea2", "MuseByStableYogi_V35Int8Extended.safetensors").id,
    "turbo",
    "most Krea 2 fine-tunes are built on Turbo",
  );
  assert.equal(variantFor("krea2", "krea2_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("krea2", "krea2_raw_bf16.safetensors").id, "raw");
});

test("custom MiniMax H3 profiles use the family's starting aspect", async () => {
  const { profileImageSize } = await import("./generation-defaults.js");
  const workflows = path.join(scratch, "data", "workflows");
  fs.mkdirSync(workflows, { recursive: true });
  const file = path.join(workflows, "h3-aspect.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      graph: { 1: { class_type: "EmptyLatentImage", inputs: { width: 1344, height: 768 } } },
      studio: {
        id: "h3-aspect",
        name: "H3 Aspect",
        kind: "video",
        family: "minimax-h3",
        controls: { width: { node: "1", input: "width" }, height: { node: "1", input: "height" } },
        defaults: { width: 1344, height: 768 },
      },
    }),
  );
  try {
    const profile = inferModels(objectInfo({})).profiles.find(
      (item) => item.id === "custom:h3-aspect",
    );
    assert.equal(profile.aspectDefault, "16:9");
    const size = profileImageSize(profile);
    assert.ok(size.width > size.height, "an imported H3 workflow must not start square");
  } finally {
    fs.rmSync(file);
  }
});

test("custom batch counts reach the UI and configured ready profiles become instance defaults", () => {
  const workflows = path.join(scratch, "data", "workflows");
  fs.mkdirSync(workflows, { recursive: true });
  const file = path.join(workflows, "batch-profile.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      graph: {
        1: { class_type: "EmptyLatentImage", inputs: { width: 864, height: 1152, batch_size: 4 } },
      },
      studio: {
        id: "batch-profile",
        name: "Batch Profile",
        kind: "image",
        controls: { count: { node: "1", input: "batch_size" } },
        defaults: { count: 4, width: 864, height: 1152 },
      },
    }),
  );
  const previous = process.env.STUDIO_DEFAULT_IMAGE_PROFILE;
  try {
    process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "custom:batch-profile";
    const info = objectInfo({ checkpoints: ["sdxl_turbo_1.0.safetensors"] });
    const models = inferModels(info);
    assert.equal(models.defaults.imageModel, "custom:batch-profile");
    assert.equal(
      models.profiles.find((profile) => profile.id === "custom:batch-profile").defaults.count,
      4,
    );
    process.env.STUDIO_DEFAULT_IMAGE_PROFILE = "custom:missing";
    assert.notEqual(inferModels(info).defaults.imageModel, "custom:missing");
  } finally {
    if (previous === undefined) delete process.env.STUDIO_DEFAULT_IMAGE_PROFILE;
    else process.env.STUDIO_DEFAULT_IMAGE_PROFILE = previous;
    fs.rmSync(file);
  }
});
