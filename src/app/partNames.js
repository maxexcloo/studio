// Friendly names for model parts (text encoders, VAEs, weight types), with the file name kept as the detail.

const upper = new Set(["vae", "ae", "vl", "fp8", "fp16", "fp32", "bf16", "int4", "int8", "nf4", "gguf", "xl", "xxl", "clip", "sd", "sdxl", "t5", "umt5", "lora", "e4m3fn", "e5m2", "q4", "q5", "q6", "q8"]);
const words = { flux: "FLUX", qwen: "Qwen", wan: "Wan", gemma: "Gemma", llama: "Llama", mistral: "Mistral", hidream: "HiDream", ltx: "LTX", hunyuan: "Hunyuan", krea: "Krea", chroma: "Chroma", scaled: "Scaled", convrot: "ConvRot" };
const dtypes = { default: "Default", fp8_e4m3fn: "FP8 (E4M3)", fp8_e4m3fn_fast: "FP8 (E4M3, Fast)", fp8_e5m2: "FP8 (E5M2)", fp16: "FP16", bf16: "BF16", fp32: "FP32" };

function word(token) {
  const lower = token.toLowerCase();
  if (upper.has(lower)) return lower.toUpperCase();
  if (words[lower]) return words[lower];
  // 8b, 4b, 12b: parameter counts read as 8B.
  if (/^\d+(\.\d+)?[bm]$/.test(lower)) return lower.toUpperCase();
  // qwen3vl, qwen2.5: a known word with a version stuck on.
  const stuck = /^([a-z]+?)(\d[\d.]*)([a-z]*)$/.exec(lower);
  if (stuck && stuck[3] && upper.has(`${stuck[1]}${stuck[2]}`)) return `${stuck[1].toUpperCase()}${stuck[2]} ${word(stuck[3])}`;
  if (stuck && words[stuck[1]]) return `${words[stuck[1]]}${stuck[2]}${stuck[3] ? ` ${word(stuck[3])}` : ""}`;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "qwen3vl_8b_int8_convrot.safetensors" → "Qwen3 VL 8B INT8 ConvRot"; "ae.safetensors" → "AE". */
export function partName(file) {
  const text = String(file || "");
  if (!text) return "";
  if (dtypes[text]) return dtypes[text];
  const base = text.split(/[\\/]/).pop().replace(/\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i, "");
  return base.split(/[_\s-]+/).filter(Boolean).map(word).join(" ");
}

/** Options for a select: the friendly name, with the file name kept for the picker's detail. */
export function partOptions(options) {
  return (options || []).map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? partName(option) : option.label;
    return { value, label, detail: typeof option === "string" && label !== option ? option : "" };
  });
}
