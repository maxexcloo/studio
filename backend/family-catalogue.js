/**
 * Every model family Studio can run, as data: how to recognise its weights, which
 * text encoders and VAE it needs, how its graph is shaped, and the settings its
 * makers ship. Values come from Comfy-Org's own workflow templates and the model
 * cards; key signatures mirror ComfyUI's comfy/model_detection.py, checked in the
 * same order so the same file is never read two ways.
 */

import { flux3Upsampler } from "./prompt-upsamplers.js";

/* ------------------------------------------------------------ Families */

const square = [
  ["1:1", 1, 1],
  ["16:9", 16, 9],
  ["9:16", 9, 16],
  ["4:3", 4, 3],
  ["3:4", 3, 4],
];
const portraitFirst = [
  ["2:3", 2, 3],
  ["1:1", 1, 1],
  ["3:2", 3, 2],
  ["16:9", 16, 9],
  ["9:16", 9, 16],
  ["4:3", 4, 3],
  ["3:4", 3, 4],
];
const wide = [
  ["16:9", 16, 9],
  ["9:16", 9, 16],
  ["1:1", 1, 1],
  ["4:3", 4, 3],
  ["3:4", 3, 4],
];

const speedName = /lightning|dmd2?|hyper|turbo|lcm|pcm|\d+[-_ ]?steps?|tcd|flash/i;

/**
 * slots: text encoder inputs in loader order. kinds: accepted encoder kinds;
 * only: a name a file of that kind must also have, where the model needs its
 * own build of an encoder whose shapes others share (the header cannot tell
 * them apart), with `detail` saying why when it is missing.
 * vae: accepted VAE kinds (first is the one to download). sampling: "ksampler",
 * "custom" (SamplerCustomAdvanced), "pair" (Wan 2.2 14B), "h3", "sana",
 * "mage" (its own encode node).
 * pair: a second model file the family runs next to the picked one (see pairSpec).
 * promptPrefix / negativePrefix: system text the model was trained to see first.
 * t5Padding: { minPadding, minLength } for T5TokenizerOptions, on the family
 * or a variant, where the maker's workflow sets how the T5 pads its tokens.
 * imageToVideo: `latent` is an image-to-video node (WanImageToVideo and the
 * like) that takes both conditionings, the VAE and the start image, and hands
 * back conditionings and latent; startImage: "required" makes the composer ask
 * for that picture. clipVision: vision encoder kinds that also read it.
 * refines: a family the detection finds, which a name pattern narrows to this
 * one (the weights cannot tell them apart). excludes: a name that marks a sibling
 * with the same layout, which is `as` (a knownFamilies id) instead.
 * pack: a node-packs.js id when the family runs on custom nodes. ownLoaders:
 * the pack loads encoder and VAE itself (no pickers, no LoRAs).
 * upsampler: a small language model the family is meant to run behind (FLUX.3),
 * which rewrites your prompt into the long caption the model was trained on,
 * through ComfyUI's TextGenerate: slot (an encoder slot, `only` its own build),
 * clipType, system { text, edit } (edit when reference images go in, which it
 * also sees), maxLength, sampling (TextGenerate's "on" settings) and
 * editSampling (what an edit changes in them), editRequest (how an edit's
 * request is worded, {prompt} for yours) and referenceMegapixels (how large
 * it sees the references, by how many there are; the last covers the rest).
 * optional: the model runs without it; a missing one is offered as recommended
 * (the profile's `recommended`), not needed.
 * variants: first whose `match` passes wins; the last one is the fallback.
 */
/**
 * Whether a family draws at 2K/4K itself, per size: "yes" where its makers
 * document that size (the size menu offers it), "maybe" where reports are
 * mixed or missing (the size menu shows it disabled). Left
 * out only where it plainly breaks: the 1 MP generation (SD 1.5/2) at 2K, and
 * models documented at ~1 MP at 4K.
 */
const drawsNone = {};
const draws2kMaybe = { "2k": "maybe" };
const draws2k = { "2k": "yes", "4k": "maybe" };
const draws4k = { "2k": "yes", "4k": "yes" };

