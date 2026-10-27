import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-i2v-"));
process.env.STUDIO_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(
  ["diffusion_models", "text_encoders", "vae", "clip_vision"].map((name) => {
    const dir = path.join(scratch, "ComfyUI", "models", name);
    fs.mkdirSync(dir, { recursive: true });
    return [name, dir];
  }),
);
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { familyFromHeader } = await import("./family-catalog.js");
const { catalogDownload } = await import("./catalog-downloads.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
function put(folder, name, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(path.join(dirs[folder], name), Buffer.concat([length, json]));
  return name;
}
const wanI2v = {
  "head.modulation": t([1, 2, 5120]),
  "head.head.weight": t([64, 5120]),
  "patch_embedding.weight": t([5120, 36, 1, 2, 2]),
};
const hunyuan15 = {
  "txt_in.individual_token_refiner.blocks.0.norm1.weight": t([1]),
  "vision_in.proj.0.weight": t([1]),
  "img_in.proj.weight": t([2048, 65, 1, 2, 2]),
};

const list = (values) => ({ input: { required: values } });
const nodes = [
  "CLIPTextEncode",
  "VAEDecode",
  "SaveImage",
  "EmptyLatentImage",
  "KSamplerAdvanced",
  "ModelSamplingSD3",
  "CreateVideo",
  "SaveVideo",
  "LoadImage",
  "WanImageToVideo",
  "HunyuanVideo15ImageToVideo",
  "CLIPVisionEncode",
  "EmptyHunyuanLatentVideo",
  "EmptyHunyuanVideo15Latent",
];
function objectInfo({ unets = [], clips = [], vaeFiles = [], vision = [] } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [[]] }),
    CLIPLoader: list({ clip_name: [clips], type: [["wan"]] }),
    DualCLIPLoader: list({
      clip_name1: [clips],
      clip_name2: [clips],
      type: [["hunyuan_video_15"]],
    }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    CLIPVisionLoader: list({ clip_name: [vision] }),
    KSampler: list({ sampler_name: [["euler"]], scheduler: [["simple"]] }),
  };
}
const classes = (graph) => Object.values(graph).map((node) => node.class_type);

test("Wan 2.2 14B I2V is read from its weights; Wan 2.1 I2V and Fun inpaint stay apart", () => {
  assert.equal(familyFromHeader(wanI2v).family, "wan22_14b_i2v");
  assert.equal(familyFromHeader({ ...wanI2v, "img_emb.proj.0.bias": t([1]) }).family, "wan_i2v");
  put("diffusion_models", "wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors", wanI2v);
  assert.equal(
    classifyModel("unet", "wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors").family,
    "wan_other",
  );
  assert.equal(
    classifyModel("unet", "remote/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors").family,
    "wan22_14b_i2v",
    "out of reach, the name says i2v",
  );
  const t2v = put("diffusion_models", "wan2.2_i2v_named_but_t2v_high_noise.safetensors", {
    "head.modulation": t([1, 2, 5120]),
    "head.head.weight": t([64, 5120]),
    "patch_embedding.weight": t([5120, 16, 1, 2, 2]),
  });
  assert.equal(
    classifyModel("unet", t2v).family,
    "wan22_14b",
    "readable weights outrank an i2v in the name",
  );
});
