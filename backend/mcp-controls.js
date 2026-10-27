// SPDX-License-Identifier: AGPL-3.0-only
// Which Generate arguments a profile lets MCP adjust; fixed controls are never advertised.
import { referenceImageSize } from "./generation-defaults.js";
import { loraCompatibility, strengthRange } from "./lora-policy.js";

/** Chat asks for one output unless the user asks for more; the studio UI keeps its own default. */
export const mcpGenerationCount = 1;
/** Jobs one Generate call may queue: every prompt times count. */
export const maxJobsPerCall = 10;

const fixedRange = (range) =>
  Boolean(range) && Number.isFinite(range.min) && range.min === range.max;
const rangeOf = (range, fallback, fallbackDefault) => {
  const value = {
    ...fallback,
    ...(range && typeof range === "object"
      ? Object.fromEntries(
          ["min", "max", "step"]
            .filter((key) => Number.isFinite(range[key]))
            .map((key) => [key, range[key]]),
        )
      : {}),
  };
  return Number.isFinite(fallbackDefault) ? { ...value, default: fallbackDefault } : value;
};
/** ComfyUI skips the unconditional pass at exactly CFG 1, so a negative prompt has no effect there. */
export const cfgIgnoresNegative = (cfg) =>
  Number.isFinite(Number(cfg)) && Math.abs(Number(cfg) - 1) < 1e-6;

/** Adjustable Generate controls in the order agents should consider them, with ranges, options and defaults. */
export function mcpControls(profile) {
  const caps = profile.capabilities || {};
  const constraints = profile.constraints || {};
  const defaults = profile.defaults || {};
  const options = profile.options || {};
  const controls = {};
  for (const key of ["width", "height"])
    if (!fixedRange(constraints[key]))
      controls[key] = rangeOf(constraints[key], { min: 64 }, defaults[key]);
  controls.count = {
    min: 1,
    max: maxJobsPerCall,
    default: mcpGenerationCount,
    note: `Each output is a separate job; prompts × count is at most ${maxJobsPerCall} per call.`,
  };
  if (caps.seed !== false) controls.seed = { min: 0 };
  if (caps.steps !== false && !fixedRange(constraints.steps))
    controls.steps = rangeOf(constraints.steps, { min: 1 }, defaults.steps);
  const cfgAdjustable = Boolean(caps.cfg) && !fixedRange(constraints.cfg);
  if (cfgAdjustable) controls.cfg = rangeOf(constraints.cfg, { min: 0, max: 100 }, defaults.cfg);
  if (caps.negativePrompt && (cfgAdjustable || !cfgIgnoresNegative(defaults.cfg))) {
    controls.negative_prompt = cfgIgnoresNegative(defaults.cfg)
      ? { note: "Has no effect at cfg 1; set cfg above 1 with it." }
      : {};
  }
  if (caps.denoise)
    controls.denoise = rangeOf(constraints.denoise, { min: 0, max: 1 }, defaults.denoise);
  for (const key of ["sampler", "scheduler"]) {
    const list = options[`${key}s`];
    if (caps[key] && Array.isArray(list) && list.length > 1)
      controls[key] = { options: list, ...(defaults[key] ? { default: defaults[key] } : {}) };
  }
  if (caps.lora !== false && Array.isArray(options.loras) && options.loras.length)
    controls.loras = { max: profile.maxLoras || 8 };
  const slots = profile.mediaInputs || [];
  if (slots.length)
    controls.reference_asset_ids = { max: slots.length, slots: slots.map((slot) => slot.id) };
  if (profile.kind === "image") {
    controls.upscale_quality = {
      options: ["fast", "balanced", "high"],
      note: "Only when the user asks to upscale or enlarge.",
    };
    controls.face_detail = {
      note: "Requires upscale_quality. With upscale_quality set, it turns on by itself for a full-body person.",
    };
  }
  return controls;
}

/** The value a fixed control always uses, when the profile states one. */
function fixedValue(profile, field) {
  const key = { negative_prompt: "negative" }[field] || field;
  const range = profile.constraints?.[key];
  if (fixedRange(range)) return range.min;
  if (["sampler", "scheduler"].includes(field) && profile.options?.[`${field}s`]?.length === 1)
    return profile.options[`${field}s`][0];
  return undefined;
}

/**
 * The controls Models lists: a guide that says the profile takes no negative (effect "none") keeps
 * negative_prompt out of the listing, so the chat never suggests one; a negative the user gives still runs.
 */
export function listedControls(profile) {
  const controls = mcpControls(profile);
  if (profile.prompting?.negative?.effect === "none") delete controls.negative_prompt;
  return controls;
}

