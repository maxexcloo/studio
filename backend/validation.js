import { loraDefaultStrength, maxLoras } from "../shared/profiles.ts";
import { isResolution } from "../shared/resolution.ts";
import { missingNodes, nodeRange, optionsFor } from "./comfy/comfy.js";
import { getCustomWorkflow } from "./custom-workflows.js";
import { optionalLoraPolicyIssue } from "./lora/catalogue.js";
import { catalogueLoraInfo } from "./lora/info.js";
import { keptTriggers, recommendedNegative } from "./lora/prompts.js";
import { inferModels } from "./model/models.js";
import { radianceImageFits } from "./providers/radiance.ts";
import { hasReferenceImage, resolveImageMode } from "./workflow-modes.js";

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : -Number.MAX_SAFE_INTEGER;
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(number)) return safeFallback;
  return Math.max(safeMin, Math.min(safeMax, number));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function snapNumber(value, fallback, range = {}) {
  const step = Number(range.step || 1) || 1;
  const min = Number.isFinite(Number(range.min)) ? Number(range.min) : -Number.MAX_SAFE_INTEGER;
  const max = Number.isFinite(Number(range.max)) ? Number(range.max) : Number.MAX_SAFE_INTEGER;
  const base = clampNumber(value, fallback, min, max);
  // Steps count from the minimum, as ComfyUI's own inputs do (H3: 124, 141, … 345).
  const offset = Number(range.offset ?? (Number.isFinite(Number(range.min)) ? range.min : 0));
  // Rounded to the step's and offset's decimals, dropping float noise (0.6, not 0.6000000000000085).
  const places = Math.max(...[step, offset].map((n) => String(n).split(".")[1]?.length ?? 0));
  const snapped = Number((Math.round((base - offset) / step) * step + offset).toFixed(places));
  return Math.max(min, Math.min(max, snapped));
}

function snapInteger(value, fallback, range = {}) {
  return Math.round(snapNumber(value, fallback, range));
}

/** Video frames the worker can't render are refused, never moved to the nearest length it can. */
function videoFrames(value, range = {}) {
  if (value === undefined || value === null || value === "")
    return snapInteger(value, range.default, range);
  const frames = Number(value);
  const { min = 1, max = Number.MAX_SAFE_INTEGER, step = 1 } = range;
  const offset = Number(range.offset ?? min);
  if (!Number.isInteger(frames) || frames < min || frames > max || (frames - offset) % step)
    throw new Error(
      step > 1
        ? `Frames must be from ${min} to ${max} in steps of ${step}.`
        : `Frames must be from ${min} to ${max}.`,
    );
  return frames;
}

function ensureOption(info, node, key, value, label) {
  const selected = String(value || "");
  if (!selected) throw new Error(`${label} is required for this workflow.`);
  const options = optionsFor(info, node, key);
  if (options.length && !options.includes(selected)) {
    throw new Error(`${label} “${selected}” isn't available in ComfyUI.`);
  }
}

function sanitizeLoras(
  input = {},
  info = {},
  profile = null,
  kind = "image",
  { limit = maxLoras, adapter } = {},
) {
  if (!profile?.capabilities?.lora) return [];
  const raw = Array.isArray(input.loras) ? input.loras : [];
  const installed = optionsFor(info, "LoraLoader", "lora_name");
  if (!installed.length) {
    if (raw.some((item) => item?.enabled !== false && item?.name))
      throw new Error(
        "The worker has no LoRA inventory. Rescan models before submitting this stack.",
      );
    return [];
  }
  const strengthRange = nodeRange(info, "LoraLoader", "strength_model", {
    default: 0.7,
    min: -100,
    max: 100,
    step: 0.01,
  });
  const sanitized = [];
  // Disabled entries don't take a slot: apply the workflow's limit to enabled LoRAs only.
  for (const item of raw.filter((entry) => entry && entry.enabled !== false).slice(0, limit)) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    if (!installed.includes(name)) throw new Error(`LoRA “${name}” isn't available in ComfyUI.`);
    const loraInfo = catalogueLoraInfo(name);
    const fallback = loraDefaultStrength(loraInfo);
    const strength = loraInfo?.strengthRange
      ? clampNumber(item.strength, fallback, strengthRange.min, strengthRange.max)
      : snapNumber(item.strength, fallback, strengthRange);
    const issue = optionalLoraPolicyIssue({ name, strength }, loraInfo, {
      ...profile,
      loraAdapter: adapter,
    });
    if (issue) throw new Error(issue);
    const words =
      Array.isArray(item.triggers) && item.triggers.every((word) => typeof word === "string");
    if (item.triggers !== undefined && typeof item.triggers !== "boolean" && !words)
      throw new Error(`LoRA “${name}” needs Trigger Words on, off or a list of words.`);
    sanitized.push({ name, enabled: true, strength, ...keptTriggers(item.triggers) });
  }
  return sanitized;
}