export const families = {
  sd15: {
    label: "SD 1.5",
    kind: "image",
    native: drawsNone,
    sources: ["checkpoint", "unet"],
    slots: [{ slot: "clip", label: "CLIP-L", kinds: ["clip_l"] }],
    clipType: "stable_diffusion",
    vae: ["sd15"],
    latent: "EmptyLatentImage",
    sizeStep: 8,
    negative: "text",
    img2img: true,
    aspects: portraitFirst,
    clipSkip: (name) => (/anything|nai|counterfeit|meina|abyss|anime/i.test(name) ? -2 : 0),
    variants: [
      {
        id: "fast",
        label: "Fast (LCM/Lightning)",
        match: (name) => speedName.test(name),
      },
      {
        id: "standard",
        label: "SD 1.5",
      },
    ],
    size: [512, 512],
  },
  sd2: {
    label: "SD 2.x",
    kind: "image",
    native: drawsNone,
    sources: ["checkpoint"],
    slots: [{ slot: "clip", label: "CLIP-H", kinds: ["clip_h"] }],
    clipType: "stable_diffusion",
    vae: ["sd15"],
    latent: "EmptyLatentImage",
    sizeStep: 8,
    negative: "text",
    img2img: true,
    aspects: square,
    // SD 2.0 and 2.1 come as 768 px v-prediction models and 512 px "base" ones
    // (v2-1_512-ema-pruned, 512-base-ema); the weights look the same.
    variants: [
      {
        id: "base",
        label: "Base (512)",
        match: (name) => /512|(^|[^a-z])base([^a-z]|$)/i.test(name),
        size: [512, 512],
      },
      {
        id: "standard",
        label: "SD 2.x",
      },
    ],
    size: [768, 768],
  },
  sdxl: {
    label: "SDXL",
    kind: "image",
    native: draws2kMaybe,
    sources: ["checkpoint", "unet"],
    slots: [
      { slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] },
      { slot: "clip_g", label: "CLIP-G", kinds: ["clip_g"] },
    ],
    clipType: "sdxl",
    vae: ["sdxl"],
    latent: "EmptyLatentImage",
    sizeStep: 8,
    negative: "text",
    img2img: true,
    aspects: portraitFirst,
    // Pony, Illustrious and NoobAI descend from NovelAI-style training on the
    // penultimate CLIP layer; speed merges of them keep that need.
    clipSkip: (name) => (/pony|pdxl|autismmix|illustrious|noob|ilxl/i.test(name) ? -2 : 0),
    variants: [
      {
        id: "turbo",
        label: "SDXL Turbo",
        match: (name) => /sd_?xl_?turbo|sdxlturbo/i.test(name),
        size: [512, 512],
      },
      {
        id: "hyper",
        label: "Hyper",
        match: (name) => /hyper/i.test(name),
      },
      {
        id: "dmd2",
        label: "DMD2",
        match: (name) => /dmd/i.test(name),
      },
      {
        id: "lcm",
        label: "LCM",
        match: (name) => /lcm|pcm|tcd/i.test(name),
      },
      {
        id: "lightning",
        label: "Lightning",
        match: (name) => /lightning|turbo|\d+[-_ ]?steps?/i.test(name),
      },
      // NoobAI v-pred merges often lack the v_pred key ComfyUI looks for, so Studio sets the mode itself.
      {
        id: "vpred",
        label: "V-prediction",
        match: (name) => /v[-_ ]?pred/i.test(name),
        vpred: true,
      },
      {
        id: "pony",
        label: "Pony",
        match: (name) => /pony|pdxl|autismmix/i.test(name),
      },
      {
        id: "anime",
        label: "Illustrious / NoobAI",
        match: (name) => /illustrious|noob|ilxl|wai[-_]?nsfw|animagine/i.test(name),
      },
      {
        id: "standard",
        label: "SDXL",
      },
    ],
    size: [1024, 1024],
  },
  auraflow: {
    label: "Pony V7 / AuraFlow",
    kind: "image",
    native: draws2kMaybe,
    sources: ["checkpoint", "unet"],
    slots: [{ slot: "t5", label: "Pile T5-XL", kinds: ["t5xl"] }],
    clipType: "stable_diffusion",
    vae: ["aura", "sdxl"],
    latent: "EmptyLatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: [["5:6", 5, 6], ...portraitFirst],
    variants: [
      {
        id: "auraflow",
        label: "AuraFlow",
        match: (name) => /auraflow/i.test(name),
      },
      // Pony V7's own ComfyUI workflows (purplesmartai/pony-v7-base): the T5 padded
      // to 768 tokens, 1280×1536. The card asks for at least 30 steps.
      {
        id: "standard",
        label: "Pony V7",
        t5Padding: { minPadding: 768, minLength: 768 },
        size: [1280, 1536],
      },
    ],
    size: [1024, 1024],
  },
  sd3: {
    label: "SD 3.5",
    kind: "image",
    native: draws2kMaybe,
    sources: ["checkpoint", "unet"],
    slots: [
      { slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] },
      { slot: "clip_g", label: "CLIP-G", kinds: ["clip_g"] },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] },
    ],
    clipType: null,
    vae: ["sd3"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "turbo",
        label: "Turbo",
        match: (name) => /turbo/i.test(name),
      },
      {
        id: "standard",
        label: "SD 3.5",
      },
    ],
    size: [1024, 1024],
  },
  flux1: {
    label: "Flux.1",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet", "checkpoint"],
    slots: [
      { slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] },
    ],
    clipType: "flux",
    vae: ["flux1"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    negative: "zero",
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "schnell",
        label: "Schnell",
        match: (name) => /schnell/i.test(name),
      },
      // De-distilled fine-tunes trade Flux guidance back for real CFG, so the negative prompt works again.
      {
        id: "dedistilled",
        label: "De-distilled",
        match: (name) => /de[-_ ]?distill/i.test(name),
        negative: "text",
      },
      {
        id: "fast",
        label: "Dev, fast",
        match: (name) => speedName.test(name),
        guidance: 3.5,
      },
      {
        id: "dev",
        label: "Dev",
        guidance: 3.5,
      },
    ],
    size: [1024, 1024],
  },
  flux2_dev: {
    label: "Flux.2 Dev",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Mistral 3 Small", kinds: ["mistral3_24b"] }],
    clipType: "flux2",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    negative: "none",
    sampling: "custom",
    scheduler: "flux2",
    aspects: square,
    requiredNodes: [
      "EmptyFlux2LatentImage",
      "Flux2Scheduler",
      "SamplerCustomAdvanced",
      "BasicGuider",
      "FluxGuidance",
    ],
    references: 3,
    variants: [
      {
        id: "fast",
        label: "Fast",
        match: (name) => speedName.test(name),
        guidance: 4,
      },
      {
        id: "dev",
        label: "Dev",
        guidance: 4,
      },
    ],
    size: [1024, 1024],
  },
  flux2_klein_4b: {
    label: "Flux.2 Klein 4B",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 4B", kinds: ["qwen3_4b"] }],
    clipType: "flux2",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    sampling: "custom",
    scheduler: "flux2",
    aspects: square,
    requiredNodes: [
      "EmptyFlux2LatentImage",
      "Flux2Scheduler",
      "SamplerCustomAdvanced",
      "CFGGuider",
    ],
    references: 3,
    variants: [
      {
        id: "base",
        label: "Base",
        match: (name) => /base/i.test(name) && !speedName.test(name),
        negative: "text",
      },
      {
        id: "distilled",
        label: "Distilled",
        negative: "zero",
      },
    ],
    size: [1024, 1024],
  },
  flux2_klein_9b: {
    label: "Flux.2 Klein 9B",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 8B", kinds: ["qwen3_8b"] }],
    clipType: "flux2",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    sampling: "custom",
    scheduler: "flux2",
    aspects: square,
    requiredNodes: [
      "EmptyFlux2LatentImage",
      "Flux2Scheduler",
      "SamplerCustomAdvanced",
      "CFGGuider",
    ],
    references: 3,
    variants: [
      {
        id: "base",
        label: "Base",
        match: (name) => /base/i.test(name) && !speedName.test(name),
        negative: "text",
      },
      {
        id: "distilled",
        label: "Distilled",
        negative: "zero",
      },
    ],
    size: [1024, 1024],
  },
  chroma: {
    label: "Chroma",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] }],
    clipType: "chroma",
    t5Padding: { minPadding: 0, minLength: 0 },
    vae: ["flux1"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "fast",
        label: "Fast",
        match: (name) => speedName.test(name),
      },
      {
        id: "standard",
        label: "Chroma",
      },
    ],
    size: [1024, 1024],
  },
  hidream: {
    label: "HiDream I1",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet", "checkpoint"],
    neverBundledEncoder: true,
    slots: [
      // HiDream's CLIPs are its own fine-tunes with the same shapes as everyone
      // else's; Flux's clip_l gives black images (ComfyUI issue 7715).
      {
        slot: "clip_l",
        label: "CLIP-L (HiDream)",
        kinds: ["clip_l"],
        only: /hidream/i,
        download: "hidream_clip_l",
        detail: "HiDream needs its own CLIP-L (clip_l_hidream). Flux’s gives black images.",
      },
      {
        slot: "clip_g",
        label: "CLIP-G (HiDream)",
        kinds: ["clip_g"],
        only: /hidream/i,
        download: "hidream_clip_g",
        detail: "HiDream is made for its own CLIP-G (clip_g_hidream).",
      },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] },
      { slot: "llama", label: "Llama 3.1 8B", kinds: ["llama31_8b"] },
    ],
    clipType: null,
    vae: ["flux1"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "fast",
        label: "Fast",
        match: (name) => /fast/i.test(name),
        negative: "zero",
      },
      {
        id: "dev",
        label: "Dev",
        match: (name) => /dev/i.test(name),
        negative: "zero",
      },
      {
        id: "full",
        label: "Full",
        negative: "text",
      },
    ],
    size: [1024, 1024],
  },
  qwen_image: {
    label: "Qwen-Image",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] }],
    clipType: "qwen_image",
    vae: ["qwen_image", "wan21"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "fast",
        label: "Lightning",
        match: (name) => speedName.test(name),
        negative: "text",
      },
      {
        id: "2512",
        label: "Qwen-Image 2512",
        match: (name) => /2512/.test(name),
        negative: "text",
      },
      {
        id: "standard",
        label: "Qwen-Image",
        negative: "text",
      },
    ],
    size: [1328, 1328],
  },
  qwen_image_21: {
    label: "Qwen-Image 2.1",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 8B", kinds: ["qwen3vl_8b"] }],
    clipType: "qwen_image",
    vae: ["qwen_image_21"],
    latent: "EmptyLatentImage",
    sizeStep: 32,
    negative: "qwen21",
    aspects: square,
    requiredNodes: ["TextEncodeQwenImage21"],
    // Edits: its text encoder reads reference images (up to 16; the composer offers three).
    references: 3,
    referenceVia: "encoder",
    variants: [
      {
        id: "turbo",
        label: "Qwen-Image 2.1 Turbo",
        match: (name) => /turbo/i.test(name),
        sigmas: [1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0],
        requiredNodes: [
          "ManualSigmas",
          "QwenImage21Cache",
          "BasicGuider",
          "RandomNoise",
          "KSamplerSelect",
          "SamplerCustomAdvanced",
        ],
      },
      {
        id: "standard",
        label: "Qwen-Image 2.1",
      },
    ],
    size: [1024, 1024],
  },
  zimage: {
    label: "Z-Image",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 4B", kinds: ["qwen3_4b"] }],
    clipType: "lumina2",
    vae: ["flux1"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: square,
    variants: [
      {
        id: "base",
        label: "Base",
        match: (name) => isZImageBase(name),
      },
      {
        id: "turbo",
        label: "Turbo",
      },
    ],
    size: [1024, 1024],
  },
  krea2: {
    label: "Krea 2",
    kind: "image",
    native: draws2k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 4B", kinds: ["qwen3vl_4b"] }],
    clipType: "krea2",
    vae: ["qwen_image"],
    latent: "EmptyLatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: square,
    // ComfyUI-Krea2T-Enhancer, when installed, at its own default strength (0 neutral, 2 full).
    enhancer: { strength: 1 },
    variants: [
      // Raw is trained up to 1K (krea-ai/krea-2 README), Turbo up to 2K.
      {
        id: "raw",
        label: "Raw",
        match: (name) => isKrea2Raw(name),
        rawShift: true,
        native: draws2kMaybe,
      },
      {
        id: "turbo",
        label: "Turbo",
      },
    ],
    size: [1024, 1024],
  },
  anima: {
    label: "Anima",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 0.6B", kinds: ["qwen3_06b"] }],
    clipType: "stable_diffusion",
    vae: ["qwen_image", "wan21"],
    latent: "EmptyLatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: portraitFirst,
    // The card: er_sde as the default sampler (both Comfy-Org templates use it);
    // Anima-Turbo "at CFG 1 and 8-12 steps", where euler suits it best.
    variants: [
      {
        id: "turbo",
        label: "Turbo",
        match: (name) => speedName.test(name),
        negative: "zero",
      },
      {
        id: "standard",
        label: "Anima",
      },
    ],
    size: [1024, 1024],
  },
  wan21: {
    label: "Wan 2.1",
    kind: "video",
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }],
    clipType: "wan",
    vae: ["wan21"],
    latent: "EmptyHunyuanLatentVideo",
    sizeStep: 16,
    frameStep: 4,
    negative: "text",
    aspects: wide,
    variants: [
      {
        id: "fast",
        label: "Fast",
        match: (name) => speedName.test(name) || /causvid|lightx2v|self[-_]?forcing/i.test(name),
      },
      {
        id: "standard",
        label: "Wan 2.1",
      },
    ],
    size: [832, 480],
    frames: 33,
    fps: 16,
  },
  wan22_5b: {
    label: "Wan 2.2 5B",
    kind: "video",
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }],
    clipType: "wan",
    vae: ["wan22"],
    latent: "Wan22ImageToVideoLatent",
    sizeStep: 32,
    frameStep: 4,
    negative: "text",
    startImage: true,
    aspects: wide,
    variants: [
      {
        id: "fast",
        label: "Fast",
        match: (name) => speedName.test(name),
      },
      {
        id: "standard",
        label: "Wan 2.2 5B",
      },
    ],
    size: [1280, 704],
    frames: 121,
    fps: 24,
  },
  wan22_14b: {
    label: "Wan 2.2 14B",
    kind: "video",
    sources: ["unet"],
    // Wan 2.1 14B and Wan 2.2 14B share every key; the high/low-noise pair is a naming convention.
    refines: { family: "wan21", name: /(high|low)[-_ ]?noise/i },
    pair: {
      owns: /^(?!.*i2v).*wan/i,
      isPartner: (base) => /low[-_ ]?noise/i.test(base),
      partnerOf: (name) => name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`),
      label: "Low-noise model",
      runsAs: "Runs as the second half of its high-noise model.",
      detail: (base) =>
        `Wan 2.2 14B also needs the matching low-noise file next to ${base} in diffusion_models.`,
      // Comfy-Org's low-noise half of the same task and precision.
      download: (name) =>
        `wan22_${/i2v/i.test(name) ? "i2v" : "t2v"}_low_${/fp16|bf16/i.test(name) ? "fp16" : "fp8"}`,
    },
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }],
    clipType: "wan",
    vae: ["wan21"],
    latent: "EmptyHunyuanLatentVideo",
    sizeStep: 16,
    frameStep: 4,
    negative: "text",
    sampling: "pair",
    aspects: wide,
    variants: [
      {
        id: "fast",
        label: "Fast (4-step)",
        match: (name) => speedName.test(name) || /lightx2v|rapid/i.test(name),
      },
      {
        id: "standard",
        label: "Wan 2.2 14B",
      },
    ],
    size: [832, 480],
    frames: 81,
    fps: 16,
  },
  // Wan 2.2 14B image-to-video, as Comfy-Org's template runs it: WanImageToVideo
  // puts the start image into both conditionings and makes the latent, then the
  // high/low-noise pair samples at shift 5 (20 steps at CFG 3.5, or 4 at CFG 1
  // with the lightx2v LoRAs). Its weights take 36 input channels (the picture
  // and its mask ride along), which is how it is told from text-to-video.
  wan22_14b_i2v: {
    label: "Wan 2.2 14B I2V",
    kind: "video",
    sources: ["unet"],
    refines: { family: "wan22_14b", name: /i2v/i },
    // Wan 2.2 Fun inpaint shares this layout exactly; it needs its own nodes.
    excludes: { name: /fun[-_ ]|inpaint|camera|control|vace|animate|s2v/i, as: "wan_other" },
    pair: {
      owns: /wan.*i2v|i2v.*wan/i,
      isPartner: (base) => /low[-_ ]?noise/i.test(base),
      partnerOf: (name) => name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`),
      label: "Low-noise model",
      runsAs: "Runs as the second half of its high-noise model.",
      detail: (base) =>
        `Wan 2.2 14B I2V also needs the matching low-noise file next to ${base} in diffusion_models.`,
      download: (name) => `wan22_i2v_low_${/fp16|bf16/i.test(name) ? "fp16" : "fp8"}`,
    },
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }],
    clipType: "wan",
    vae: ["wan21"],
    latent: "WanImageToVideo",
    imageToVideo: true,
    startImage: "required",
    sizeStep: 16,
    frameStep: 4,
    negative: "text",
    sampling: "pair",
    aspects: wide,
    requiredNodes: ["WanImageToVideo", "LoadImage"],
    variants: [
      {
        id: "fast",
        label: "Fast (4-step)",
        match: (name) => speedName.test(name) || /lightx2v|rapid/i.test(name),
      },
      {
        id: "standard",
        label: "Wan 2.2 14B I2V",
      },
    ],
    // The template's 640×640 is the area; the aspect follows the picture you pick.
    size: [832, 480],
    frames: 81,
    fps: 16,
  },
  hunyuan15: {
    label: "HunyuanVideo 1.5",
    kind: "video",
    sources: ["unet", "checkpoint"],
    slots: [
      { slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] },
      { slot: "glyph", label: "ByT5 Glyph", kinds: ["byt5_glyph"] },
    ],
    clipType: "hunyuan_video_15",
    vae: ["hunyuan15"],
    latent: "EmptyHunyuanVideo15Latent",
    sizeStep: 16,
    frameStep: 4,
    negative: "text",
    aspects: wide,
    requiredNodes: ["EmptyHunyuanVideo15Latent"],
    variants: [
      {
        id: "fast",
        label: "Fast (4-step)",
        match: (name) => speedName.test(name) || /lightx2v/i.test(name),
      },
      {
        id: "cfg_distilled_720",
        label: "720p CFG-distilled",
        match: (name) => /cfg[-_ ]?distill/i.test(name) && /720p/i.test(name),
        size: [1280, 720],
      },
      {
        id: "cfg_distilled",
        label: "CFG-distilled",
        match: (name) => /cfg[-_ ]?distill/i.test(name),
      },
      {
        id: "p720",
        label: "720p",
        match: (name) => /720p/i.test(name),
        size: [1280, 720],
      },
      {
        id: "standard",
        label: "HunyuanVideo 1.5",
      },
    ],
    size: [848, 480],
    frames: 121,
    fps: 24,
  },
  // HunyuanVideo 1.5 image-to-video (Comfy-Org's 720p I2V template): the start
  // image goes in through HunyuanVideo15ImageToVideo and, read by a SigLIP
  // vision encoder, as guidance; 20 steps at CFG 6. Shift follows Tencent's
  // table: 5 at 480p, 7 at 720p and for the 480p step-distilled model. The I2V
  // weights have the same layout as text-to-video, so only the name tells them apart.
  hunyuan15_i2v: {
    label: "HunyuanVideo 1.5 I2V",
    kind: "video",
    sources: ["unet", "checkpoint"],
    refines: { family: "hunyuan15", name: /i2v/i },
    slots: [
      { slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] },
      { slot: "glyph", label: "ByT5 Glyph", kinds: ["byt5_glyph"] },
    ],
    clipType: "hunyuan_video_15",
    vae: ["hunyuan15"],
    latent: "HunyuanVideo15ImageToVideo",
    imageToVideo: true,
    startImage: "required",
    clipVision: ["sigclip_384"],
    sizeStep: 16,
    frameStep: 4,
    negative: "text",
    aspects: wide,
    requiredNodes: [
      "HunyuanVideo15ImageToVideo",
      "CLIPVisionLoader",
      "CLIPVisionEncode",
      "LoadImage",
    ],
    variants: [
      {
        id: "step_distilled",
        label: "Step-distilled",
        match: (name) => /step[-_ ]?distill/i.test(name) || speedName.test(name),
      },
      {
        id: "cfg_distilled_720",
        label: "720p CFG-distilled",
        match: (name) => /cfg[-_ ]?distill/i.test(name) && /720p/i.test(name),
        size: [1280, 720],
      },
      {
        id: "cfg_distilled",
        label: "CFG-distilled",
        match: (name) => /cfg[-_ ]?distill/i.test(name),
      },
      {
        id: "p720",
        label: "720p",
        match: (name) => /720p/i.test(name),
        size: [1280, 720],
      },
      {
        id: "standard",
        label: "HunyuanVideo 1.5 I2V",
      },
    ],
    size: [848, 480],
    frames: 121,
    fps: 24,
  },
  minimax_h3: {
    label: "MiniMax H3",
    kind: "video",
    sources: ["unet", "checkpoint"],
    audio: true,
    slots: [{ slot: "encoder", label: "Qwen3-VL 32B", kinds: ["qwen3vl_32b"] }],
    clipType: "minimax",
    vae: ["h3_video"],
    audioVae: ["h3_audio"],
    latent: "MiniMaxH3ImageToVideo",
    sizeStep: 32,
    negative: "none",
    sampling: "h3",
    aspects: wide,
    aspectDefault: "16:9",
    references: 3,
    referenceVia: "encoder",
    requiredNodes: [
      "MiniMaxH3ImageToVideo",
      "SamplerCustomAdvanced",
      "BasicGuider",
      "VAEDecodeAudio",
      "CreateVideo",
      "LoadImage",
    ],
    variants: [
      {
        id: "reference",
        label: "MiniMax H3 Reference",
        match: (name) => /ref2va/i.test(name),
        references: 3,
        referenceRequired: true,
        requiredNodes: ["MiniMaxH3ReferenceToVideo"],
      },
      {
        id: "fast",
        label: "Turbo",
        match: (name) => speedName.test(name),
        references: 1,
      },
      {
        id: "standard",
        label: "MiniMax H3",
        references: 1,
      },
    ],
    // The Comfy-Org template's 16:9 canvas, and the aspect its presets scale
    // around: H3's own example is 1344×768, not a square. 5 seconds, as the
    // template and the node's own default: H3 is trained on 5 to 15 s.
    size: [1344, 768],
    frames: 124,
    fps: 24,
  },
  // PrunaAI's P-H3-Image (Nov 2026): MiniMax H3's transformer tuned for stills, distilled to 8
  // steps without CFG or a negative, with its own text encoder (Qwen3-VL 4B parts, CLIPLoader type
  // minimax) and VAE. Settings from PrunaAI/P-H3-Image-Comfy's workflows (ComfyUI 0.44):
  // ModelSamplingMiniMaxH3 at 1/1, PH3ImageConditioning for the conditioning and the latent (and
  // up to 8 images to edit, the first being edited), ManualSigmas' 8-step grid, euler and
  // BasicGuider. 8 MP for text-to-image, 4 MP for edits. Its 2 GB LoRA turns H3's FL2VA into it,
  // so that LoRA is an H3 adapter.
  p_h3_image: {
    label: "P-H3 Image",
    kind: "image",
    native: draws4k,
    sources: ["unet"],
    refines: { family: "minimax_h3", name: /p[-_ ]?h3[-_ ]?image/i },
    slots: [{ slot: "encoder", label: "P-H3 Image text encoder", kinds: ["p_h3_image"] }],
    clipType: "minimax",
    vae: ["p_h3_image"],
    latent: "PH3ImageConditioning",
    sizeStep: 32,
    negative: "none",
    sampling: "custom",
    aspects: [
      ["1:1", 1, 1],
      ["4:3", 4, 3],
      ["3:4", 3, 4],
      ["3:2", 3, 2],
      ["2:3", 2, 3],
      ["16:9", 16, 9],
      ["9:16", 9, 16],
    ],
    references: 3,
    requiredNodes: [
      "PH3ImageConditioning",
      "MiniMaxH3SigmaShift",
      "ManualSigmas",
      "BasicGuider",
      "RandomNoise",
      "KSamplerSelect",
      "SamplerCustomAdvanced",
    ],
    variants: [
      {
        id: "standard",
        label: "P-H3 Image",
        sigmas: [1.0, 0.984753, 0.967905, 0.951688, 0.925372, 0.881923, 0.810083, 0.528718, 0.0],
      },
    ],
    // 4 MP, which edits want and the shared 32 GB card holds beside H3; text-to-image is best at 8 MP (2912²).
    size: [2048, 2048],
  },
  // Lumina Image 2.0 and its fine-tunes (Neta Lumina, NetaYume). Gemma reads a
  // system prompt before yours, as it did in training; the anime fine-tunes
  // were trained on their own, with a matching one for the negative.
  lumina2: {
    label: "Lumina Image 2.0",
    kind: "image",
    native: draws2kMaybe,
    sources: ["checkpoint", "unet"],
    slots: [{ slot: "encoder", label: "Gemma 2 2B", kinds: ["gemma2_2b"] }],
    clipType: "lumina2",
    vae: ["flux1"],
    latent: "EmptySD3LatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: portraitFirst,
    variants: [
      {
        id: "neta",
        label: "Neta Lumina / NetaYume",
        match: (name) => /neta|yume/i.test(name),
        promptPrefix:
          "You are an assistant designed to generate high quality anime images based on textual prompts. <Prompt Start> ",
        negativePrefix:
          "You are an assistant designed to generate low-quality images based on textual prompts <Prompt Start> ",
      },
      {
        id: "standard",
        label: "Lumina Image 2.0",
        promptPrefix:
          "You are an assistant designed to generate superior images with the superior degree of image-text alignment based on textual prompts or user prompts. <Prompt Start> ",
      },
    ],
    size: [1024, 1024],
  },
  // Mage-Flow encodes prompt and negative in one node that also makes the latent.
  mage_flow: {
    label: "MageFlow",
    kind: "image",
    native: draws2k,
    sources: ["unet"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 4B", kinds: ["qwen3vl_4b"] }],
    clipType: "mage",
    vae: ["mage_flow"],
    latent: "TextEncodeMageFlowEdit",
    sizeStep: 16,
    negative: "text",
    sampling: "mage",
    aspects: square,
    requiredNodes: ["TextEncodeMageFlowEdit"],
    variants: [
      {
        id: "turbo",
        label: "Turbo",
        match: (name) => speedName.test(name),
        negative: "none",
      },
      {
        id: "standard",
        label: "MageFlow",
      },
    ],
    size: [1024, 1024],
  },
  // ERNIE-Image: Ministral 3 3B through the Flux.2 text path, the Flux.2 VAE and latent, plain KSampler.
  ernie: {
    label: "ERNIE-Image",
    kind: "image",
    native: draws2kMaybe,
    sources: ["unet"],
    slots: [{ slot: "encoder", label: "Ministral 3 3B", kinds: ["ministral3_3b"] }],
    clipType: "flux2",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    negative: "text",
    img2img: true,
    aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage"],
    variants: [
      {
        id: "turbo",
        label: "Turbo",
        match: (name) => speedName.test(name),
        negative: "zero",
      },
      {
        id: "standard",
        label: "ERNIE-Image",
      },
    ],
    size: [1024, 1024],
  },
  // NVIDIA's Sana is not native to ComfyUI; one of two custom node packs runs
  // it, each loading its own Gemma 2 2B encoder and DC-AE VAE.
  // Settings follow NVlabs/Sana's ComfyUI workflows: CFG 2 for the 1.6B Sana 1.0
  // models (1K, 2K, 4K), 4.5 for SANA 1.5.
  sana: {
    label: "Sana",
    kind: "image",
    native: draws2kMaybe,
    sources: ["sana", "sana_diffusers", "checkpoint"],
    ownLoaders: true,
    slots: [],
    clipType: null,
    vae: [],
    latent: "EmptyHunyuanImageLatent",
    sizeStep: 32,
    negative: "text",
    sampling: "sana",
    aspects: square,
    variants: [
      // Sprint is a consistency model: its CFG goes in through ScmModelSampling, KSampler stays at 1.
      {
        id: "sprint",
        label: "Sprint",
        match: (name) => /sprint/i.test(name),
        native: draws2kMaybe,
        negative: "none",
        dtype: "FP32",
      },
      {
        id: "4k",
        label: "4K",
        match: (name) => /4k/i.test(name),
        size: [4096, 4096],
        native: draws4k,
      },
      {
        id: "2k",
        label: "2K",
        match: (name) => /2k/i.test(name),
        size: [2048, 2048],
        native: draws2k,
      },
      {
        id: "512",
        label: "512px",
        match: (name) => /512px/i.test(name),
        size: [512, 512],
        native: drawsNone,
      },
      // Sana 1.0 1.6B at 1024: 20 blocks without SANA 1.5's q/k norms.
      {
        id: "1600m",
        label: "1.6B",
        match: (name) => /1600m|1[._]6b/i.test(name) && !/1[._]5/.test(name),
      },
      {
        id: "standard",
        label: "Sana",
      },
    ],
    size: [1024, 1024],
  },
  // Black Forest Labs' FLUX.3 Image Klein (Oct 2026): a 5.6B DiT on the Flux.2 latent and
  // VAE, reading prompts with Qwen3-VL 4B (8 tapped layers). It edits from up to ten
  // references; the composer offers three. Settings from BFL's reference code
  // (black-forest-labs/flux-3-image-klein, 2026-10-17): Klein (distilled, a flow map) 16
  // steps without guidance, Klein Base 50 steps at CFG 4, both on a time shift of 16 (ComfyUI
  // still builds in 6.93, so the shift is set here: mu = ln 16), euler / simple. Up to 4K;
  // BFL recommend 2K. "Do not use the model without a prompt upsampler", so every run goes
  // through theirs first, as their code runs it.
  flux3: {
    label: "FLUX.3 Klein",
    kind: "image",
    native: draws4k,
    sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 4B", kinds: ["qwen3vl_4b"] }],
    clipType: "flux3",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    aspects: square,
    requiredNodes: [
      "EmptyFlux2LatentImage",
      "TextGenerate",
      "BatchImagesNode",
      "ImageScaleToTotalPixels",
    ],
    references: 3,
    // BFL's pup.py: greedy decoding (top_k 1 here, as Comfy-Org's templates do it, since TextGenerate
    // needs sampling on for a presence penalty), no repetition penalty, presence 1.5 for a picture
    // and 0 for an edit. An edit's request is worded as theirs is, with its references at most
    // 1 MP for one, 724² for two and 512² for more.
    upsampler: {
      // Recommended, not required: it runs without one, and long prompts lose little.
      optional: true,
      slot: {
        slot: "upsampler",
        label: "FLUX.3 prompt upsampler",
        kinds: ["qwen35_9b"],
        only: /upsampl/i,
        download: "flux3_upsampler",
        detail:
          "FLUX.3 runs without it. It was trained on long, detailed captions, and this turns a short prompt into one; BFL recommend it. With it in place, every run uses it.",
      },
      clipType: "flux3",
      system: flux3Upsampler,
      maxLength: 3584,
      sampling: {
        temperature: 1,
        top_k: 1,
        top_p: 0.95,
        min_p: 0,
        repetition_penalty: 1,
        seed: 0,
        presence_penalty: 1.5,
      },
      editSampling: { presence_penalty: 0 },
      editRequest:
        "Reference images follow in order (the first image, the second image, ...).\nUser request: {prompt}\nOutput the caption.",
      referenceMegapixels: [1, 0.52, 0.25],
    },
    variants: [
      {
        id: "base",
        label: "Base",
        match: (name) => /(^|[^a-z])base([^a-z]|$)/i.test(name),
        negative: "text",
      },
      {
        id: "distilled",
        label: "Klein",
        negative: "zero",
      },
    ],
    size: [1024, 1024],
  },
  // OpenMOSS's MOSS-Image (Oct 2026): a 5B single-stream DiT in Flux.2's latent space that
  // reads prompts with a stock Qwen3.5 9B. Settings from its model card and ComfyUI
  // workflow: 50 steps, CFG 3, shift 5, euler / sgm_uniform, 1-2 MP (0.25-4 MP work).
  // It runs on ComfyUI's own nodes (master after 0.41.3, CLIPLoader type moss_image) with
  // Comfy-Org's single files, and takes SkipLayerGuidanceDiTSimple, which skips layer 22 on
  // the negative pass as the makers sample. Edits run through the Moss-Image-Edit LoRA
  // (Comfy-Org/MOSS-Image loras/moss_image_edit_lora_rank_64_bf16) and ComfyUI 0.43's
  // TextEncodeMOSSImageEdit, which takes up to four references as latents: Comfy-Org's
  // image_moss_image_edit template samples 30 steps at CFG 4, euler / normal.
  moss_image: {
    label: "MOSS-Image",
    kind: "image",
    native: { "2k": "yes" },
    sources: ["unet"],
    // Stock Qwen3.5 9B; FLUX.3's upsampler is a tuned Qwen3.5 9B with the same shapes.
    slots: [{ slot: "encoder", label: "Qwen3.5 9B", kinds: ["qwen35_9b"], not: /upsampl/i }],
    clipType: "moss_image",
    vae: ["flux2"],
    latent: "EmptyFlux2LatentImage",
    sizeStep: 16,
    negative: "text",
    references: 4,
    aspects: square,
    // No shift node on ComfyUI's own nodes: their MOSS-Image samples at shift 5 by itself, with
    // timesteps 0-1. ModelSamplingSD3 would scale those by 1000 and draw only noise.
    requiredNodes: ["EmptyFlux2LatentImage"],
    variants: [
      {
        id: "base",
        label: "Base",
        match: (name) => /(^|[^a-z])base([^a-z]|$)/i.test(name),
      },
      {
        id: "sft",
        label: "SFT",
      },
    ],
    size: [1024, 1024],
  },
};

