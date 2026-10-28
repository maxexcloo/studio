import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-i2v-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { catalogDownload } = await import("./catalog-downloads.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
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

test("Wan 2.2 14B I2V is read from its weights or name, and Wan 2.1 I2V stays apart", () => {
  assert.equal(
    classifyModel("unet", "remote/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors").family,
    "wan22_14b_i2v",
    "the name says i2v",
  );
});
