import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  comfy,
  comfyModelsDir,
  comfyOutputDir,
  localOutputFile,
  modelFolders,
  optionsFor,
} from "./comfy.js";
import { families } from "./family-catalog.js";
import { classifyModel } from "./model-families.js";
import { nodePacks } from "./node-packs.js";
import { freeBytesAt } from "./paths.js";
import { outputFolderName } from "./data-names.js";

// SeedVR2 restores detail rather than interpolating it, so the pipeline mirrors
// the reference workflow: soften the source with a lanczos pre-scale, then let
// the model rebuild the short side at the requested resolution.
export const upscaleQualities = ["fast", "balanced", "high"];

/**
 * Every file Studio may download, with the exact size and SHA-256 Hugging Face
 * publishes for it (the same hashes the SeedVR2 node's own registry checks).
 * A file on disk only counts as present at its published size.
 */
export const modelFiles = {
  "seedvr2_ema_3b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 3B",
    detail: "fp8",
    bytes: 3_391_544_696,
    sha256: "3bf1e43ebedd570e7e7a0b1b60d6a02e105978f505c8128a241cde99a8240cff",
  },
  "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors": {
    repo: "AInVFX/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp8, last block fp16",
    bytes: 8_466_296_338,
    sha256: "3d68b5ec0b295ae28092e355c8cad870edd00b817b26587d0cb8f9dd2df19bb2",
  },
  "seedvr2_ema_7b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp8",
    bytes: 8_239_729_704,
    sha256: "1fdbf3877b7d1eb266038d3a165a977f17dbb4daa4a0f0d334d5461476963037",
  },
  "seedvr2_ema_7b_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp16",
    bytes: 16_479_334_424,
    sha256: "7b8241aa957606ab6cfb66edabc96d43234f9819c5392b44d2492d9f0b0bbe4a",
  },
  "ema_vae_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 VAE",
    detail: "fp16",
    bytes: 501_324_814,
    sha256: "20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1",
  },
};

/**
 * Each tier lists its DiT weights best first. Balanced prefers the mixed fp8
 * build: the plain 7B fp8 file shows artifacts the SeedVR2 authors fixed by
 * keeping the last block in fp16. The plain one still counts if it is already
 * on disk, so nobody re-downloads 8 GB for a small quality difference.
 */
const ditTiers = {
  fast: ["seedvr2_ema_3b_fp8_e4m3fn.safetensors"],
  balanced: [
    "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
    "seedvr2_ema_7b_fp8_e4m3fn.safetensors",
  ],
  high: ["seedvr2_ema_7b_fp16.safetensors"],
};
const vaeFile = "ema_vae_fp16.safetensors";

/**
 * Names the SeedVR2 node (2.5+) always offers in its dropdowns, downloaded or
 * not: it fetches a missing one itself on first use, with no progress anyone can
 * see. So a listed registry name proves nothing; only the file on disk does.
 * Names outside this list are files the node discovered on disk, so those count.
 */
const nodeRegistryNames = new Set([
  "seedvr2_ema_3b-Q4_K_M.gguf",
  "seedvr2_ema_3b-Q8_0.gguf",
  "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
  "seedvr2_ema_3b_fp16.safetensors",
  "seedvr2_ema_7b-Q4_K_M.gguf",
  "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
  "seedvr2_ema_7b_fp16.safetensors",
  "seedvr2_ema_7b_sharp-Q4_K_M.gguf",
  "seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors",
  "seedvr2_ema_7b_sharp_fp16.safetensors",
  "ema_vae_fp16.safetensors",
]);

const presets = {
  fast: { preScale: 1, targetScale: 1.5, maxShort: 1280, blocksToSwap: 16, tileSize: 768 },
  // Smaller VAE tiles reduce memory peaks while an image model remains loaded.
  balanced: { preScale: 0.7, targetScale: 2, maxShort: 2048, blocksToSwap: 32, tileSize: 512 },
  high: { preScale: 0.7, targetScale: 3, maxShort: 2816, blocksToSwap: 36, tileSize: 512 },
};

const upscaleNodeClasses = nodePacks.seedvr2.nodes;
const faceDetailNodeClasses = ["FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader"];