/** Rejects a supplied control the profile does not let MCP adjust, naming it and the adjustable alternatives. */
export function assertAdjustable(profile, args) {
  const controls = mcpControls(profile);
  const adjustable = Object.keys(controls).join(", ");
  for (const field of [
    "width",
    "height",
    "seed",
    "steps",
    "cfg",
    "negative_prompt",
    "denoise",
    "sampler",
    "scheduler",
    "loras",
    "reference_asset_ids",
    "reference_role",
    "upscale_quality",
  ]) {
    const value = args[field];
    if (value === undefined || (Array.isArray(value) && !value.length) || controls[field]) continue;
    if (field === "negative_prompt" && value === "") continue;
    const fixed = fixedValue(profile, field);
    if (fixed !== undefined && fixed === value) continue;
    let reason = fixed !== undefined ? ` It is fixed at ${fixed}.` : "";
    if (field === "cfg" && profile.capabilities?.cfg === false)
      reason = " This profile is guidance-distilled and runs at its own CFG; leave cfg out.";
    if (field === "negative_prompt")
      reason = profile.capabilities?.negativePrompt
        ? " This profile runs at cfg 1 (guidance-distilled), where a negative prompt has no effect. Describe what you want positively in the prompt instead."
        : " This profile has no negative prompt input (guidance-distilled). Describe what you want positively in the prompt instead.";
    throw new Error(
      `${field} cannot be adjusted for ${profile.label || profile.id}.${reason} Adjustable controls: ${adjustable}.`,
    );
  }
  for (const field of ["width", "height", "steps", "cfg", "denoise"]) {
    const value = args[field];
    const range = controls[field];
    if (value === undefined || !range) continue;
    if (
      !Number.isFinite(value) ||
      (Number.isFinite(range.min) && value < range.min) ||
      (Number.isFinite(range.max) && value > range.max)
    )
      throw new Error(
        `Choose ${field} from ${range.min ?? 0} to ${range.max ?? "the profile maximum"} for this profile.`,
      );
  }
  for (const field of ["sampler", "scheduler"])
    if (
      args[field] !== undefined &&
      controls[field] &&
      !controls[field].options.includes(args[field])
    )
      throw new Error(`Choose ${field} from: ${controls[field].options.join(", ")}.`);
  if (
    args.negative_prompt &&
    controls.negative_prompt &&
    cfgIgnoresNegative(args.cfg ?? profile.defaults?.cfg)
  ) {
    throw new Error(
      `negative_prompt has no effect at cfg 1 for ${profile.label || profile.id}. Set cfg above 1 (up to ${controls.cfg?.max ?? "its maximum"}) together with negative_prompt, or describe what you want positively in the prompt instead.`,
    );
  }
  return controls;
}

const clip = (value, length) => {
  const textValue = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return textValue.length > length ? `${textValue.slice(0, length - 1)}…` : textValue;
};
// CamelCase file names split into their words too.
const words = (value) =>
  String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const squash = (value) => words(value).join("");
// Words a title shares with most LoRA names, so they never justify a hint on their own.
const filler = new Set([
  "lora",
  "loras",
  "style",
  "model",
  "by",
  "the",
  "and",
  "for",
  "with",
  "of",
  "a",
  "an",
  "in",
  "v1",
  "v2",
  "v3",
  "v4",
  "v5",
]);
/** A LoRA file name without its folder or extension. */
const stem = (name) =>
  String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/\.(?:safetensors|ckpt|pt|pth|bin)$/i, "");
const maxDetails = 5;

/** Profile-compatible optional LoRAs, verified fits first, then by name; the studio picker ranks the same way. */
function loraCandidates(profile, infos) {
  if (profile.capabilities?.lora === false) return [];
  const entries = [];
  for (const name of profile.options?.loras || []) {
    const info = infos[name];
    // Infrastructure weights cannot enter the optional stack, and other architectures never fit.
    if (["acceleration", "supporting"].includes(info?.role)) continue;
    const fit = loraCompatibility(info, profile);
    if (fit !== "other") entries.push({ name, info, fit });
  }
  return entries.sort(
    (left, right) =>
      Number(left.fit === "unknown") - Number(right.fit === "unknown") ||
      left.name.localeCompare(right.name),
  );
}

/** Each LoRA's shortest name that Generate still resolves: its stem when no other file shares it. */
function shortNames(profile) {
  const counts = new Map();
  for (const name of profile.options?.loras || [])
    counts.set(squash(stem(name)), (counts.get(squash(stem(name))) || 0) + 1);
  return (name) =>
    counts.get(squash(stem(name))) === 1
      ? stem(name)
      : name.replace(/\.(?:safetensors|ckpt|pt|pth|bin)$/i, "");
}

/**
 * One index line: the name, then only what it does not already say: for a name that does not
 * describe the LoRA, the title's other words as a hint, and its first trigger word to prompt with.
 */
