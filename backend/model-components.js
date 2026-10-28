/**
 * Text encoders and VAEs. ComfyUI recognises them by tensor names and shapes in
 * the safetensors header (comfy/sd.py detect_te_model and VAE.__init__); the
 * worker only gives Studio file names, so each kind carries a filename pattern.
 */

/* ------------------------------------------------------------ Kinds */

// Text encoder kinds. `name` is the filename fallback; order matters where
// patterns overlap (Qwen3-VL before Qwen3, UMT5 before T5).
export const encoderKinds = {
  clip_l: { label: "CLIP-L", name: /clip[-_ ]?l(?![a-z])|clip_l|vit[-_]?l/i },
  clip_g: { label: "CLIP-G", name: /clip[-_ ]?g(?![a-z])|clip_g|bigg/i },
  clip_h: { label: "CLIP-H", name: /clip[-_ ]?h(?![a-z])|vit[-_]?h/i },
  umt5xxl: { label: "UMT5-XXL", name: /umt5/i },
  t5xl: { label: "T5-XL (Pile)", name: /t5[-_ ]?xl(?!l)|pile[-_ ]?t5|pony[-_ ]?v7.*t5/i },
  t5xxl: { label: "T5-XXL", name: /t5[-_ ]?(v1_1[-_ ]?)?xxl|t5xxl/i },
  byt5_glyph: { label: "ByT5 Glyph", name: /byt5/i },
  qwen35_9b: { label: "Qwen3.5 9B", name: /qwen[-_ ]?3[._]5[-_ ]?9b|qwen35[-_ ]?9b/i },
  qwen3vl_32b: { label: "Qwen3-VL 32B", name: /qwen[-_ ]?3[-_ ]?vl.*32b/i },
  qwen3vl_8b: { label: "Qwen3-VL 8B", name: /qwen[-_ ]?3[-_ ]?vl.*8b/i },
  qwen3vl_4b: {
    label: "Qwen3-VL 4B",
    name: /qwen[-_ ]?3[-_ ]?vl.*4b|qwen[-_ ]?3[-_ ]?vl(?!.*\d+b)/i,
  },
  qwen25vl_7b: { label: "Qwen2.5-VL 7B", name: /qwen[-_ ]?2[._]?5[-_ ]?vl/i },
  qwen3_8b: { label: "Qwen3 8B", name: /qwen[-_ ]?3(?![-_ .]?vl)(?![-_ .]?5)[-_ .]*8b/i },
  qwen3_4b: { label: "Qwen3 4B", name: /qwen[-_ ]?3(?![-_ .]?vl)(?![-_ .]?5)[-_ .]*4b/i },
  qwen3_06b: { label: "Qwen3 0.6B", name: /qwen[-_ ]?3(?![-_ .]?vl)[-_ .]*0[._]?6b/i },
  mistral3_24b: {
    label: "Mistral 3 Small 24B",
    name: /mistral[-_ ]?3|mistral.*small|mistral.*24b/i,
  },
  ministral3_3b: { label: "Ministral 3 3B", name: /ministral/i },
  gemma3_12b: { label: "Gemma 3 12B", name: /gemma[-_ ]?3.*12b/i },
  gemma2_2b: { label: "Gemma 2 2B", name: /gemma[-_ ]?2.*2b/i },
  llama31_8b: { label: "Llama 3.1 8B", name: /llama/i },
};