export function normalizeQuality(value = "") {
  const quality = String(value || "").toLowerCase();
  return upscaleQualities.includes(quality) ? quality : "balanced";
}

/**
 * SeedVR2 keeps its weights in ComfyUI/models/SEEDVR2. The output folder is the
 * only Comfy path Studio already knows, so derive the sibling models folder from
 * it unless an explicit override is set.
 */
function seedvr2ModelDir() {
  const override = String(process.env.STUDIO_SEEDVR2_MODEL_DIR || "").trim();
  if (override) return path.resolve(override);
  const models = comfyModelsDir();
  if (models) return path.join(models, "SEEDVR2");
  if (!comfyOutputDir) return "";
  return path.join(path.dirname(path.resolve(comfyOutputDir)), "models", "SEEDVR2");
}

function fileSize(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** A known file only counts when it is complete; a stray short copy is not a model. */
function onDisk(dir, file) {
  if (!dir) return false;
  const size = fileSize(path.join(dir, file));
  return size > 0 && (!modelFiles[file] || size === modelFiles[file].bytes);
}

function partialBytes(dir, file) {
  return dir ? fileSize(path.join(dir, `${file}.part`)) : 0;
}

function diskDitFiles(dir) {
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter(
        (name) => /seedvr2/i.test(name) && /\.(safetensors|gguf)$/i.test(name) && onDisk(dir, name),
      );
  } catch {
    return [];
  }
}

/**
 * What SeedVR2 can load right now, by the name its loader expects. With a known
 * local models folder that is the disk plus whatever the node discovered on
 * other model paths. A remote ComfyUI (no folder) has to be taken at its word;
 * its node downloads anything missing on first use.
 */
function available(info, dir) {
  const ditOptions = optionsFor(info, "SeedVR2LoadDiTModel", "model").map(String);
  const vaeOptions = optionsFor(info, "SeedVR2LoadVAEModel", "model").map(String);
  if (!dir)
    return {
      dit: ditOptions.filter((name) => /seedvr2/i.test(name)),
      vae: vaeOptions,
      remote: true,
    };
  const discovered = (options) =>
    options.filter((name) => !nodeRegistryNames.has(path.basename(name)));
  // Every folder ComfyUI reads for SeedVR2 (extra_model_paths.yaml included), not just ComfyUI/models/SEEDVR2.
  const dirs = [...new Set([dir, ...modelFolders("seedvr2", ["SEEDVR2"])])];
  const dit = [
    ...new Set([
      ...dirs.flatMap(diskDitFiles),
      ...discovered(ditOptions).filter((name) => /seedvr2/i.test(name)),
    ]),
  ]
    // The node can't load int8 builds (ConvRot and the like): "Only Tensors of floating point ... require gradients".
    .filter((name) => !/int8|convrot/i.test(name));
  const vae = [
    ...new Set([
      ...(dirs.some((folder) => onDisk(folder, vaeFile)) ? [vaeFile] : []),
      ...discovered(vaeOptions),
    ]),
  ];
  return { dit, vae, remote: false };
}

const byBase = (list, file) => list.find((name) => path.basename(name) === file);

/** The tier's own weight when present, then its alternates, then any SeedVR2 weight at all. */
function resolveDit(quality, have) {
  for (const file of ditTiers[quality]) {
    const found = byBase(have.dit, file);
    if (found) return { file: found };
  }
  return have.dit[0]
    ? { file: have.dit[0], substituted: true }
    : { file: ditTiers[quality][0], missing: true };
}

function resolveVae(have) {
  const found = byBase(have.vae, vaeFile) || have.vae[0];
  return found ? { file: found } : { file: vaeFile, missing: true };
}

/** The files this tier would download: its preferred DiT (unless a tier alternate is here) and the VAE. */
function requiredModelsFor(quality, info, dir = seedvr2ModelDir()) {
  const tier = ditTiers[normalizeQuality(quality)];
  const have = available(info, dir);
  const ditPresent = tier.some((file) => byBase(have.dit, file));
  const ditFile = tier.find((file) => byBase(have.dit, file)) || tier[0];
  return [
    { key: "dit", file: ditFile, present: ditPresent },
    { key: "vae", file: vaeFile, present: Boolean(byBase(have.vae, vaeFile) || have.vae.length) },
  ].map((model) => ({
    ...model,
    ...modelFiles[model.file],
    partialBytes: model.present ? 0 : partialBytes(dir, model.file),
  }));
}