function indexLine({ info, fit }, short) {
  const known = new Set(words(short));
  const novel = (value) =>
    words(value).some((word) => !known.has(word) && !filler.has(word) && !/^\d+$/.test(word));
  // A name of two or more descriptive words already says what the LoRA does.
  const descriptive = [...known].filter(
    (word) => word.length > 2 && /^[a-z]+$/.test(word) && !filler.has(word),
  ).length;
  const hint =
    descriptive < 2
      ? clip(
          String(info?.title || "")
            .split(/\s+/)
            .filter(novel)
            .join(" "),
          40,
        )
      : "";
  const trigger = clip((info?.triggers || []).find(novel), 24);
  return `${short}${hint ? ` — ${hint}` : ""}${trigger ? ` [${trigger}]` : ""}${fit === "unknown" ? " (unverified)" : ""}`;
}

/** Everything the studio picker knows about one LoRA, for an explicit lookup. */
function loraDetail({ name, info, fit }, short) {
  const range = strengthRange(info);
  return {
    name: short,
    ...(info?.title ? { title: clip(info.title, 120) } : {}),
    ...(info?.description ? { description: clip(info.description, 280) } : {}),
    ...(info?.triggers?.length ? { trigger_words: info.triggers.slice(0, 12) } : {}),
    strength: range
      ? { recommended: range.default ?? 0.7, min: range.min, max: range.max }
      : { recommended: 0.7 },
    ...(info?.base ? { trained_for: info.base } : {}),
    ...(info?.sourceUrl ? { source_url: info.sourceUrl } : {}),
    ...(info?.note ? { note: clip(info.note, 200) } : {}),
    ...(fit === "unknown" ? { compatibility: "unverified" } : {}),
  };
}