// VAE layouts group kinds whose shapes match exactly
// (an SD1.5 and an SDXL VAE, a Flux and an SD3 VAE, or a Wan 2.1 and a Qwen-Image
// VAE share their shapes exactly).
export const vaeKinds = {
  sd15: { label: "SD 1.5 VAE", layout: "kl4" },
  sdxl: { label: "SDXL VAE", layout: "kl4" },
  aura: { label: "Pony V7 VAE", layout: "kl4" },
  flux1: { label: "Flux VAE (ae)", layout: "kl16" },
  sd3: { label: "SD3 VAE", layout: "kl16" },
  flux2: { label: "Flux.2 VAE", layout: "flux2" },
  wan21: { label: "Wan 2.1 VAE", layout: "wan16" },
  qwen_image: { label: "Qwen-Image VAE", layout: "wan16" },
  // Not in this ComfyUI's detection yet, so its layout is unknown: trust the name.
  qwen_image_21: { label: "Qwen-Image 2.1 VAE", layout: "unknown" },
  wan22: { label: "Wan 2.2 VAE", layout: "wan48" },
  hunyuan15: { label: "HunyuanVideo 1.5 VAE", layout: "hv15" },
  hunyuan_video: { label: "HunyuanVideo VAE", layout: "hv1" },
  ltx_video: { label: "LTX video VAE", layout: "ltx" },
  h3_video: { label: "MiniMax H3 video VAE", layout: "h3v" },
  h3_audio: { label: "MiniMax H3 audio VAE", layout: "h3a" },
  mage_flow: { label: "MageFlow VAE", layout: "mage" },
};

function isAbliterated(name = "") {
  return /abliterat|uncensor|heretic/i.test(String(name));
}

function encoderKindFromName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  for (const [kind, spec] of Object.entries(encoderKinds)) {
    if (spec.name.test(base)) return kind;
  }
  return "";
}

/** What one text encoder file is, by its name. */
export function classifyEncoder(name) {
  const kind = encoderKindFromName(name);
  return { name, kind, via: kind ? "name" : "" };
}

const vaeNameHints = [
  ["mage_flow", /mage[-_ ]?flow/i],
  ["qwen_image_21", /qwen[-_ ]?image[-_ ]?2[._]?1/i],
  ["qwen_image", /qwen/i],
  ["wan22", /wan[-_ ]?2[._]?2/i],
  ["wan21", /wan/i],
  ["flux2", /flux[-_ ]?2|full_encoder_small_decoder/i],
  ["sd3", /sd[-_ ]?3/i],
  ["flux1", /\bae\b|^ae[._]|flux|lumina|z[-_ ]?image|chroma|hidream/i],
  ["aura", /pony[-_ ]?v7|aura/i],
  ["sdxl", /xl/i],
  ["hunyuan15", /hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuanvideo15/i],
  ["hunyuan_video", /hunyuan/i],
  ["h3_audio", /h3.*audio/i],
  ["h3_video", /h3/i],
  ["ltx_video", /ltx/i],
  ["sd15", /sd[-_ ]?1|vae[-_]ft|mse|ema/i],
];

/** What one VAE file is, by its name. */
export function classifyVae(name) {
  const base = String(name).split(/[\\/]/).pop() || "";
  const kind = vaeNameHints.find(([, pattern]) => pattern.test(base))?.[0] || "";
  return {
    name,
    layout: kind ? vaeKinds[kind].layout : "",
    kind,
    kinds: kind ? [kind] : [],
    via: kind ? "name" : "",
  };
}

/* ------------------------------------------------------------ Matching */

/**
 * Installed encoders that fit a slot, best first: abliterated files lead (the
 * user prefers them), then the order ComfyUI lists them in. Never "official
 * first". A slot with `only` takes just the files named for it (HiDream's own
 * CLIPs), since another model's build of the same kind looks identical.
 */
export function rankEncoders(encoders, slot) {
  const kinds = new Set(slot.kinds);
  return encoders
    .map((item, index) => ({ ...item, index }))
    .filter((item) => {
      const base = String(item.name).split(/[\\/]/).pop() || "";
      // `only`: the model's own build; `not`: a tuned build of the same shapes it must not take.
      return (
        kinds.has(item.kind) &&
        (!slot.only || slot.only.test(base)) &&
        (!slot.not || !slot.not.test(base))
      );
    })
    .sort((a, b) => isAbliterated(b.name) - isAbliterated(a.name) || a.index - b.index)
    .map((item) => item.name);
}

/** VAEs that fit, best first: an exact kind before a same-shaped unnamed one. */
export function rankVaes(vaes, want) {
  const wanted = new Set(want);
  return vaes
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.kinds.some((kind) => wanted.has(kind)))
    .sort((a, b) => Number(wanted.has(b.kind)) - Number(wanted.has(a.kind)) || a.index - b.index)
    .map((item) => item.name);
}