function missingNodeClasses(info, classes) {
  return classes.filter((className) => !info?.[className]);
}

/**
 * Several packs ship nodes called SeedVR2-something with entirely different
 * class names. Reporting what is actually loaded turns "nodes missing" on a
 * machine that visibly has SeedVR2 into a diagnosis the user can act on.
 */
function detectedSeedVR2Nodes(info) {
  return Object.keys(info || {})
    .filter((name) => /seedvr2/i.test(name))
    .sort();
}

export function upscaleStatus(info = {}, quality = "balanced") {
  const normalized = normalizeQuality(quality);
  const missingNodes = missingNodeClasses(info, upscaleNodeClasses);
  const modelDir = seedvr2ModelDir();
  const have = available(info, modelDir);
  const models = requiredModelsFor(normalized, info, modelDir);
  const missingModels = models.filter((model) => !model.present);
  // A tier can still run on a weight the user already has, so only demand a
  // download when SeedVR2 has nothing at all to load.
  const canSubstitute = have.dit.length > 0 && have.vae.length > 0;
  return {
    quality: normalized,
    nodesInstalled: missingNodes.length === 0,
    missingNodes,
    detectedNodes: detectedSeedVR2Nodes(info),
    modelDir,
    remote: have.remote,
    canDownload: Boolean(modelDir),
    freeBytes: freeBytesAt(modelDir),
    models: models.map(({ key, file, label, detail, bytes, present, partialBytes }) => ({
      key,
      file,
      label,
      detail,
      bytes,
      present,
      partialBytes,
    })),
    missingModels: missingModels.map((model) => model.key),
    downloadBytes: missingModels.reduce((sum, model) => sum + model.bytes - model.partialBytes, 0),
    needsDownload: missingModels.length > 0 && !canSubstitute,
    substituting: missingModels.length > 0 && canSubstitute,
    // The weight a substituting tier actually loads, so the UI can name it.
    fallbackFile:
      missingModels.length > 0 && canSubstitute
        ? path.basename(resolveDit(normalized, have).file)
        : "",
    ready: missingNodes.length === 0 && (missingModels.length === 0 || canSubstitute),
    faceDetail: {
      nodesInstalled: missingNodeClasses(info, faceDetailNodeClasses).length === 0,
      missingNodes: missingNodeClasses(info, faceDetailNodeClasses),
      detectors: optionsFor(info, "UltralyticsDetectorProvider", "model_name").map(String),
      samModels: optionsFor(info, "SAMLoader", "model_name").map(String),
    },
  };
}

/* ------------------------------------------------------------------- sizing */

function roundTo(value, step = 16) {
  return Math.max(step, Math.round(value / step) * step);
}

/** The long sides the size menu's 2K and 4K reach. */
export const upscaleTargets = [2048, 4096];

/**
 * Works from whatever the source happens to be: the short side sets the target,
 * the pre-scale keeps the model input inside a sane VRAM budget, and the output
 * is capped so a very large source cannot queue an impossible job. A `target`
 * (the size menu's 2K/4K) is the long side to reach instead, whatever the scale.
 */
export function upscalePlan({ width, height, quality = "balanced", target = 0 }) {
  const normalized = normalizeQuality(quality);
  const preset = presets[normalized];
  const sourceWidth = Math.max(1, Math.round(Number(width) || 0));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 0));
  const shortSide = Math.min(sourceWidth, sourceHeight);
  const longSide = Math.max(sourceWidth, sourceHeight);
  const aspect = longSide / shortSide;
  const goal = upscaleTargets.includes(Number(target))
    ? roundTo((shortSide * Number(target)) / longSide)
    : Math.min(roundTo(shortSide * preset.targetScale), preset.maxShort);
  const resolution = Math.max(goal, roundTo(shortSide));
  // Never hand the model an input so small that it has nothing to restore.
  const preScale = Math.min(1, Math.max(preset.preScale, 256 / shortSide));
  return {
    quality: normalized,
    preScale: Number(preScale.toFixed(3)),
    resolution,
    maxResolution: Math.ceil(resolution * aspect),
    blocksToSwap: preset.blocksToSwap,
    tileSize: preset.tileSize,
    sourceWidth,
    sourceHeight,
    estimatedWidth: sourceWidth >= sourceHeight ? Math.round(resolution * aspect) : resolution,
    estimatedHeight: sourceWidth >= sourceHeight ? resolution : Math.round(resolution * aspect),
    scale: Number((resolution / shortSide).toFixed(2)),
  };
}

