import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the data folder at a scratch tree before the modules read it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-types-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { sanitizeGenerateBody } = await import("./validation.js");

/* ------------------------------------------------------------ fixtures */

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });

const list = (values) => ({ input: { required: values } });
const node = () => list({});

function objectInfo({
  unets = [],
  checkpoints = [],
  clips = [],
  vaeFiles = [],
  clipTypes,
  extra = {},
} = {}) {
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
    "BasicScheduler",
    "KSamplerSelect",
    "RandomNoise",
    "FluxGuidance",
    "ConditioningZeroOut",
    "ModelSamplingFlux",
    "ModelSamplingAuraFlow",
    "ModelSamplingSD3",
    "ModelSamplingDiscrete",
    "CLIPSetLastLayer",
    "KSamplerAdvanced",
    "EmptyHunyuanLatentVideo",
    "Wan22ImageToVideoLatent",
    "CreateVideo",
    "SaveVideo",
    "TripleCLIPLoader",
    "QuadrupleCLIPLoader",
    "T5TokenizerOptions",
    "LoadImage",
    "VAEEncode",
    "MiniMaxH3ImageToVideo",
    "VAEDecodeAudio",
    "EmptyHunyuanVideo15Latent",
  ];
  return {
    ...Object.fromEntries(nodes.map((name) => [name, node()])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default", "fp8_e4m3fn"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({
      clip_name: [clips],
      type: [
        clipTypes || [
          "stable_diffusion",
          "lumina2",
          "krea2",
          "qwen_image",
          "wan",
          "flux2",
          "chroma",
          "minimax",
        ],
      ],
    }),
    DualCLIPLoader: list({
      clip_name1: [clips],
      clip_name2: [clips],
      type: [["sdxl", "flux", "hunyuan_video_15"]],
    }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    LoraLoader: list({ lora_name: [["style.safetensors"]] }),
    KSampler: list({
      sampler_name: [
        ["euler", "euler_ancestral", "res_multistep", "uni_pc", "dpmpp_2m", "lcm", "ddim"],
      ],
      scheduler: [["simple", "normal", "karras", "sgm_uniform", "beta"]],
    }),
    ...extra,
  };
}

/* ------------------------------------------------------------ recognition */

test("model files are placed by their names", () => {
  assert.equal(
    classifyModel("unet", "remote/flux1-krea-dev.safetensors").family,
    "flux1",
    "FLUX.1 Krea is Flux",
  );
  assert.equal(classifyModel("unet", "remote/z_image_turbo_bf16.safetensors").variant.id, "turbo");
  assert.equal(classifyModel("unet", "remote/z_image_bf16.safetensors").variant.id, "base");
  assert.equal(classifyModel("unet", "remote/krea2_raw_bf16.safetensors").variant.id, "raw");
  assert.equal(
    classifyModel("unet", "remote/wan2.2_t2v_high_noise_14B_fp8.safetensors").family,
    "wan22_14b",
  );
  const unknownCheckpoint = classifyModel("checkpoint", "remote/cyberrealisticPony_v8.safetensors");
  assert.deepEqual([unknownCheckpoint.family, unknownCheckpoint.variant.id], ["sdxl", "pony"]);
});

/* ------------------------------------------------------------ profiles */

test("an imported workflow's missing file gets a download only for that exact catalog file", async () => {
  const { catalogDownloadsForFile } = await import("./catalog-downloads.js");
  const [vae] = catalogDownloadsForFile("flux2-vae.safetensors", "vae");
  assert.deepEqual([vae.id, vae.label, vae.folder], ["vae:flux2:0", "Flux.2 VAE", "vae"]);
  assert.equal(
    catalogDownloadsForFile("qwen_3_8b_fp8mixed.safetensors", "text_encoders")[0].id,
    "encoder:qwen3_8b:1",
  );
  assert.deepEqual(
    catalogDownloadsForFile("flux2-vae.safetensors", "text_encoders"),
    [],
    "right name, wrong folder",
  );
  assert.deepEqual(
    catalogDownloadsForFile("flux/flux2-vae.safetensors", "vae"),
    [],
    "a subfolder path is not where a download lands",
  );
});

/* ------------------------------------------------------------ Sana */

const sanaNodes = (presets) => ({
  SanaCheckpointLoader: list({
    ckpt_name: [presets],
    model: [["SanaMS1.5_1600M_P1_D20"]],
    dtype: [["auto", "FP32", "FP16", "BF16"]],
  }),
  GemmaLoader: node(),
  SanaTextEncode: node(),
  GemmaTextEncode: node(),
  ExtraVAELoader: node(),
  ScmModelSampling: node(),
  EmptySanaLatentImage: node(),
  EmptyHunyuanImageLatent: list({
    width: ["INT", { default: 2048, min: 64, max: 16384, step: 32 }],
    height: ["INT", { default: 2048, min: 64, max: 16384, step: 32 }],
    batch_size: ["INT", { default: 1, min: 1, max: 4096 }],
  }),
});