/* ------------------------------------------------------------ Names */

function isKrea2Raw(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  return /raw|base/i.test(base) && !/turbo|tdm|distill/i.test(base);
}

function isZImageBase(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  if (/turbo|distill|lightning|\d+[-_ ]?steps?/i.test(base)) return false;
  if (/base|raw/i.test(base)) return true;
  return /^z[-_ ]?image(?:[-_](?:bf16|fp16|fp32|fp8\w*|nvfp4|int8\w*|scaled|e4m3fn))*\.safetensors$/i.test(
    base,
  );
}

/** Filename guesses, for when the weights are out of reach (a remote ComfyUI). */
export function familyFromName(name = "", source = "unet") {
  const base = String(name).split(/[\\/]/).pop() || "";
  const tests = [
    ["sana", /(^|[^a-z])sana([^a-z]|$)/i],
    ["moss_image", /moss[-_ ]?image/i],
    ["flux3", /flux[-_. ]?3/i],
    ["mage_flow", /mage[-_ ]?flow/i],
    ["ernie", /(^|[^a-z])ernie([^a-z]|$)/i],
    ["lumina2", /lumina|neta[-_ ]?yume|netayume|neta[-_ ]?lumina/i],
    ["p_h3_image", /p[-_ ]?h3[-_ ]?image/i],
    ["minimax_h3", /minimax[-_ ]?h3|\bh3[-_]/i],
    ["wan22_14b", /wan[-_ ]?2[._]?2.*(high|low)[-_ ]?noise|(high|low)[-_ ]?noise.*wan/i],
    ["wan22_5b", /wan[-_ ]?2[._]?2.*5b|ti2v/i],
    ["wan21", /wan[-_ ]?2[._]?1.*t2v|wan.*t2v/i],
    ["hunyuan15", /hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuanvideo1\.?5/i],
    ["qwen_image_21", /qwen[-_ ]?image[-_ ]?2[._]?1/i],
    ["qwen_image", /qwen[-_ ]?image/i],
    ["krea2", /krea/i],
    ["flux2_klein_9b", /klein.*9b/i],
    ["flux2_klein_4b", /klein/i],
    ["flux2_dev", /flux[-_. ]?2/i],
    ["chroma", /chroma/i],
    ["hidream", /hidream/i],
    ["zimage", /z[-_ ]?image|z[-_ ]?anime/i],
    ["anima", /\banima/i],
    ["flux1", /flux|schnell/i],
    ["sd3", /sd[-_ ]?3|stable[-_ ]?diffusion[-_ ]?3/i],
    // Only a name that starts as Pony V7 does ("pony-v7-base"): SDXL merges named
    // "CyberRealistic Pony v7" or "ponyXL v7" are SDXL.
    ["auraflow", /^(?!.*xl)pony[-_ ]?(diffusion[-_ ]?)?v7(?!\d)|auraflow/i],
    ["sdxl", /xl|pony|illustrious|noob|animagine/i],
    ["sd15", /sd[-_ ]?1[._]?5|v1[-_]5/i],
  ];
  for (const [family, pattern] of tests) {
    // "flux1-krea-dev" is Flux, not Krea 2.
    if (family === "krea2" && /flux|krea[-_ .]?1(?!\d)/i.test(base)) continue;
    if (pattern.test(base)) return family;
  }
  // Anything else in checkpoints/ is most likely an SD-family all-in-one.
  return source === "checkpoint" ? "sdxl_or_sd15" : "";
}