/* -------------------------------------------------------------------- graph */

/**
 * The model file and loader settings a face-detail pass re-runs. An image from
 * an imported workflow records the workflow ("custom:…") as its model, so the
 * file and the text encoder's type come from what the workflow actually loads.
 */
export function faceDetailSource(item, workflow = null) {
  const settings = { ...(item?.settings || {}) };
  const model = String(item?.model || "");
  if (!model.startsWith("custom:")) return { sourceModel: model, sourceSettings: settings };
  const defaults = workflow?.defaults || {};
  const file = String(settings.modelName || defaults.model || "");
  const family = file ? families[classifyModel("unet", file).family] : null;
  return {
    sourceModel: file,
    sourceSettings: {
      ...settings,
      textEncoder: settings.textEncoder || defaults.textEncoder || "",
      vae: settings.vae || defaults.vae || "",
      // What it recorded may be the "wan" stand-in for an unset type; the graph and the file know better.
      clipType: defaults.clipType || family?.clipType || settings.clipType || "",
      weightDtype: settings.weightDtype || defaults.weightDtype || "",
    },
  };
}

/**
 * Faces are redrawn on the source image, before SeedVR2, and only when they
 * are small. After the upscale a face is already past guide_size, and with
 * force_inpaint Impact resets the crop's scale to 1 after clamping it to
 * max_size, so the model sampled a crop several thousand pixels wide, far
 * beyond what it was trained on, and baked in heavy pores, freckles and
 * wrinkles. A close-up already drawn at the model's own size is skipped.
 */
function faceDetailStack(graph, body, imageSource, info) {
  const settings = body.sourceSettings || {};
  const model = String(body.sourceModel || "");
  const textEncoder = String(settings.textEncoder || "");
  const vae = String(settings.vae || "");
  if (!model || !textEncoder || !vae) {
    throw new Error(
      "Face detail needs the image’s model, text encoder and VAE, and this image doesn’t record them.",
    );
  }
  const unets = optionsFor(info, "UNETLoader", "unet_name").map(String);
  if (unets.length && !unets.includes(model)) {
    throw new Error(
      `Face detail needs this image’s model, ${model}, and ComfyUI doesn’t have it. Turn off face detail to upscale this image.`,
    );
  }
  const detector = optionsFor(info, "UltralyticsDetectorProvider", "model_name").find((name) =>
    /face/i.test(String(name)),
  );
  if (!detector)
    throw new Error("Face detail needs an Ultralytics face detector model for the Impact Pack.");
  const sam = optionsFor(info, "SAMLoader", "model_name")
    .map(String)
    .find((name) => name && name !== "None");
  graph["10"] = {
    class_type: "UNETLoader",
    inputs: { unet_name: model, weight_dtype: String(settings.weightDtype || "default") },
  };
  graph["11"] = {
    class_type: "CLIPLoader",
    inputs: { clip_name: textEncoder, type: String(settings.clipType || "wan"), device: "default" },
  };
  graph["12"] = { class_type: "VAELoader", inputs: { vae_name: vae } };
  graph["13"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: String(body.prompt || ""), clip: ["11", 0] },
  };
  graph["14"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["13", 0] } };
  graph["15"] = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: detector } };
  if (sam)
    graph["16"] = { class_type: "SAMLoader", inputs: { model_name: sam, device_mode: "AUTO" } };
  graph["17"] = {
    class_type: "FaceDetailer",
    inputs: {
      image: imageSource,
      model: ["10", 0],
      clip: ["11", 0],
      vae: ["12", 0],
      positive: ["13", 0],
      negative: ["14", 0],
      bbox_detector: ["15", 0],
      ...(sam ? { sam_model_opt: ["16", 0] } : {}),
      guide_size: 1024,
      guide_size_for: true,
      max_size: 1024,
      seed: Number(body.seed || crypto.randomInt(1, 2 ** 31)),
      steps: Number(settings.steps || 4),
      cfg: Number(settings.cfg || 1),
      sampler_name: String(settings.sampler || "er_sde"),
      scheduler: String(settings.scheduler || "simple"),
      denoise: 0.3,
      feather: 5,
      noise_mask: true,
      force_inpaint: false,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3,
      sam_detection_hint: "center-1",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      wildcard: "",
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    },
  };
  return ["17", 0];
}