test("Sana is recognised from its own and diffusers-style weights", () => {
  const blocks = (prefix, count, extra = {}) => ({
    ...Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${prefix}.${i}.norm.weight`, t([1])]),
    ),
    ...extra,
  });
  assert.equal(classifyModel("checkpoint", "Sana_Sprint_0.6B_1024px.pth").variant.id, "sprint");
});

test("every node pack is one registry entry, and a missing one comes with both install routes", async () => {
  const { nodePacks } = await import("./node-packs.js");
  const { missingPackPart } = await import("./node-install.js");
  for (const [id, pack] of Object.entries(nodePacks)) {
    assert.match(pack.repository, /^https:\/\/github\.com\/.+\.git$/, id);
    assert.ok(pack.folder && pack.nodes.length, id);
  }
  assert.equal(missingPackPart({ SanaModelLoader: {}, SanaGenerate: {} }, "comfyui_sana"), null);
  const part = missingPackPart({}, "seedvr2");
  assert.deepEqual(
    [part.part, part.nodePack.repository, part.missingNodes.length],
    ["comfy", nodePacks.seedvr2.repository, 3],
  );
  assert.ok(part.install.commands.length >= 1);
});

/* ------------------------------------------------------------ Lumina 2, Ideogram 4, MageFlow, ERNIE */

const newNodes = () =>
  Object.fromEntries(
    ["Ideogram4Scheduler", "DualModelGuider", "CFGOverride", "TextEncodeMageFlowEdit"].map(
      (name) => [name, node()],
    ),
  );
const newTypes = [
  "stable_diffusion",
  "lumina2",
  "krea2",
  "qwen_image",
  "wan",
  "flux2",
  "chroma",
  "minimax",
  "ideogram4",
  "mage",
];

test("Qwen-Image 2.1 is read from its weights or its name", () => {
  const qwen21 = {
    "txt_in.text_norm.weight": t([4096]),
    "modulation.1.weight": t([16384, 4096]),
    "img_in.weight": t([4096, 64]),
    "proj_out.weight": t([64, 4096]),
    "transformer_blocks.0.attn.norm_q.weight": t([128]),
    "transformer_blocks.0.img_mlp.gate_up.weight": {
      dtype: "I8",
      shape: [24576, 4096],
      data_offsets: [0, 0],
    },
    "transformer_blocks.0.img_mlp.gate_up.weight_scale": t([24576, 1]),
    "transformer_blocks.0.img_mlp.gate_up.comfy_quant": {
      dtype: "U8",
      shape: [72],
      data_offsets: [0, 0],
    },
  };
  assert.deepEqual(
    [
      classifyModel("unet", "qwenImage21_future_layout.safetensors").family,
      classifyModel("unet", "qwenImage21_future_layout.safetensors").via,
    ],
    ["qwen_image_21", "name"],
  );
});

/* ------------------------------------------------------------ MOSS-Image */

const mossDit = {
  "shared_block_modulation.weight": t([18432, 3072]),
  "layers.0.proj.ffn_up_gate.weight": t([16384, 3072]),
  "layers.0.proj.qkv.weight": t([9216, 3072]),
  "video_head_modulation.weight": t([6144, 3072]),
};
const qwen35 = (width) => ({
  "model.language_model.layers.0.linear_attn.A_log": t([32]),
  "model.language_model.layers.0.input_layernorm.weight": t([width]),
  "model.visual.blocks.0.attn.qkv.weight": t([3456, 1152]),
});
const mossTypes = [...newTypes, "moss_image"];

test("a pack inside a bigger repository is cloned beside its folder and only its folder is copied in", async () => {
  const { packInstallPlan } = await import("./node-install.js");
  const { nodePack } = await import("./node-packs.js");
  const plan = packInstallPlan(nodePack("moss_image"));
  const [command] = plan.commands;
  assert.match(
    command.command,
    /git clone https:\/\/github\.com\/OpenMOSS\/MOSS-Image\.git moss-image\.src/,
  );
  assert.match(
    command.command,
    /cp -R "moss-image\.src\/comfyui\/moss-image" "moss-image" && rm -rf "moss-image\.src"/,
  );
  assert.doesNotMatch(command.command, /pip install/);
});

/* ------------------------------------------------------------ FLUX.3 */

const flux3Dit = (flowMap) => ({
  "content_mode_blocks.image.0.attn_out.weight": t([3072, 3072]),
  "single_stream_modulations.txt.lin.weight": t([9216, 3072]),
  "txt_mode_blocks.0.attn_out.weight": t([3072, 3072]),
  ...(flowMap ? { "ref_time_in.in_layer.weight": t([3072, 256]) } : {}),
});
const flux3Types = [...mossTypes, "flux3"];
