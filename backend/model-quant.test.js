import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-quant-"));
process.env.STUDIO_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(
  ["diffusion_models", "checkpoints", "text_encoders", "vae"].map((name) => {
    const dir = path.join(scratch, "ComfyUI", "models", name);
    fs.mkdirSync(dir, { recursive: true });
    return [name, dir];
  }),
);
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { quantFromHeader } = await import("./family-catalog.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
const filler = Object.fromEntries(
  Array.from({ length: 8 }, (_, index) => [`filler.${index}.weight`, t([1])]),
);
const prefixed = (prefix, header) =>
  Object.fromEntries(
    Object.entries({ ...header, ...filler }).map(([key, value]) => [`${prefix}${key}`, value]),
  );
const flux = {
  "double_blocks.0.img_attn.norm.key_norm.scale": t([128]),
  "img_in.weight": t([3072, 64]),
  "guidance_in.in_layer.weight": t([3072, 256]),
};

function put(folder, name, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(path.join(dirs[folder], name), Buffer.concat([length, json]));
  return name;
}

const list = (values) => ({ input: { required: values } });
const nodes = [
  "CLIPTextEncode",
  "VAEDecode",
  "SaveImage",
  "EmptyLatentImage",
  "EmptySD3LatentImage",
  "FluxGuidance",
  "ConditioningZeroOut",
  "KSamplerAdvanced",
];
function objectInfo({ unets = [], checkpoints = [], extra = {} } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({ clip_name: [[]], type: [["stable_diffusion"]] }),
    DualCLIPLoader: list({ clip_name1: [[]], clip_name2: [[]], type: [["sdxl", "flux"]] }),
    VAELoader: list({ vae_name: [[]] }),
    KSampler: list({ sampler_name: [["euler"]], scheduler: [["simple"]] }),
    ...extra,
  };
}

test("quantized formats are told from their tensor keys, metadata, and only then the name", () => {
  assert.equal(
    quantFromHeader({
      "transformer_blocks.0.attn.to_qkv.qweight": t([1]),
      "transformer_blocks.0.attn.to_qkv.wscales": t([1]),
    }),
    "svdq",
  );
  assert.equal(
    quantFromHeader({
      "double_blocks.0.img_attn.qkv.weight.absmax": t([1]),
      "double_blocks.0.img_attn.qkv.weight.quant_state.bitsandbytes__nf4": t([1]),
    }),
    "nf4",
  );
  assert.equal(
    quantFromHeader({
      __metadata__: { quantization_config: '{"method": "svdquant"}' },
      "a.weight": t([1]),
    }),
    "svdq",
  );
  assert.equal(
    quantFromHeader({ "a.weight": t([1]), "a.weight_scale": t([1]), "a.comfy_quant": t([1]) }),
    "",
    "ComfyUI's own int8/fp8 layouts load natively",
  );
  assert.equal(quantFromHeader(null, "svdq-int4_r32-flux.1-dev.safetensors"), "svdq");
  assert.equal(quantFromHeader(null, "flux1-dev-bnb-nf4-v2.safetensors"), "nf4");
  assert.equal(
    quantFromHeader({ "a.weight": t([1]) }, "svdq-named-but-plain.safetensors"),
    "",
    "readable weights outrank the name",
  );
});
