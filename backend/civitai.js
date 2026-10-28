import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { writeBytesFileAsync } from "./json-store.js";
import { mediaFile, mediaParams } from "./media-paths.js";
import { withPngText } from "./png-text.js";
import { appVersion } from "./data-dir.js";

/**
 * Civitai-ready PNGs, always on.
 *
 * ComfyUI saves its graph in every PNG, which Civitai does not read. Each new
 * PNG from the gallery also gets the "parameters" text
 * AUTOMATIC1111 writes: the prompt with its LoRAs as <lora:name:weight>, the
 * negative prompt, then steps, sampler, CFG, seed, size and model. Civitai
 * reads that to fill in an upload and link the model and LoRAs by hash.
 *
 * It is written into the stored file in Studio media right after a run, so the
 * file you download or share carries it.
 */

// The old on/off switch is gone: a saved choice, "off" included, is dropped quietly.
try {
  fs.rmSync(path.join(dataDir, "civitai.json"), { force: true });
} catch {
  /* read-only data: nothing to forget */
}

/* ------------------------------------------------------------ Names */

const samplerNames = {
  euler: "Euler",
  euler_ancestral: "Euler a",
  heun: "Heun",
  dpm_2: "DPM2",
  dpm_2_ancestral: "DPM2 a",
  lms: "LMS",
  dpm_fast: "DPM fast",
  dpm_adaptive: "DPM adaptive",
  dpmpp_2s_ancestral: "DPM++ 2S a",
  dpmpp_sde: "DPM++ SDE",
  dpmpp_2m: "DPM++ 2M",
  dpmpp_2m_sde: "DPM++ 2M SDE",
  dpmpp_3m_sde: "DPM++ 3M SDE",
  ddim: "DDIM",
  uni_pc: "UniPC",
  lcm: "LCM",
};

const scheduleNames = {
  karras: "Karras",
  exponential: "Exponential",
  sgm_uniform: "SGM Uniform",
  simple: "Simple",
  beta: "Beta",
  ddim_uniform: "DDIM Uniform",
  kl_optimal: "KL Optimal",
};

/** ComfyUI's sampler as AUTOMATIC1111 names it, where there is a name for it. */
function a1111Sampler(sampler = "") {
  return samplerNames[sampler] || String(sampler || "");
}

function stem(name = "") {
  return path
    .basename(String(name || "").replace(/\\/g, "/"))
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

function field(value) {
  const text = String(value);
  return /[,:"]/.test(text) ? JSON.stringify(text) : text;
}

/**
 * The A1111 "parameters" text for one image. `hashes` maps a model or LoRA
 * file name to its AutoV2 hash (first ten hex digits of its SHA-256), for
 * those already worked out.
 */
export function parametersText(body = {}, { width = 0, height = 0, hashes = {} } = {}) {
  const loras = (Array.isArray(body.loras) ? body.loras : []).filter(
    (lora) => lora?.name && lora.enabled !== false,
  );
  const loraTags = loras.map(
    (lora) => `<lora:${stem(lora.name)}:${Number(Number(lora.strength ?? 0.7).toFixed(2))}>`,
  );
  const prompt = [String(body.prompt || "").trim(), ...loraTags].filter(Boolean).join(" ");
  const lines = [prompt];
  if (String(body.negative || "").trim())
    lines.push(`Negative prompt: ${String(body.negative).trim()}`);
  const modelFile = body.modelName || body.model || "";
  const settings = [];
  if (Number(body.steps) > 0) settings.push(["Steps", Number(body.steps)]);
  if (body.sampler) settings.push(["Sampler", a1111Sampler(body.sampler)]);
  if (body.scheduler && body.scheduler !== "normal")
    settings.push(["Schedule type", scheduleNames[body.scheduler] || body.scheduler]);
  if (Number(body.cfg) > 0) settings.push(["CFG scale", Number(body.cfg)]);
  if (/^\d+$/.test(String(body.seed ?? "").trim()))
    settings.push(["Seed", String(body.seed).trim()]);
  const w = Number(width || body.width || 0);
  const h = Number(height || body.height || 0);
  if (w && h) settings.push(["Size", `${w}x${h}`]);
  if (modelFile && hashes[modelFile]) settings.push(["Model hash", hashes[modelFile]]);
  if (modelFile && !String(modelFile).startsWith("custom:"))
    settings.push(["Model", stem(modelFile)]);
  const hasReference = Boolean(
    body.startImageId || body.startImage || body.referenceAssets?.length,
  );
  if (hasReference && Number(body.denoise) > 0 && Number(body.denoise) < 1)
    settings.push(["Denoising strength", Number(body.denoise)]);
  const loraHashes = loras
    .filter((lora) => hashes[lora.name])
    .map((lora) => `${stem(lora.name)}: ${hashes[lora.name]}`);
  if (loraHashes.length) settings.push(["Lora hashes", loraHashes.join(", ")]);
  if (appVersion) settings.push(["Version", `Studio ${appVersion}`]);
  if (settings.length)
    lines.push(settings.map(([key, value]) => `${key}: ${field(value)}`).join(", "));
  return lines.join("\n");
}

/* ------------------------------------------------------------ Writing */

function outputFile(output) {
  const media = mediaParams(output?.url);
  return media ? mediaFile(media.filename, media.subfolder) : null;
}

/**
 * Writes the parameters text into a run's PNGs in Studio media, all of them at
 * once and without holding up the server. A file that is not a PNG is left as
 * it is. Never rejects: a run's images matter more than their tags. Resolves to
 * how many it wrote.
 */
export async function writeCivitaiParameters(outputs, body) {
  const files = (outputs || [])
    .filter((output) => output?.type !== "video")
    .map(outputFile)
    .filter((file) => file && /\.png$/i.test(file));
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const buffer = await fs.promises.readFile(file);
        const width = buffer.length > 24 ? buffer.readUInt32BE(16) : 0;
        const height = buffer.length > 24 ? buffer.readUInt32BE(20) : 0;
        const next = withPngText(buffer, "parameters", parametersText(body, { width, height }));
        if (!next) return false;
        await writeBytesFileAsync(file, next);
        return true;
      } catch {
        // Read-only folder, or the file moved: it simply goes without.
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