/* ------------------------------------------------------------ Quantized files */

/** Which quantized format a file is in, by name. "" for anything ComfyUI loads natively. */
export function quantFromName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  if (/svdq|nunchaku/i.test(base)) return "svdq";
  if (/(^|[^a-z])(bnb[-_]?)?nf4([^a-z]|$)/i.test(base)) return "nf4";
  return "";
}

/**
 * The family a detected one narrows to by name (see `refines`): Wan 2.1 14B
 * named high/low noise is Wan 2.2 14B, and HunyuanVideo 1.5 named i2v is its
 * image-to-video model.
 */
export function refinedFamily(familyId = "", name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  let id = familyId;
  for (let step = 0; step < 4; step += 1) {
    const next = Object.entries(families).find(
      ([, spec]) => spec.refines?.family === id && spec.refines.name.test(base),
    );
    if (!next) break;
    id = next[0];
  }
  // A sibling with the very same layout that only its name gives away, and that runs elsewhere.
  const excludes = families[id]?.excludes;
  return excludes && excludes.name.test(base) ? excludes.as : id;
}

/* ------------------------------------------------------------ Speed LoRAs */

/** The variant of a family a file is, by name. */
export function variantFor(familyId, name = "") {
  const family = families[familyId];
  if (!family) return null;
  const base = String(name).split(/[\\/]/).pop() || "";
  return (
    family.variants.find((variant) => !variant.match || variant.match(base)) ||
    family.variants.at(-1)
  );
}