/**
 * A painted mask on the first reference: only for a profile that can inpaint,
 * with a reference to paint on. The mask itself is checked when it is read
 * (inpaint.js); here only its shape and the two settings.
 */
function sanitizeInpaint(input, profile, referenceAssets) {
  const mask = String(input.inpaint?.mask || "");
  if (!mask || !profile.capabilities.inpaint || !referenceAssets.length) return null;
  if (!mask.startsWith("data:image/png;base64,"))
    throw new Error("The painted mask didn't come through. Paint it again.");
  const strength = Number(input.inpaint.strength);
  const feather = Number(input.inpaint.feather);
  return {
    mask,
    strength: Number.isFinite(strength)
      ? Math.round(Math.min(1, Math.max(0.05, strength)) * 100) / 100
      : 1,
    feather: Number.isFinite(feather) ? Math.min(1, Math.max(0, feather)) : 0.4,
  };
}

export function validateReferenceSlots(references, profile) {
  const slots = profile.mediaInputs || [];
  // Plain img2img advertises one start image through its capability rather than named slots.
  if (!slots.length && profile.capabilities?.startImage) {
    if (references.length > 1) throw new Error("The selected profile accepts at most 1 image.");
    return;
  }
  for (const reference of references) {
    if (!slots.some((slot) => slot.id === reference.slot))
      throw new Error(`The selected profile does not accept reference slot "${reference.slot}".`);
  }
  for (const slot of slots) {
    const supplied = references.filter((reference) => reference.slot === slot.id).length;
    const minimum = Number(slot.min || (slot.required ? 1 : 0));
    const maximum = Number(slot.max || 1);
    if (supplied < minimum)
      throw new Error(`${slot.label || "Reference image"} is required for this workflow.`);
    if (supplied > maximum)
      throw new Error(
        `${slot.label || "Reference image"} accepts at most ${maximum} image${maximum === 1 ? "" : "s"}.`,
      );
  }
}

/** The models a workflow's model input takes on the worker. */
const listedModels = (info, workflow) => {
  const control = workflow.controls?.model;
  return optionsFor(info, workflow.graph?.[control?.node]?.class_type, control?.input);
};

/**
 * The two-GPU copy a run of three or more pictures may take on Radiance where the worker lists
 * one: the model's `-fast` twin, or the `-refs` one for Qwen and Noct. A run with LoRAs keeps its
 * stack's model, and one already on `-refs` has no further twin.
 */
export function fastTwin(body, info) {
  if (body.kind !== "image" || body.count < 3 || body.loras?.length) return "";
  const workflow = resolveImageMode(
    getCustomWorkflow(body.workflow, body.profileBackend) || {},
    body,
  );
  const models = listedModels(info, workflow);
  return (
    [`${body.modelName}-fast`, `${body.modelName}-refs`].find((name) => models.includes(name)) || ""
  );
}

