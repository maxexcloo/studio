import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-types-"));
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

const { classifyModel, readSafetensorsHeader } = await import("./model-families.js");
const { familyFromHeader } = await import("./family-catalog.js");
const { encoderKindFromHeader, vaeLayoutFromHeader } = await import("./model-components.js");
const { sanitizeGenerateBody } = await import("./validation.js");

/* ------------------------------------------------------------ fixtures */

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
// Real checkpoints carry thousands of prefixed keys; ComfyUI only trusts a prefix used more than five times.
const filler = Object.fromEntries(
  Array.from({ length: 8 }, (_, index) => [
    `filler.${index}.weight`,
    { dtype: "F16", shape: [1], data_offsets: [0, 0] },
  ]),
);
const prefixed = (prefix, header) =>
  Object.fromEntries(
    Object.entries({ ...header, ...filler }).map(([key, value]) => [`${prefix}${key}`, value]),
  );

const headers = {
  krea2: { "txtfusion.projector.weight": t([3072, 12]), "first.weight": t([3072, 64]) },
  zimage: {
    "cap_embedder.1.weight": t([3840, 2560]),
    "noise_refiner.0.attention.k_norm.weight": t([128]),
  },
  fluxDev: {
    "double_blocks.0.img_attn.norm.key_norm.scale": t([128]),
    "img_in.weight": t([3072, 64]),
    "guidance_in.in_layer.weight": t([3072, 256]),
  },
  fluxSchnell: {
    "double_blocks.0.img_attn.norm.key_norm.scale": t([128]),
    "img_in.weight": t([3072, 64]),
  },
  klein4b: {
    "double_blocks.0.img_attn.norm.key_norm.scale": t([128]),
    "img_in.weight": t([3072, 128]),
    "double_stream_modulation_img.lin.weight": t([1, 1]),
    "txt_in.weight": t([3072, 7680]),
  },
  chroma: {
    "double_blocks.0.img_attn.norm.key_norm.scale": t([128]),
    "distilled_guidance_layer.norms.0.scale": t([1]),
  },
  sd3: { "joint_blocks.0.context_block.attn.qkv.weight": t([1, 1]) },
  wan5b: { "head.modulation": t([1, 2, 3072]), "head.head.weight": t([192, 3072]) },
  wan14b: {
    "head.modulation": t([1, 2, 5120]),
    "head.head.weight": t([64, 5120]),
    "patch_embedding.weight": t([5120, 16, 1, 2, 2]),
  },
  h3: { "video_patch_proj.weight": t([1, 1]), "audio_patch_proj.weight": t([1, 1]) },
  qwenImage: { "txt_norm.weight": t([3584]), "img_in.weight": t([3072, 64]) },
  hidream: { "caption_projection.0.linear.weight": t([1, 1]) },
  aura: { "double_layers.0.attn.w1q.weight": t([1, 1]) },
  sdxlUnet: {
    "input_blocks.0.0.weight": t([320, 4, 3, 3]),
    "input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight": t([640, 2048]),
  },
  sd15Unet: {
    "input_blocks.0.0.weight": t([320, 4, 3, 3]),
    "input_blocks.1.1.transformer_blocks.0.attn2.to_k.weight": t([320, 768]),
  },
};

const encoders = {
  clip_l: { "text_model.encoder.layers.0.mlp.fc1.weight": t([3072, 768]) },
  clip_g: { "text_model.encoder.layers.30.mlp.fc1.weight": t([5120, 1280]) },
  t5xxl: {
    "encoder.block.23.layer.1.DenseReluDense.wi_1.weight": t([10240, 4096]),
    "shared.weight": t([32128, 4096]),
  },
  umt5: {
    "encoder.block.23.layer.1.DenseReluDense.wi_1.weight": t([10240, 4096]),
    "encoder.block.1.layer.0.SelfAttention.relative_attention_bias.weight": t([32, 64]),
  },
  qwen3_4b: {
    "model.layers.0.post_attention_layernorm.weight": t([2560]),
    "model.layers.0.self_attn.q_norm.weight": t([128]),
    "model.layers.0.self_attn.k_proj.weight": t([1024, 2560]),
  },
  qwen3vl_4b: {
    "model.visual.deepstack_merger_list.0.norm.weight": t([1]),
    "model.visual.merger.linear_fc2.weight": t([2560, 1]),
  },
  qwen25vl: { "model.layers.0.self_attn.k_proj.bias": t([512]) },
};

const vaes = {
  kl4: { "decoder.conv_in.weight": t([512, 4, 3, 3]) },
  kl16: { "decoder.conv_in.weight": t([512, 16, 3, 3]) },
  flux2: { "decoder.conv_in.weight": t([512, 32, 3, 3]), "bn.running_mean": t([128]) },
  wan16: { "decoder.middle.0.residual.0.gamma": t([384]) },
  wan48: {
    "decoder.middle.0.residual.0.gamma": t([384]),
    "decoder.upsamples.0.upsamples.0.residual.2.weight": t([1]),
  },
};