/** Word overlap between a request and a candidate's names, for ranking near misses. */
const closeness = (value, ...names) => {
  const wanted = words(value);
  const have = names.flatMap(words);
  return (
    wanted.filter((word) => have.some((item) => item === word)).length * 2 +
    wanted.filter((word) =>
      have.some((item) => item !== word && (item.includes(word) || word.includes(item))),
    ).length
  );
};
/** The few candidates closest to a name that matched none, best first. */
export function closest(candidates, value, label, count = 3) {
  return candidates
    .map((candidate) => ({ candidate, score: closeness(value, ...label(candidate)) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, count)
    .map((item) => item.candidate);
}

/** The profile LoRA a name means: exact, then case-insensitive, then a unique stem or folder-less match. */
export function resolveLoraName(profile, value) {
  const names = profile.options?.loras || [];
  if (names.includes(value)) return value;
  const key = squash(value);
  for (const pick of [
    (name) => squash(name) === key,
    (name) => squash(stem(name)) === key || squash(stem(name)) === squash(stem(value)),
  ]) {
    const found = names.filter(pick);
    if (found.length === 1) return found[0];
  }
  return null;
}

/**
 * Compatible LoRAs for Models. Without a lookup, a compact index of every compatible LoRA;
 * with lora_query or lora_names, full details for the first few matches.
 */
export function mcpLoras(profile, infos = {}, { query = "", names = [] } = {}) {
  const candidates = loraCandidates(profile, infos);
  const short = shortNames(profile);
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle && !names.length)
    return {
      loras: candidates.map((entry) => indexLine(entry, short(entry.name))),
      total: candidates.length,
    };
  let matches;
  const missing = [];
  if (names.length) {
    matches = [];
    for (const value of names) {
      const name = resolveLoraName(profile, value);
      const entry = candidates.find((item) => item.name === name);
      if (entry && !matches.includes(entry)) matches.push(entry);
      else if (!entry) missing.push(value);
    }
  } else {
    // Name matches lead, then titles, then trigger words and descriptions.
    const rank = ({ name, info }) =>
      [stem(name), info?.title, [...(info?.triggers || []), info?.description].join(" ")].findIndex(
        (value) =>
          String(value || "")
            .toLowerCase()
            .includes(needle),
      );
    matches = candidates
      .map((entry) => ({ entry, rank: rank(entry) }))
      .filter((item) => item.rank >= 0)
      .sort((left, right) => left.rank - right.rank)
      .map((item) => item.entry);
  }
  return {
    loras: matches.slice(0, maxDetails).map((entry) => loraDetail(entry, short(entry.name))),
    total: candidates.length,
    ...(matches.length > maxDetails
      ? {
          more: matches
            .slice(maxDetails, maxDetails * 5)
            .map((entry) => indexLine(entry, short(entry.name))),
        }
      : {}),
    ...(missing.length
      ? {
          missing: missing.map((value) => ({
            name: value,
            closest: closest(candidates, value, (item) => [stem(item.name), item.info?.title]).map(
              (item) => short(item.name),
            ),
          })),
        }
      : {}),
  };
}

/**
 * Generate's LoRA stack for a profile: each name resolved to its file, refused with the closest
 * matches when unknown or unusable, and given its recommended strength when none is supplied.
 */
export function prepareLoras(profile, infos = {}, loras = []) {
  const candidates = loraCandidates(profile, infos);
  const short = shortNames(profile);
  const label = profile.label || profile.id;
  // Refused, not trimmed: Generate's own check keeps only the first ones, which would drop the caller's picks silently.
  const max = Math.max(1, Math.min(8, Number(profile.maxLoras) || 8));
  if (loras.length > max)
    throw new Error(`${label} takes at most ${max} LoRAs; pass ${max} or fewer.`);
  const stack = [];
  for (const { name: value, strength, triggers } of loras) {
    const name = resolveLoraName(profile, value);
    const entry = candidates.find((item) => item.name === name);
    if (!entry) {
      if (name && ["acceleration", "supporting"].includes(infos[name]?.role))
        throw new Error(`${value} is applied by Studio itself; leave it out of loras.`);
      if (name)
        throw new Error(
          `${value} is for ${infos[name]?.base || "another model family"}, not ${label}; choose a LoRA from Models for this profile.`,
        );
      const near = closest(candidates, value, (item) => [stem(item.name), item.info?.title]).map(
        (item) => short(item.name),
      );
      throw new Error(
        `No LoRA named ${value} for ${label}.${near.length ? ` Closest: ${near.join(", ")}.` : ""} Call Models with lora_query to look one up.`,
      );
    }
    if (stack.some((item) => item.name === name)) continue;
    const range = strengthRange(entry.info);
    stack.push({
      name,
      strength: Number.isFinite(strength) ? strength : (range?.default ?? 0.7),
      // A reused run keeps Trigger Words off; MCP callers never set it themselves.
      ...(triggers === false ? { triggers } : {}),
    });
  }
  return stack;
}

const orientations = {
  landscape: "landscape",
  wide: "landscape",
  horizontal: "landscape",
  portrait: "portrait",
  tall: "portrait",
  vertical: "portrait",
  square: "square",
};
const longSides = { "2k": 2048, "4k": 4096 };
/**
 * The width and height for an aspect ("landscape", "portrait", "square" or a ratio such as 16:9)
 * and a size ("2k" or "4k"): the profile's own preset for the aspect, scaled to the long side the
 * profile draws natively. Null when neither is given, so the saved size applies.
 */
export function mcpSize(profile, { aspect, size } = {}) {
  if (!aspect && !size) return null;
  const label = profile.label || profile.id;
  const defaults = profile.defaults || {};
  const presets = (profile.aspectPresets || []).filter((item) => item.w > 0 && item.h > 0);
  let width = Number(defaults.width) || 1024;
  let height = Number(defaults.height) || width;
  if (aspect) {
    const key = String(aspect).trim().toLowerCase().slice(0, 20);
    const orientation = orientations[key];
    const ratio = /^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/.exec(key);
    if (!orientation && !(ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0))
      throw new Error(`Choose aspect from landscape, portrait, square or a ratio such as 16:9.`);
    const shape = (w, h) => (w > h ? "landscape" : w < h ? "portrait" : "square");
    const wanted = orientation ? null : Number(ratio[1]) / Number(ratio[2]);
    // The profile's own preset when one fits, in its own order; otherwise the ratio at its default pixel count.
    const preset = orientation
      ? presets.find((item) => shape(item.w, item.h) === orientation)
      : presets.find((item) => Math.abs(Math.log(item.w / item.h) - Math.log(wanted)) < 0.02);
    if (preset) ({ w: width, h: height } = preset);
    else {
      const [rw, rh] = orientation
        ? { landscape: [16, 9], portrait: [9, 16], square: [1, 1] }[orientation]
        : [wanted, 1];
      const fitted = referenceImageSize(profile, { width: rw * 1000, height: rh * 1000 });
      if (fitted) ({ width, height } = fitted);
    }
  }
  if (size) {
    if (profile.kind !== "image" || !profile.native?.[size])
      throw new Error(
        `${label} does not draw ${size.toUpperCase()} natively. Omit size, choose another profile, or use upscale_quality for a larger image.`,
      );
    const scale = longSides[size] / Math.max(width, height);
    const snap = (value, range = {}) => {
      const step = Number(range.step) || 16;
      return Math.max(
        Number(range.min) || step,
        Math.min(Number(range.max) || 16384, Math.round(value / step) * step),
      );
    };
    width = snap(width * scale, profile.constraints?.width);
    height = snap(height * scale, profile.constraints?.height);
  }
  return { width, height };
}
