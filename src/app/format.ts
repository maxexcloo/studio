import { partName } from './partNames';
import type React from 'react';
import type { AspectPreset, GalleryItem, LoraSelection } from './types';

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function aspectIconStyle(option: AspectPreset): React.CSSProperties {
  const scale = Math.min(38 / option.w, 28 / option.h);
  return {
    width: Math.max(13, Math.round(option.w * scale)),
    height: Math.max(13, Math.round(option.h * scale))
  };
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" || typeof item === "number") ? String(item) : "").filter(Boolean).join(" ");
  if (typeof value === "number") return String(value);
  return "";
}

export function titleFromPrompt(text: unknown = "") {
  const compact = textValue(text).replace(/\s+/g, " ").trim();
  return compact.length > 76 ? `${compact.slice(0, 73)}...` : compact;
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

let clock: Intl.DateTimeFormat | null = null;
/** The one clock-time format ("2:14 PM"), made once: creating a formatter per tile is slow when a gallery page lands. */
export function clockFormat() {
  return clock || (clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }));
}

/** "2:14 PM" for a date or timestamp, or "" when there is none. */
export function clockTime(value?: string | number | Date | null) {
  if (value === undefined || value === null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : clockFormat().format(date);
}

export function formatGeneratedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** No prompt gets longer than this, whatever the model says: far past any real prompt, short of a pasted novel. */
export const HARD_TEXT_LIMIT = 100_000;

export function settingMax(meta?: { max?: number }) {
  return Number.isFinite(meta?.max) && Number(meta?.max) > 0 ? Math.min(Number(meta?.max), HARD_TEXT_LIMIT) : HARD_TEXT_LIMIT;
}

export function textLength(text: string) {
  return Array.from(text).length;
}

export function characterMeta(text: string, limit?: number) {
  const length = textLength(text);
  if (!limit) return `${length.toLocaleString()} chars`;
  return `${length.toLocaleString()} / ${limit.toLocaleString()}`;
}

/** The counter only earns its space near the limit; an unlimited prompt never shows one. */
export function nearTextLimit(text: string, limit?: number) {
  return Boolean(limit) && textLength(text) >= (limit as number) * 0.8;
}

export function clampText(text: string, limit?: number) {
  return limit ? Array.from(text).slice(0, limit).join("") : text;
}

function activeLoras(value: unknown): LoraSelection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item?.enabled !== false && item?.name);
}

function formatLoraStack(value: unknown) {
  return activeLoras(value).map((item) => `${item.name} (${Number(item.strength ?? 0.7).toFixed(2)})`).join(", ");
}

export function fullGenerationText(item: GalleryItem) {
  const settings = item.settings || {};
  const grok = String(settings.modelName || "").startsWith("grok-imagine-");
  const lines = [
    `Prompt: ${item.prompt || ""}`,
    `Negative prompt: ${item.negative || ""}`,
    `Model: ${item.model || ""}`,
    `Output: ${item.outputName || item.filename || ""}`,
    `Type: ${item.type}`,
    `Aspect: ${item.width || "?"}x${item.height || "?"}`,
    `Generated: ${formatGeneratedAt(item.createdAt)}`
  ];
  for (const [key, value] of Object.entries(settings)) {
    if (grok && ["steps", "cfg", "sampler", "scheduler"].includes(key)) continue;
    if (value !== "" && value !== undefined && value !== null && value !== 0) {
      lines.push(`${key}: ${key === "loras" ? formatLoraStack(value) : value}`);
    }
  }
  return lines.join("\n");
}

