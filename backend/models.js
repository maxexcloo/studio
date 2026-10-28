import { missingNodes, nodeRange, optionsFor, textRange } from "./comfy.js";
import {
  loadCustomWorkflows,
  profileBackendLabels,
  usesGrokMedia,
  workflowOnBackend,
  workflowOptionIssues,
} from "./custom-workflows.js";
import { classifyModel } from "./model-families.js";
import { families } from "./family-catalog.js";
import { canonicalProfileId } from "./profile-store.js";
import { inpaintingEnabled, lorasEnabled, presetsEnabled } from "./features.js";
import { imageSaves, inpaintNodes } from "./inpaint.js";

function modelBasename(name = "") {
  return String(name).split(/[\\/]/).pop() || name;
}

function snapDimension(value, meta = {}) {
  const step = Number(meta.step || 1) || 1;
  const min = Number(meta.min || step) || step;
  const max = Number(meta.max || 16384) || 16384;
  const snapped = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

function detectedDefault(meta = {}, fallback) {
  const value = Number(meta.default);
  return Number.isFinite(value) ? value : fallback;
}

function aspectSet(defaults, ratios, ranges = {}) {
  const defaultArea = Math.max(1, Number(defaults.width || 1024) * Number(defaults.height || 1024));
  const seen = new Set();
  return ratios
    .map(([label, ratioW, ratioH]) => {
      const scale = Math.sqrt(defaultArea / Math.max(1, ratioW * ratioH));
      const w = snapDimension(ratioW * scale, ranges.width);
      const h = snapDimension(ratioH * scale, ranges.height);
      const value = `${w}x${h}`;
      if (seen.has(value)) return null;
      seen.add(value);
      return { label, value, w, h, default: w === defaults.width && h === defaults.height };
    })
    .filter(Boolean);
}

function customAspectSet(defaults, ratios = [], ranges = {}) {
  if (!Array.isArray(ratios) || !ratios.length)
    return aspectSet(
      defaults,
      [
        ["1:1", 1, 1],
        ["16:9", 16, 9],
        ["9:16", 9, 16],
        ["4:3", 4, 3],
        ["3:4", 3, 4],
      ],
      ranges,
    );
  return ratios.map((item) => {
    if (Array.isArray(item)) return item;
    return [item.label || item.value || "Custom", Number(item.w || 1), Number(item.h || 1)];
  }).length
    ? aspectSet(
        defaults,
        ratios.map((item) =>
          Array.isArray(item)
            ? item
            : [item.label || item.value || "Custom", Number(item.w || 1), Number(item.h || 1)],
        ),
        ranges,
      )
    : [];
}

export function buildProfile({
  id,
  kind,
  label,
  displayName,
  description,
  model,
  baseModel,
  workflow,
  family,
  defaults,
  aspects,
  aspectDefault = "",
  options = {},
  capabilities = {},
  constraints = {},
  mediaInputs = [],
  aspectPolicy = "manual",
  maxLoras = 8,
  imageModes: modes = {},
  native = {},
  recipe,
  prompting,
  uncensored = false,
  aiDrafted = false,
  backend = "",
  backendOptions = [],
}) {
  // A mode overrides only these: a mode's own id, media slots or graph must never replace the profile's.
  const imageModes = Object.fromEntries(
    Object.entries(modes).map(([name, mode]) => [
      name,
      {
        capabilities: mode.capabilities,
        defaults: mode.defaults,
        ...(mode.prompting ? { prompting: mode.prompting } : {}),
      },
    ]),
  );
  return {
    id,
    kind,
    label,
    // A combined profile: the backend it runs on now and each one it can run on, with whether it is ready.
    ...(backend ? { backend, backendOptions } : {}),
    ...(uncensored === true ? { uncensored: true } : {}),
    // Drafted by the assistant and not yet reviewed: administrators only (account-policy.js).
    ...(aiDrafted === true ? { aiDrafted: true } : {}),
    displayName: displayName || label,
    description: description || modelBasename(model),
    ...((imageModes.generate?.prompting ?? prompting)
      ? { prompting: structuredClone(imageModes.generate?.prompting ?? prompting) }
      : {}),
    model,
    // The weights file it runs, so switching workflows on the same file can keep its LoRAs.
    baseModel: baseModel ?? modelBasename(model),
    workflow,
    family,
    ...(recipe &&
    typeof recipe.modelLabel === "string" &&
    typeof recipe.label === "string" &&
    typeof recipe.conditioning === "string"
      ? {
          recipe: {
            modelLabel: recipe.modelLabel,
            label: recipe.label,
            conditioning: recipe.conditioning,
            adapters: Array.isArray(recipe.adapters)
              ? recipe.adapters.filter((name) => typeof name === "string")
              : [],
          },
        }
      : {}),
    defaults: { ...defaults, ...imageModes.generate?.defaults },
    aspectPresets: aspects,
    // A preset the family starts on where its own size is not square (MiniMax H3's 16:9).
    ...(aspectDefault ? { aspectDefault } : null),
    options,
    constraints,
    ...(Object.keys(imageModes).length ? { imageModes } : {}),
    mediaInputs,
    aspectPolicy: aspectPolicy === "reference" ? "reference" : "manual",
    // Whether the model draws 2K/4K itself, per size: "yes" or "maybe" (family catalog); {} for anything else.
    native:
      kind === "image"
        ? Object.fromEntries(
            Object.entries(native || {}).filter(
              ([size, level]) => ["2k", "4k"].includes(size) && ["yes", "maybe"].includes(level),
            ),
          )
        : {},
    // How many LoRAs the workflow's loader accepts (rgthree stacks take 4).
    maxLoras: Math.max(1, Math.min(8, Number(maxLoras) || 8)),
    capabilities: {
      prompt: true,
      negativePrompt: kind === "image",
      steps: true,
      seed: true,
      cfg: true,
      sampler: true,
      scheduler: true,
      variations: kind === "image",
      frames: kind === "video",
      fps: kind === "video",
      textEncoder: false,
      vae: false,
      clipType: false,
      weightDtype: false,
      startImage: false,
      denoise: false,
      ...capabilities,
      ...imageModes.generate?.capabilities,
    },
  };
}

/**
 * The size step an imported workflow's model needs. A latent node may accept any
 * multiple of 8 while the model itself needs 16 or 32 (Qwen Image 2.1): an
 * off-step size is silently cut by ComfyUI and can come out mangled.
 */
export function workflowFamilyStep(workflow) {
  return workflowFamilyValue(workflow, "sizeStep") || 0;
}

/** A family catalogue value for an imported workflow: its declared family's, else its model file's family's. */
export function workflowFamilyValue(workflow, key) {
  const own = families[workflow.family]?.[key];
  if (own) return own;
  for (const node of Object.values(workflow.graph || {})) {
    for (const [input, source] of [
      ["unet_name", "unet"],
      ["ckpt_name", "checkpoint"],
    ]) {
      const name = node?.inputs?.[input];
      if (typeof name !== "string" || !name) continue;
      try {
        const value = families[classifyModel(source, name)?.family]?.[key];
        if (value) return value;
      } catch {
        /* unknown file: no family value */
      }
    }
  }
  return undefined;
}

/** A width or height range on the stricter of the node's and the model family's steps. */
export function sizedRange(range, familyStep) {
  const step = Math.max(Number(range.step) || 1, familyStep || 0);
  if (step === range.step) return range;
  const onStep = (value) => Math.max(step, Math.round(Number(value) / step) * step);
  return {
    ...range,
    step,
    ...(range.default ? { default: onStep(range.default) } : {}),
    ...(range.min ? { min: Math.max(step, Math.ceil(range.min / step) * step) } : {}),
  };
}

/**
 * `profileBackends` (`{"custom:<id>": backend}`) builds those combined profiles on another of their
 * backends, as a run that asked for it validates against.
 */
export function inferModels(
  info,
  stats = {},
  { configuredOnly = false, profileBackends = {} } = {},
) {
  const missingCoreImageNodes = missingNodes(info, [
    "KSampler",
    "CLIPTextEncode",
    "VAEDecode",
    "SaveImage",
  ]);
  if (!configuredOnly && missingCoreImageNodes.length) {
    return emptyModelResult({
      reason: `ComfyUI is missing required image nodes: ${missingCoreImageNodes.join(", ")}`,
    });
  }
  const clips = optionsFor(info, "CLIPLoader", "clip_name");
  const clipTypes = optionsFor(info, "CLIPLoader", "type");
  const vaes = optionsFor(info, "VAELoader", "vae_name");
  const samplers = optionsFor(info, "KSampler", "sampler_name");
  const schedulers = optionsFor(info, "KSampler", "scheduler");
  const weightDtypes = optionsFor(info, "UNETLoader", "weight_dtype");
  const loras = lorasEnabled ? optionsFor(info, "LoraLoader", "lora_name") : [];
  const textMeta = textRange(info, "CLIPTextEncode", "text");
  const samplerRange = {
    steps: nodeRange(info, "KSampler", "steps", { default: 20, min: 1, max: 10000, step: 1 }),
    cfg: nodeRange(info, "KSampler", "cfg", { default: 8, min: 0, max: 100, step: 0.1 }),
    denoise: nodeRange(info, "KSampler", "denoise", { default: 1, min: 0, max: 1, step: 0.01 }),
  };
  const profiles = [];

  // Why a workflow can't run on this worker, in words; "" when it can.
  const unready = (workflow) => {
    const missing = missingNodes(info, workflow.requiredNodes);
    return missing.length
      ? `missing ${missing.join(", ")} on this worker`
      : workflowOptionIssues(workflow, info).join(" ");
  };
  for (const listed of loadCustomWorkflows()) {
    const workflow = workflowOnBackend(listed, profileBackends[listed.profileId]);
    if (usesGrokMedia(workflow)) continue;
    // A combined profile lists while any of its backends could run here; its own backend not being
    // ready shows as Needs Setup with the reason, never as a quiet switch to the other one.
    const backendOptions = (workflow.backendIds || []).map((id) => {
      const reason = configuredOnly ? "" : unready(workflowOnBackend(listed, id));
      return {
        id,
        label: profileBackendLabels[id] || id,
        ...(configuredOnly ? {} : { ready: !reason }),
        ...(reason ? { reason } : {}),
      };
    });
    const reason = configuredOnly ? "" : unready(workflow);
    if (reason && !backendOptions.some((option) => option.ready)) continue;
    const defaults = workflow.defaults || {};
    const controls = workflow.controls || {};
    const familyStep = workflowFamilyStep(workflow);
    const widthRange = controls.width
      ? sizedRange(
          nodeRange(info, workflow.graph?.[controls.width.node]?.class_type, controls.width.input, {
            default: Number(defaults.width || 1024),
            min: 16,
            max: 16384,
            step: 8,
          }),
          familyStep,
        )
      : {};
    const heightRange = controls.height
      ? sizedRange(
          nodeRange(
            info,
            workflow.graph?.[controls.height.node]?.class_type,
            controls.height.input,
            { default: Number(defaults.height || 1024), min: 16, max: 16384, step: 8 },
          ),
          familyStep,
        )
      : {};
    const countRange = controls.count
      ? nodeRange(info, workflow.graph?.[controls.count.node]?.class_type, controls.count.input, {
          default: Number(defaults.count || 1),
          min: 1,
          max: 4096,
          step: 1,
        })
      : {};
    const frameRange = controls.frames
      ? nodeRange(info, workflow.graph?.[controls.frames.node]?.class_type, controls.frames.input, {
          default: Number(defaults.frames || 33),
          min: 1,
          max: 16384,
          step: 1,
        })
      : {};
    const fpsRange = controls.fps
      ? nodeRange(info, workflow.graph?.[controls.fps.node]?.class_type, controls.fps.input, {
          default: Number(defaults.fps || 16),
          min: 1,
          max: 120,
          step: 1,
        })
      : {};
    const durationRange = controls.duration
      ? nodeRange(
          info,
          workflow.graph?.[controls.duration.node]?.class_type,
          controls.duration.input,
          { default: Number(defaults.duration || 6), min: 1, max: 15, step: 1 },
        )
      : {};
    const resolutions =
      controls.resolution && Array.isArray(workflow.options?.resolutions)
        ? workflow.options.resolutions.filter((value) => typeof value === "string" && value)
        : [];
    if (Number(defaults.width)) widthRange.default = Number(defaults.width);
    if (Number(defaults.height)) heightRange.default = Number(defaults.height);
    if (Number(defaults.count)) countRange.default = Number(defaults.count);
    if (Number(defaults.frames)) frameRange.default = Number(defaults.frames);
    if (Number(defaults.fps)) fpsRange.default = Number(defaults.fps);
    if (Number(defaults.duration)) durationRange.default = Number(defaults.duration);
    if (String(workflow.family || "").replaceAll("-", "_") === "minimax_h3") {
      // H3 renders 124 to 362 frames on a 17n + 5 grid; a node that declares less (Radiance: 345) wins.
      Object.assign(frameRange, {
        default: Number(defaults.frames || 124),
        min: Math.max(124, Number(frameRange.min) || 0),
        max: Math.min(362, Number(frameRange.max) || 362),
        step: 17,
        offset: 5,
      });
      Object.assign(fpsRange, { default: 24, min: 24, max: 24, step: 1 });
    }
    profiles.push(
      buildProfile({
        id: workflow.profileId,
        kind: workflow.kind,
        label: workflow.name,
        displayName: workflow.name,
        description: workflow.description,
        prompting: workflow.prompting,
        model: workflow.profileId,
        baseModel: modelBasename(defaults.model || ""),
        workflow: workflow.profileId,
        family: workflow.family,
        uncensored: workflow.uncensored,
        aiDrafted: workflow.aiDrafted,
        recipe: workflow.recipe,
        defaults: {
          count: detectedDefault(countRange, Number(defaults.count || 1)),
          width: detectedDefault(widthRange, Number(defaults.width || 1024)),
          height: detectedDefault(heightRange, Number(defaults.height || 1024)),
          steps: Number(
            defaults.steps ||
              detectedDefault(samplerRange.steps, workflow.kind === "video" ? 12 : 20),
          ),
          cfg: Number(
            defaults.cfg || detectedDefault(samplerRange.cfg, workflow.kind === "video" ? 5 : 7),
          ),
          sampler: defaults.sampler || samplers[0] || "",
          scheduler: defaults.scheduler || schedulers[0] || "",
          textEncoder: defaults.textEncoder || "",
          vae: defaults.vae || "",
          clipType: defaults.clipType || "",
          weightDtype: defaults.weightDtype || "default",
          frames: detectedDefault(frameRange, Number(defaults.frames || 33)),
          fps: detectedDefault(fpsRange, Number(defaults.fps || 16)),
          duration: detectedDefault(durationRange, Number(defaults.duration || 6)),
          resolution: resolutions.includes(defaults.resolution)
            ? defaults.resolution
            : resolutions[0] || "",
          denoise: Number(defaults.denoise || 1),
        },
        aspects: customAspectSet(
          {
            width: detectedDefault(widthRange, Number(defaults.width || 1024)),
            height: detectedDefault(heightRange, Number(defaults.height || 1024)),
          },
          workflow.aspectRatios,
          { width: widthRange, height: heightRange },
        ),
        aspectDefault:
          families[String(workflow.family || "").replaceAll("-", "_")]?.aspectDefault || "",
        // Whether the model family draws 2K/4K itself, so MCP's size applies to imported workflows too.
        native: workflowFamilyValue(workflow, "native"),
        options: {
          textEncoders: clips,
          vaes,
          clipTypes,
          weightDtypes,
          samplers,
          schedulers,
          resolutions,
          loras: workflow.capabilities.lora ? loras : [],
        },
        constraints: {
          prompt: textMeta,
          negative: textMeta,
          width: widthRange,
          height: heightRange,
          count: countRange,
          frames: frameRange,
          fps: fpsRange,
          duration: durationRange,
          ...samplerRange,
        },
        imageModes: workflow.imageModes,
        capabilities: {
          ...workflow.capabilities,
          // A mask needs an image the graph takes in, a saved image to stitch into and the stitch's
          // core nodes (checked once a worker answers).
          inpaint:
            inpaintingEnabled &&
            workflow.kind === "image" &&
            workflow.capabilities.inpaint !== false &&
            Boolean(workflow.mediaInputs?.length || workflow.controls?.startImage) &&
            imageSaves(workflow.graph).length > 0 &&
            (configuredOnly || !missingNodes(info, inpaintNodes).length),
        },
        mediaInputs: workflow.mediaInputs || [],
        aspectPolicy: workflow.aspectPolicy,
        maxLoras: workflow.loraStack?.max,
        backend: workflow.backend,
        backendOptions,
        // Radiance video takes a request's LoRAs through one rank-64 slot (ai's video runtime), so the picker says so.
        ...(workflow.kind === "video" && workflow.loraStack?.adapter === "radiance-tags-v1"
          ? { loraNote: "Up to rank 64 in total" }
          : {}),
      }),
    );
    if (reason)
      Object.assign(profiles.at(-1), {
        ready: false,
        readyReason: `${profileBackendLabels[workflow.backend] || workflow.backend} isn’t ready: ${reason}`,
      });
  }

  if (!lorasEnabled)
    for (const profile of profiles) {
      profile.capabilities.lora = false;
      if (profile.options.loras) profile.options.loras = [];
    }
  const imageProfiles = profiles.filter((profile) => profile.kind === "image");
  const videoProfiles = profiles.filter((profile) => profile.kind === "video");
  // A ready model is the better first pick than one still waiting on files.
  const firstReady = (list, setting) =>
    (
      list.find(
        (profile) => profile.id === canonicalProfileId(setting) && profile.ready !== false,
      ) ||
      list.find((profile) => profile.ready !== false) ||
      list[0]
    )?.id || "";
  return {
    imageModels: imageProfiles.map((profile) => ({ label: profile.label, value: profile.id })),
    videoModels: videoProfiles.map((profile) => ({ label: profile.label, value: profile.id })),
    profiles,
    // Release switches the studio needs to know about (features.js).
    features: { inpainting: inpaintingEnabled, presets: presetsEnabled() },
    textEncoders: clips,
    vaes,
    clipTypes,
    weightDtypes,
    samplers,
    schedulers,
    loras,
    defaults: {
      imageModel: firstReady(imageProfiles, process.env.STUDIO_DEFAULT_IMAGE_PROFILE),
      videoModel: firstReady(videoProfiles, process.env.STUDIO_DEFAULT_VIDEO_PROFILE),
    },
    capabilities: {
      image: imageProfiles.length > 0,
      video: videoProfiles.length > 0,
      startImage: profiles.some((profile) => profile.capabilities.startImage),
    },
  };
}

/** No ComfyUI to ask: nothing to offer, and say why instead of blaming missing nodes. */
export function offlineModelResult(comfyUrl = "") {
  return {
    ...inferModels({}, {}),
    reason: `Can’t reach ComfyUI${comfyUrl ? ` at ${comfyUrl}` : ""}.`,
  };
}

/** Fake models for STUDIO_DEMO=1 (agent and UI testing without ComfyUI). */
export function mockModelResult() {
  const imageProfiles = [
    buildProfile({
      id: "mock-flux-schnell",
      kind: "image",
      label: "FLUX.1 Schnell (Demo)",
      displayName: "FLUX.1 Schnell (Demo)",
      description: "Fast 4-step image model for offline testing mode",
      model: "flux1-schnell.safetensors",
      workflow: "builtin-flux-schnell",
      family: "flux",
      defaults: {
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 1,
        sampler: "euler",
        scheduler: "simple",
        denoise: 0.65,
        inpaintStrength: 0.8,
      },
      capabilities: {
        lora: true,
        startImage: true,
        startImageRequired: false,
        denoise: true,
        inpaint: inpaintingEnabled,
      },
    }),
    buildProfile({
      id: "mock-sdxl-turbo",
      kind: "image",
      label: "SDXL Turbo (Demo)",
      displayName: "SDXL Turbo (Demo)",
      description: "Realtime 1-step SDXL model",
      model: "sd_xl_turbo_1.0.safetensors",
      workflow: "builtin-sdxl-turbo",
      family: "sdxl",
      defaults: {
        width: 1024,
        height: 1024,
        steps: 1,
        cfg: 1,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      capabilities: { lora: true, startImage: true, startImageRequired: false },
    }),
    buildProfile({
      id: "mock-illustrious",
      kind: "image",
      label: "Illustrious SDXL (Demo)",
      displayName: "Illustrious SDXL (Demo)",
      description: "Anime & Illustration specialized model",
      model: "illustrious-xl-v1.0.safetensors",
      workflow: "builtin-illustrious",
      family: "sdxl",
      defaults: {
        width: 832,
        height: 1216,
        steps: 24,
        cfg: 7,
        sampler: "dpmpp_2m",
        scheduler: "karras",
      },
      capabilities: { lora: true, startImage: true, startImageRequired: false },
    }),
  ];

  const videoProfiles = [
    buildProfile({
      id: "mock-wan-video",
      kind: "video",
      label: "Wan 2.1 Video (Demo)",
      displayName: "Wan 2.1 Video (Demo)",
      description: "16-frame video generation in offline testing mode",
      model: "wan2.1_i2v_480p.safetensors",
      workflow: "builtin-wan-video",
      family: "wan",
      defaults: {
        width: 832,
        height: 480,
        steps: 20,
        cfg: 6,
        frames: 16,
        fps: 16,
        sampler: "uni_pc",
        scheduler: "normal",
      },
      capabilities: { lora: false, startImage: true, startImageRequired: false },
    }),
  ];

  // File names, exactly like ComfyUI's LoraLoader list (objects here crashed the picker).
  const loras = [
    "cyberpunk_neon_v1.safetensors",
    "film_grain_35mm.safetensors",
    "anime_watercolor.safetensors",
  ];

  const samplers = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "uni_pc"];
  const schedulers = ["normal", "karras", "exponential", "simple", "beta"];

  return {
    isMock: true,
    features: { inpainting: inpaintingEnabled, presets: presetsEnabled() },
    imageModels: imageProfiles.map((p) => ({ label: p.label, value: p.id })),
    videoModels: videoProfiles.map((p) => ({ label: p.label, value: p.id })),
    profiles: [...imageProfiles, ...videoProfiles],
    unsupportedModels: [],
    textEncoders: [],
    vaes: [],
    clipTypes: [],
    weightDtypes: ["default", "fp8_e4m3fn", "fp8_e5m2"],
    samplers,
    schedulers,
    loras,
    defaults: {
      imageModel: imageProfiles[0].id,
      videoModel: videoProfiles[0].id,
    },
    capabilities: {
      image: true,
      video: true,
      startImage: true,
    },
  };
}

function emptyModelResult(extra = {}) {
  return {
    features: { inpainting: inpaintingEnabled, presets: presetsEnabled() },
    imageModels: [],
    videoModels: [],
    profiles: [],
    unsupportedModels: [],
    textEncoders: [],
    vaes: [],
    clipTypes: [],
    weightDtypes: [],
    loras: [],
    samplers: [],
    schedulers: [],
    defaults: { imageModel: "", videoModel: "" },
    capabilities: { image: false, video: false, startImage: false },
    ...extra,
  };
}