function writeSafetensors(file, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([length, json]));
}

function put(folder, name, header) {
  writeSafetensors(path.join(dirs[folder], name), header);
  return name;
}

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

test("safetensors headers are read from disk", () => {
  const file = put("diffusion_models", "roundtrip.safetensors", {
    __metadata__: { format: "pt" },
    ...headers.krea2,
  });
  assert.deepEqual(
    readSafetensorsHeader(path.join(dirs.diffusion_models, file))["txtfusion.projector.weight"]
      .shape,
    [3072, 12],
  );
});

test("model families come from the weights, in ComfyUI's order", () => {
  const family = (header) => familyFromHeader(header).family;
  assert.equal(family(headers.krea2), "krea2");
  assert.equal(family(headers.zimage), "zimage");
  assert.equal(family({ ...headers.zimage, "cap_embedder.1.weight": t([2304, 2304]) }), "lumina2");
  assert.equal(family(headers.fluxDev), "flux1");
  assert.equal(familyFromHeader(headers.fluxSchnell).detail.schnell, true);
  assert.equal(family(headers.klein4b), "flux2_klein_4b");
  assert.equal(family({ ...headers.klein4b, "txt_in.weight": t([3072, 12288]) }), "flux2_klein_9b");
  assert.equal(family({ ...headers.klein4b, "txt_in.weight": t([6144, 15360]) }), "flux2_dev");
  assert.equal(family(headers.chroma), "chroma");
  assert.equal(family(headers.sd3), "sd3");
  assert.equal(family(headers.wan5b), "wan22_5b");
  assert.equal(family(headers.wan14b), "wan21");
  assert.equal(family(headers.h3), "minimax_h3");
  assert.equal(family(headers.qwenImage), "qwen_image");
  assert.equal(family(headers.hidream), "hidream");
  assert.equal(family(headers.aura), "auraflow");
  assert.equal(
    family(prefixed("model.diffusion_model.", headers.sdxlUnet)),
    "sdxl",
    "all-in-one checkpoints carry a prefix",
  );
  assert.equal(family(prefixed("model.diffusion_model.", headers.sd15Unet)), "sd15");
});

test("text encoders and VAEs are told apart by shape", () => {
  assert.equal(encoderKindFromHeader(encoders.clip_l), "clip_l");
  assert.equal(encoderKindFromHeader(encoders.clip_g), "clip_g");
  assert.equal(encoderKindFromHeader(encoders.t5xxl), "t5xxl");
  assert.equal(
    encoderKindFromHeader(encoders.umt5),
    "umt5xxl",
    "UMT5 keeps a position bias in every block",
  );
  assert.equal(encoderKindFromHeader(encoders.qwen3_4b), "qwen3_4b");
  assert.equal(encoderKindFromHeader(encoders.qwen3vl_4b), "qwen3vl_4b");
  assert.equal(encoderKindFromHeader(encoders.qwen25vl), "qwen25vl_7b");
  // MiniMax Music's encoder: Qwen3 8B's width and q_norm, but one fused qkv_proj. It can't run Flux 2 Klein 9B.
  assert.equal(
    encoderKindFromHeader({
      "model.layers.0.post_attention_layernorm.weight": t([4096]),
      "model.layers.0.self_attn.q_norm.weight": t([128]),
      "model.layers.0.self_attn.qkv_proj.weight": t([6144, 4096]),
    }),
    "other",
  );
  assert.equal(vaeLayoutFromHeader(vaes.kl4), "kl4");
  assert.equal(vaeLayoutFromHeader(vaes.kl16), "kl16");
  assert.equal(vaeLayoutFromHeader(vaes.flux2), "flux2");
  assert.equal(vaeLayoutFromHeader(vaes.wan16), "wan16");
  assert.equal(vaeLayoutFromHeader(vaes.wan48), "wan48");
});