/** "flux1-dev-fp8.safetensors" (or a path to it) → "flux1-dev-fp8". */
export function fileStem(name: unknown) {
  return String(name || "").split(/[\\/]/).pop()!.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

/**
 * "Copy settings": the prompt and what made the picture, as plain text to
 * paste into a note, a chat or another tool. Only what matters, no internals.
 */
export function settingsText(item: GalleryItem) {
  const settings = item.settings || {};
  const grok = String(settings.modelName || "").startsWith("grok-imagine-");
  const lines = [String(item.prompt || "").trim()];
  if (String(item.negative || "").trim()) lines.push(`Negative prompt: ${String(item.negative).trim()}`);
  const model = settings.modelName || (String(item.model || "").startsWith("custom:") ? "" : item.model);
  const parts = [
    model ? `Model: ${fileStem(model)}` : "",
    !grok && Number(settings.steps) ? `Steps: ${settings.steps}` : "",
    !grok && Number(settings.cfg) ? `CFG: ${settings.cfg}` : "",
    !grok && settings.sampler ? `Sampler: ${settings.sampler}${settings.scheduler ? ` (${settings.scheduler})` : ""}` : "",
    /^\d+$/.test(String(settings.seed ?? "")) ? `Seed: ${settings.seed}` : "",
    item.width && item.height ? `Size: ${item.width}×${item.height}` : "",
    !String(settings.modelName || "").endsWith(".rad") && settings.denoise && (item.referenceImage || settings.referenceImageName) ? `Denoise: ${settings.denoise}` : ""
  ].filter(Boolean);
  if (parts.length) lines.push(parts.join(" · "));
  const loras = activeLoras(settings.loras);
  if (loras.length) lines.push(`LoRAs: ${loras.map((lora) => `${fileStem(lora.name)} ${Number(lora.strength ?? 0.7).toFixed(2)}`).join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

const assistantPresetNames: Record<string, string> = { enhance: "Enhance", spicy: "Spicy", photographic: "Photographic", cinematic: "Cinematic", concise: "Concise", candid: "Candid" };

/** Who wrote the prompt, for Details and Copy: "Assistant · Enhance", or "Assistant in Chat · Enhance". */
export function assistantSummary(item: Pick<GalleryItem, "assistant">) {
  const record = item.assistant;
  if (!record?.preset) return "";
  const preset = assistantPresetNames[record.preset] || record.preset.replace(/^./, (letter) => letter.toUpperCase());
  return `Assistant${record.source === "chat" ? " in Chat" : ""} · ${preset}`;
}

export type GenerationDetailSection = { title: string; rows: Array<[string, string]>; loras?: Array<{ name: string; file: string; strength: string }>; note?: string };

/**
 * The "Generation details" panel, most useful first: what made the picture
 * (model, LoRAs as cards of their own), then how it was sampled, then the
 * size, then file metadata.
 */
/** A Details group's rows in alphabetical order of their labels. */
export function sortDetailRows(section: GenerationDetailSection) {
  section.rows.sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export function generationDetailEntries(item: GalleryItem, names: { profile?: string; lora?: (file: string) => string } = {}): GenerationDetailSection[] {
  const settings = item.settings || {};
  const grok = String(settings.modelName || "").startsWith("grok-imagine-");
  const sections: GenerationDetailSection[] = [];
  const section = (title: string, build: (add: (label: string, value: unknown) => void) => void) => {
    const rows: Array<[string, string]> = [];
    build((label, value) => {
      if (value === "" || value === undefined || value === null || value === 0 || value === false) return;
      rows.push([label, String(value)]);
    });
    if (rows.length) sections.push({ title, rows });
  };
  const model = settings.modelName || (String(item.model || "").startsWith("custom:") ? "" : item.model);
  // The profile it ran through, by name; never the weights file (UI-PATTERNS › Action Placement › Details).
  // An older record without a profile names its weights instead, under the same row.
  section("Model", (add) => {
    add("Profile", names.profile || (model ? partName(String(model)) : ""));
  });
  // Written by the prompt assistant: its preset, and the suggested LoRAs that were chosen.
  section("Prompt", (add) => {
    add("Written By", assistantSummary(item));
    const chosen = (item.assistant?.lorasSuggested || []).map((file) => names.lora ? names.lora(file) : fileStem(file));
    if (chosen.length) add("Suggested LoRAs", chosen.join(", "));
  });
  // Friendly names (the catalogue's title), the file kept beside them for a tooltip and Copy Settings.
  const loras = activeLoras(settings.loras).map((lora) => ({ name: names.lora ? names.lora(lora.name) : fileStem(lora.name), file: String(lora.name).split(/[\\/]/).pop() || String(lora.name), strength: Number(lora.strength ?? 0.7).toFixed(2) }));
  if (loras.length) {
    const modelSection = sections.find((item) => item.title === "Model");
    if (modelSection) modelSection.loras = loras;
    else sections.push({ title: "Model", rows: [], loras });
  }
  section("Settings", (add) => {
    if (!grok) {
      add("Steps", settings.steps);
      add("CFG", settings.cfg);
      add("Sampler", settings.sampler);
      add("Scheduler", settings.scheduler);
    }
    add("Seed", settings.seed);
    if (item.type === "image" && !String(settings.modelName || "").endsWith(".rad") && (item.referenceImage || settings.referenceImageName)) add("Denoise", settings.denoise);
  });
  // What came out, the picture and its file together (UI-PATTERNS › Action Placement › Details).
  section("Output", (add) => {
    // The size of the picture shown: an upscale's own size when that's the one on screen.
    const upscaled = item.upscaleActive && item.upscale?.status === "done" && item.upscale.width && item.upscale.height ? item.upscale : null;
    add("Size", upscaled ? `${upscaled.width} × ${upscaled.height}` : `${item.width || "?"} × ${item.height || "?"}`);
    if (settings.resolution) add("Resolution", settings.resolution);
    if (upscaled) add("Drawn At", `${item.width || "?"} × ${item.height || "?"}`);
    if (settings.duration) add("Duration", `${settings.duration} Seconds`);
    if (item.type === "image") {
      const count = Number(settings.count || 0);
      if (count > 1) add("Images", count);
      if (item.referenceImage || settings.referenceImageName) add("Reference", settings.referenceImageName || item.referenceImageName || "Selected");
    }
    if (item.type === "video") {
      add("Frames", settings.frames);
      add("FPS", settings.fps);
    }
    add("File", item.outputName || item.filename);
    add("Generated", formatGeneratedAt(item.createdAt));
  });
  // Rows read alphabetically; Timing reads in its own order.
  for (const entry of sections) sortDetailRows(entry);
  section("Timing", (add) => {
    const timing = item.timing;
    const elapsed = (value?: number) => value !== undefined && Number.isFinite(value) && value >= 0 ? formatElapsed(value) : "";
    // Active leads (the time shown everywhere else), then Total and Queue, then the run's phases in order.
    add("Active", elapsed(timing?.runMs));
    add("Total", item.durationMs ? formatElapsed(item.durationMs) : "");
    add("Queue", elapsed(timing?.queueMs));
    add("Setup", elapsed(timing?.setupMs));
    add("Sampling", elapsed(timing?.samplingMs));
    add("Finishing", elapsed(timing?.finishMs));
    add("Upscale", elapsed(timing?.upscaleMs));
  });
  return sections;
}

// crypto.randomUUID is exposed only in secure contexts, so it is missing when the
// app is opened over plain HTTP on a LAN address. getRandomValues has no such
// restriction, so fall back to building a v4 UUID from it.
export function clientJobUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A download's size, rounded the way setup screens show it: "6.5 GB", "320 MB"; "" when unknown. */
export function formatDownloadSize(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** "1 model", "3 models", "1,204 recent prompts". */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