export function sanitizeGenerateBody(
  input = {},
  info = {},
  stats = {},
  prompting = (profile) => profile.prompting,
) {
  const kind = input.kind === "video" ? "video" : "image";
  const workflow = String(input.workflow || "");
  const installed = workflow.startsWith("custom:")
    ? getCustomWorkflow(workflow, input.profileBackend)
    : null;
  const customWorkflow = installed && resolveImageMode(installed, input);
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Enter a prompt.");
  if (!String(input.model || "").trim()) throw new Error("Choose a supported model first.");
  if (!customWorkflow) throw new Error("There's no workflow for this model.");
  if (kind !== customWorkflow.kind) throw new Error(`The selected model isn't a ${kind} workflow.`);
  const referenceAssets = Array.isArray(input.referenceAssets)
    ? input.referenceAssets
        .map((item) => {
          const slot =
            String(item?.slot || "reference")
              .replace(/[^a-z0-9._-]/gi, "")
              .slice(0, 80) || "reference";
          // A strength only where the slot maps one (a guiding role), within its range.
          const range = customWorkflow.mediaInputs?.find((input) => input.id === slot)?.strength;
          return {
            slot,
            assetId: String(item?.assetId || "").slice(0, 2048),
            source: String(item?.source || "").slice(0, 40),
            ...(range && item?.strength != null && item.strength !== ""
              ? { strength: snapNumber(item.strength, range.default, range) }
              : {}),
          };
        })
        .filter((item) => item.assetId)
    : [];
  validateReferenceSlots(referenceAssets, customWorkflow);
  const missing = missingNodes(info, customWorkflow.requiredNodes);
  if (missing.length)
    throw new Error(`ComfyUI is missing nodes this model needs: ${missing.join(", ")}`);
  const profiles =
    inferModels(info, stats, {
      profileBackends: installed?.backend ? { [workflow]: installed.backend } : {},
    }).profiles || [];
  const available = profiles.find(
    (item) => item.kind === kind && item.workflow === workflow && item.model === input.model,
  );
  const selected = available?.imageModes?.[hasReferenceImage(input) ? "reference" : "generate"];
  // A mode leaves out (undefined or "") what its graph lacks, so the profile's own default shows through.
  const profile = available && {
    ...available,
    ...selected,
    defaults: {
      ...available.defaults,
      ...Object.fromEntries(
        Object.entries(selected?.defaults || {}).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    },
  };
  if (!profile) throw new Error("The worker doesn't list this model. Rescan models and try again.");
  if (
    customWorkflow?.controls?.model?.node &&
    customWorkflow?.controls?.model?.input &&
    (input.modelName || customWorkflow.defaults?.model)
  ) {
    const classType = customWorkflow.graph?.[customWorkflow.controls.model.node]?.class_type;
    ensureOption(
      info,
      classType,
      customWorkflow.controls.model.input,
      input.modelName || customWorkflow.defaults.model,
      "Model",
    );
  }
  // A run without its own, such as one references moved off a text-only backend, takes the profile's.
  const textEncoder = String(input.textEncoder || customWorkflow.defaults?.textEncoder || "");
  const vae = String(input.vae || customWorkflow.defaults?.vae || "");
  if (customWorkflow.capabilities?.textEncoder) {
    ensureOption(info, "CLIPLoader", "clip_name", textEncoder, "Text encoder");
  }
  if (customWorkflow.capabilities?.vae) {
    ensureOption(info, "VAELoader", "vae_name", vae, "VAE");
  }
  if (input.sampler) ensureOption(info, "KSampler", "sampler_name", input.sampler, "Sampler");
  if (input.scheduler) ensureOption(info, "KSampler", "scheduler", input.scheduler, "Scheduler");

  const latentNode = "EmptyLatentImage";
  const widthRange = nodeRange(info, latentNode, "width", {
    default: kind === "video" ? 512 : 1024,
    min: 16,
    max: 16384,
  });
  const heightRange = nodeRange(info, latentNode, "height", {
    default: kind === "video" ? 288 : 1024,
    min: 16,
    max: 16384,
  });
  const countRange = nodeRange(info, latentNode, "batch_size", { default: 1, min: 1, max: 8 });
  // Imported workflows can bind these controls to different nodes or fix their frame rate.
  const frameRange = customWorkflow
    ? profile.constraints.frames
    : nodeRange(info, latentNode, "length", { default: 33, min: 1, max: 16384 });
  const fpsRange = customWorkflow
    ? { default: profile.defaults.fps || 16, ...profile.constraints.fps }
    : nodeRange(info, "CreateVideo", "fps", { default: 16, min: 1, max: 120 });
  const stepsRange = nodeRange(info, "KSampler", "steps", {
    default: kind === "video" ? 12 : 8,
    min: 1,
    max: 10000,
  });
  const cfgRange = nodeRange(info, "KSampler", "cfg", {
    default: kind === "video" ? 5 : 1,
    min: 0,
    max: 100,
  });
  const denoiseRange = nodeRange(info, "KSampler", "denoise", { default: 1, min: 0, max: 1 });
  // A missing value takes the profile's default, never ComfyUI's generic node default (CFG 8, denoise 1).
  const fallback = (key, range) => profile.defaults[key] ?? range.default;

  const resolutions = profile.options.resolutions || [];
  const resolution = profile.capabilities.resolution
    ? String(input.resolution || profile.defaults.resolution || "")
    : "";
  if (profile.capabilities.resolution && !resolutions.includes(resolution))
    throw new Error("Choose a supported resolution for this model.");
  const rebalance = profile.capabilities.rebalance
    ? String(input.rebalance || profile.defaults.rebalance || "")
    : "";
  if (rebalance && !profile.options.rebalances?.includes(rebalance))
    throw new Error("Choose a supported rebalance for this model.");
  const loras = sanitizeLoras(input, info, profile, kind, {
    limit: customWorkflow?.loraStack?.max,
    adapter: customWorkflow?.loraStack?.adapter,
  });
  // A run with LoRAs moves to the stack's own model, which graphs.js sends and the item records;
  // otherwise a size and references one card can't hold move to its `-refs` twin where the worker has one.
  const model = String(input.modelName || customWorkflow?.defaults?.model || "");
  const models = listedModels(info, customWorkflow);
  const twin = `${model}-refs`;
  const width = snapInteger(input.width, fallback("width", widthRange), widthRange);
  const height = snapInteger(input.height, fallback("height", heightRange), heightRange);
  const crowded = !radianceImageFits(model, width, height, referenceAssets.length);
  const modelName =
    (loras.length && customWorkflow.loraStack?.model) ||
    (crowded && models.includes(twin) ? twin : model);
  const cfg =
    profile.capabilities?.cfg === false
      ? undefined
      : snapNumber(input.cfg, fallback("cfg", cfgRange), cfgRange);
  const negative =
    String(input.negative || "").trim() ||
    recommendedNegative(prompting(profile), {
      cfg,
      takesNegative: profile.capabilities?.negativePrompt !== false,
      stack: loras,
      infos: Object.fromEntries(loras.map(({ name }) => [name, catalogueLoraInfo(name)])),
    });
  return {
    ...input,
    kind,
    workflow,
    prompt,
    negative: String(input.negative || "").trim() ? String(input.negative) : negative,
    model: String(input.model || ""),
    modelName,
    textEncoder,
    vae,
    clipType: String(input.clipType || ""),
    weightDtype: String(input.weightDtype || "default"),
    width,
    height,
    // A fixed-step profile (capabilities.steps false) keeps its graph's own steps, as with CFG.
    steps:
      profile.capabilities?.steps === false
        ? undefined
        : snapInteger(input.steps, fallback("steps", stepsRange), stepsRange),
    // A profile without CFG (distilled; capabilities.cfg false) keeps its graph's own guidance, so none is taken or recorded.
    cfg,
    denoise: snapNumber(input.denoise, fallback("denoise", denoiseRange), denoiseRange),
    sampler: String(input.sampler || ""),
    scheduler: String(input.scheduler || ""),
    seed: String(input.seed || ""),
    count:
      customWorkflow.capabilities?.variations === false
        ? 1
        : snapInteger(input.count, countRange.default, countRange),
    ...(input.variationCount !== undefined
      ? {
          variationCount:
            kind === "image" && customWorkflow.capabilities?.variations !== false
              ? clampInteger(input.variationCount, 1, 1, 8)
              : 1,
        }
      : {}),
    duration: profile.capabilities.duration
      ? snapInteger(input.duration, profile.defaults.duration, profile.constraints.duration)
      : 0,
    resolution,
    rebalance,
    // A model that makes sound (Grok Imagine Video 1.5) can be asked for a silent video.
    ...(profile.capabilities.sound && input.sound === false ? { sound: false } : {}),
    // Radiance's Qwen draws a transparent background where asked.
    ...(profile.capabilities.transparent && input.transparent === true
      ? { transparent: true }
      : {}),
    // The size tier the run's width and height came from (shared/resolution.ts), kept for reuse.
    ...(isResolution(input.resolutionTier) ? { resolutionTier: input.resolutionTier } : {}),
    frames: kind === "video" ? videoFrames(input.frames, frameRange) : 0,
    fps: snapInteger(input.fps, fpsRange.default, fpsRange),
    referenceAssets,
    autoResizeInputs: input.autoResizeInputs !== false,
    inpaint: sanitizeInpaint(input, available, referenceAssets),
    // "reference": the first reference guides the picture but doesn't frame it; the picked size does.
    // A painted mask is an edit of that image, so it keeps the image's framing.
    referenceRole: input.referenceRole === "reference" && !input.inpaint ? "reference" : "edit",
    // 2K draws and a retry after the GPU ran out of memory decode in tiles, where ComfyUI has the node.
    tiledDecode: Boolean(input.tiledDecode) && Boolean(info.VAEDecodeTiled),
    promptPolicy: customWorkflow.promptComposition
      ? {
          policy: customWorkflow.promptComposition.policy,
          version: customWorkflow.promptComposition.version,
        }
      : null,
    loras,
  };
}