/**
 * A combo's choices wherever the node declares it. SeedVR2 makes
 * offload_device optional, and ComfyUI rejects any value outside the list,
 * so reading only the required inputs sent "cpu" to a Mac that offers
 * ["none", "mps"].
 */
function comboOptions(info, nodeClass, key) {
  const required = optionsFor(info, nodeClass, key);
  if (required.length) return required.map(String);
  const input = info?.[nodeClass]?.input?.optional?.[key];
  if (!Array.isArray(input)) return [];
  if (Array.isArray(input[0])) return input[0].map(String);
  if (Array.isArray(input[1]?.options)) return input[1].options.map(String);
  return [];
}

/**
 * The loaders list the devices this machine actually has (cuda:N, mps) and
 * whether a separate offload device exists. Block swapping needs one, and on
 * Apple silicon there is none, so it switches off there instead of failing.
 */
function devicesFor(info, nodeClass) {
  const devices = comboOptions(info, nodeClass, "device");
  const offloads = comboOptions(info, nodeClass, "offload_device");
  const device =
    devices.find((name) => name !== "none" && name !== "cpu") || devices[0] || "cuda:0";
  const offload = offloads.length
    ? offloads.includes("cpu") && device !== "cpu"
      ? "cpu"
      : "none"
    : "cpu";
  return { device, offload };
}

export function upscaleGraph(body, info = {}) {
  const plan = upscalePlan(body);
  const have = available(info, seedvr2ModelDir());
  const dit = resolveDit(plan.quality, have);
  const vae = resolveVae(have);
  if (dit.missing || vae.missing) throw new Error("The SeedVR2 models aren’t installed yet.");
  const ditDevices = devicesFor(info, "SeedVR2LoadDiTModel");
  const vaeDevices = devicesFor(info, "SeedVR2LoadVAEModel");
  const swap = ditDevices.offload !== "none";
  const graph = {};
  graph["1"] = { class_type: "LoadImage", inputs: { image: String(body.imageName || "") } };
  const video = body.mediaType === "video";
  if (video) {
    graph["1"] = { class_type: "LoadVideo", inputs: { file: String(body.imageName || "") } };
    graph["6"] = { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } };
  }
  const source = video
    ? ["6", 0]
    : body.faceDetail
      ? faceDetailStack(graph, body, ["1", 0], info)
      : ["1", 0];
  Object.assign(graph, {
    2: {
      class_type: "ImageScaleBy",
      inputs: { image: source, upscale_method: "bicubic", scale_by: plan.preScale },
    },
    3: {
      class_type: "SeedVR2LoadDiTModel",
      inputs: {
        model: dit.file,
        device: ditDevices.device,
        blocks_to_swap: swap ? plan.blocksToSwap : 0,
        swap_io_components: swap,
        offload_device: ditDevices.offload,
        cache_model: false,
        attention_mode: "sdpa",
      },
    },
    4: {
      class_type: "SeedVR2LoadVAEModel",
      inputs: {
        model: vae.file,
        device: vaeDevices.device,
        encode_tiled: true,
        encode_tile_size: plan.tileSize,
        encode_tile_overlap: 128,
        decode_tiled: true,
        decode_tile_size: plan.tileSize,
        decode_tile_overlap: 128,
        tile_debug: "false",
        offload_device: vaeDevices.offload,
        cache_model: false,
      },
    },
    5: {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        image: ["2", 0],
        dit: ["3", 0],
        vae: ["4", 0],
        seed: Number(body.seed || crypto.randomInt(1, 2 ** 31)),
        resolution: plan.resolution,
        max_resolution: plan.maxResolution,
        batch_size: video ? 5 : 1,
        uniform_batch_size: false,
        // LAB can corrupt SeedVR2 output on AMD GPUs despite a successful run.
        color_correction: "wavelet",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: 0,
        latent_noise_scale: 0,
        offload_device: devicesFor(info, "SeedVR2VideoUpscaler").offload,
        enable_debug: false,
      },
    },
  });
  if (video) {
    graph["7"] = {
      class_type: "CreateVideo",
      inputs: { images: ["5", 0], audio: ["6", 1], fps: ["6", 2], codec: "none" },
    };
    graph["9"] = {
      class_type: "SaveVideo",
      inputs: {
        video: ["7", 0],
        filename_prefix: `${outputFolderName}/upscale`,
        format: "mp4",
        "format.codec": "h264",
      },
    };
  } else {
    graph["9"] = {
      class_type: "SaveImage",
      inputs: { images: ["5", 0], filename_prefix: `${outputFolderName}/upscale` },
    };
  }
  // The weight it runs on, which is what its timing is learned by (upscale-timing.js).
  return { graph, plan: { ...plan, model: dit.file } };
}