test("the weights win over the filename, and names fill in when files are out of reach", () => {
  put("diffusion_models", "krea2_but_actually_flux.safetensors", headers.fluxDev);
  put("diffusion_models", "myRealismMix_v2.safetensors", headers.krea2);
  assert.equal(classifyModel("unet", "krea2_but_actually_flux.safetensors").family, "flux1");
  assert.deepEqual(
    [
      classifyModel("unet", "myRealismMix_v2.safetensors").family,
      classifyModel("unet", "myRealismMix_v2.safetensors").via,
    ],
    ["krea2", "file"],
  );
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

test("checkpoints report which parts they carry", () => {
  put("checkpoints", "juggernautXL.safetensors", {
    ...prefixed("model.diffusion_model.", headers.sdxlUnet),
    "conditioner.embedders.0.transformer.text_model.x": t([1]),
    "first_stage_model.decoder.conv_in.weight": t([512, 4, 3, 3]),
  });
  put("checkpoints", "zImageRealism_fp8.safetensors", headers.zimage);
  assert.deepEqual(classifyModel("checkpoint", "juggernautXL.safetensors").bundled, {
    encoder: true,
    vae: true,
    known: true,
  });
  const bare = classifyModel("checkpoint", "zImageRealism_fp8.safetensors");
  assert.deepEqual([bare.family, bare.bundled.encoder, bare.bundled.vae], ["zimage", false, false]);
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
// Where the ExtraModels loader leaves a preset it has fetched.
const downloadSanaPreset = (dir, file) => {
  const target = path.join(scratch, "ComfyUI", "models", "sana", dir, "checkpoints");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, file), "");
};

test("Sana is recognised from its own and diffusers-style weights", () => {
  const blocks = (prefix, count, extra = {}) => ({
    ...Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${prefix}.${i}.norm.weight`, t([1])]),
    ),
    ...extra,
  });
  assert.deepEqual(
    familyFromHeader(
      blocks("blocks", 20, {
        "blocks.0.mlp.inverted_conv.conv.weight": t([11200, 2240, 1, 1]),
        "blocks.0.attn.q_norm.weight": t([2240]),
      }),
    ),
    { family: "sana", detail: { depth: 20, sprint: false, qkNorm: true } },
  );
  assert.deepEqual(
    familyFromHeader(
      blocks("blocks", 28, {
        "blocks.0.mlp.inverted_conv.conv.weight": t([1, 1, 1, 1]),
        "cfg_embedder.mlp.0.weight": t([1, 1]),
      }),
    ).detail,
    { depth: 28, sprint: true, qkNorm: false },
  );
  assert.equal(
    familyFromHeader(
      blocks("transformer_blocks", 20, {
        "transformer_blocks.0.ff.conv_inverted.weight": t([1, 1, 1, 1]),
        "adaln_single.emb.timestep_embedder.linear_1.bias": t([1]),
      }),
    ).family,
    "sana",
    "not LTX-Video",
  );
  const local = put(
    "checkpoints",
    "mySanaTune.safetensors",
    blocks("blocks", 60, { "blocks.0.mlp.inverted_conv.conv.weight": t([1, 1, 1, 1]) }),
  );
  assert.equal(classifyModel("checkpoint", local).family, "sana");
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

test("the four new families are told apart by their weights, as ComfyUI does", () => {
  assert.equal(
    familyFromHeader({
      "cap_embedder.1.weight": t([2304, 2304]),
      "noise_refiner.0.attention.k_norm.weight": t([96]),
    }).family,
    "lumina2",
  );
  assert.equal(
    familyFromHeader({
      "cap_embedder.1.weight": t([2304, 2304]),
      "noise_refiner.0.attention.k_norm.weight": t([96]),
      "clip_text_pooled_proj.0.weight": t([1, 1]),
    }).family,
    "newbie",
  );
  assert.equal(
    familyFromHeader({
      "embed_image_indicator.weight": t([1, 1]),
      "input_proj.weight": t([1, 128]),
    }).family,
    "ideogram4",
  );
  assert.equal(
    familyFromHeader({ "txt_norm.weight": t([2560]), "proj_out.weight": t([128, 1]) }).family,
    "mage_flow",
  );
  assert.equal(
    familyFromHeader({ "txt_norm.weight": t([3584]), "proj_out.weight": t([64, 1]) }).family,
    "qwen_image",
    "Qwen-Image keeps its own",
  );
  assert.equal(familyFromHeader({ "layers.0.mlp.linear_fc2.weight": t([1, 1]) }).family, "ernie");
  assert.equal(vaeLayoutFromHeader({ "student.dconv_encoder.proj_out.weight": t([1, 1]) }), "mage");
});

test("Qwen-Image 2.1 is read from its weights, and weights nothing knows yet let the name decide", () => {
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
  assert.equal(familyFromHeader(qwen21).family, "qwen_image_21");
  put("diffusion_models", "renamed_finetune_v3_int8.safetensors", qwen21);
  assert.deepEqual(
    [
      classifyModel("unet", "renamed_finetune_v3_int8.safetensors").family,
      classifyModel("unet", "renamed_finetune_v3_int8.safetensors").via,
    ],
    ["qwen_image_21", "file"],
  );
  const unknown = { "brand_new_block.0.weight": t([1, 1]), "brand_new_block.1.weight": t([1, 1]) };
  put("diffusion_models", "qwenImage21_future_layout.safetensors", unknown);
  put("diffusion_models", "mystery_model.safetensors", unknown);
  assert.deepEqual(
    [
      classifyModel("unet", "qwenImage21_future_layout.safetensors").family,
      classifyModel("unet", "qwenImage21_future_layout.safetensors").via,
    ],
    ["qwen_image_21", "name"],
  );
  assert.equal(classifyModel("unet", "mystery_model.safetensors").family, "other");
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
  const plan = packInstallPlan(nodePack("moss_image"), "/opt/ComfyUI");
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