/** A link inside the upscale's own graph, renamed into the run's graph; its LoadImage becomes `source`. */
function relink(value, prefix, source) {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    Number.isInteger(value[1])
  ) {
    return value[0] === "1" ? source : [`${prefix}${value[0]}`, value[1]];
  }
  return value;
}

/**
 * Smart upscale inside a run's own graph: SeedVR2 takes the decoded picture
 * straight from each save node, so it upscales the moment the picture exists,
 * in the same ComfyUI prompt, before any run queued behind it can start. The
 * save node stays where it is (ComfyUI runs output nodes first), so a stopped
 * or failed upscale still leaves the picture at its generated size on disk.
 * Returns the new graph and which save each upscale belongs to, or null when
 * the graph saves no image.
 */
export function embedUpscale(graph, body, info = {}, { phase = "" } = {}) {
  const saves = Object.entries(graph || {}).filter(
    ([, node]) => node?.class_type === "SaveImage" && Array.isArray(node.inputs?.images),
  );
  if (!saves.length) return null;
  const next = { ...graph };
  const pairs = [];
  let plan = null;
  saves.forEach(([saveId, save], index) => {
    const prefix = `studio_up${index}_`;
    const built = upscaleGraph({ ...body, imageName: "" }, info);
    plan = built.plan;
    for (const [id, node] of Object.entries(built.graph)) {
      if (id === "1") continue;
      const inputs = Object.fromEntries(
        Object.entries(node.inputs || {}).map(([key, value]) => [
          key,
          relink(value, prefix, save.inputs.images),
        ]),
      );
      next[`${prefix}${id}`] = {
        ...node,
        inputs,
        _meta: {
          title: "Smart upscale",
          studioUpscale: true,
          ...(phase ? { studioPhase: phase } : {}),
        },
      };
    }
    pairs.push({ base: saveId, upscale: `${prefix}9` });
  });
  return { graph: next, pairs, plan };
}

/** Stage the original local video; the gallery keeps its audio and frame rate. */
export async function uploadUpscaleVideoSource(item) {
  const url = new URL(String(item.url || ""), "http://localhost");
  if (url.pathname !== "/comfy/view")
    throw new Error("The original video is not a ComfyUI output.");
  const name = url.searchParams.get("filename") || "";
  const file = localOutputFile(
    name,
    url.searchParams.get("subfolder") || "",
    url.searchParams.get("type") || "output",
  );
  if (!file) throw new Error("The original video file is missing.");
  const extension = path.extname(name).toLowerCase();
  if (![".mp4", ".webm", ".mov", ".mkv", ".m4v"].includes(extension))
    throw new Error("Unsupported video format.");
  const buffer = fs.readFileSync(file);
  const filename = `studio-upscale-${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32)}${extension}`;
  const form = new FormData();
  form.append("image", new Blob([buffer]), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return uploaded.name || filename;
}
