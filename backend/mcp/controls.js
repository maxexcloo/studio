import {
  guidingRoles,
  loraCompatibility,
  loraDefaultStrength,
  maxLoras,
} from "../../shared/profiles.ts";
import { availableResolutions, resolutions as resolutionTiers } from "../../shared/resolution.ts";
import { upscaleQualities } from "../../shared/upscale.ts";
// Which generate arguments a profile lets MCP adjust; fixed controls are never advertised.
import { referenceImageSize } from "../generation-defaults.js";
import { strengthRange } from "../lora/policy.js";
import { keptTriggers } from "../lora/prompts.js";

/** Images per prompt a chat gets unless the user asks for a number (videos get one); the studio UI keeps its own default. */
export const mcpGenerationCount = 2;
/** Images one batch of a generate call queues: its prompts times count. */
export const maxJobsPerCall = 10;
/** Images one generate call may queue, in batches of maxJobsPerCall. */
export const maxSplitJobs = 3 * maxJobsPerCall;

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

/** Adjustable generate controls in the order agents should consider them, with ranges, options and defaults. */
export function mcpControls(profile) {
  const caps = profile.capabilities || {};
  const constraints = profile.constraints || {};
  const defaults = profile.defaults || {};
  const options = profile.options || {};
  const controls = {};
  // Sizes are the profile's own presets, as the composer offers them, never a free width and height.
  if (!fixedRange(constraints.width) || !fixedRange(constraints.height)) {
    const presets = profile.aspectPresets || [];
    const fallback = profile.aspectDefault || presets.find((item) => item.default)?.label;
    controls.aspect = {
      options: Object.fromEntries(presets.map((item) => [item.label, `${item.w}×${item.h}`])),
      ...(fallback ? { default: fallback } : {}),
    };
  }
  const resolutions =
    profile.kind === "image" && options.resolutions?.length
      ? resolutionTiers.filter((tier) =>
          options.resolutions.some((value) => value.toUpperCase() === tier),
        )
      : availableResolutions(profile);
  if (resolutions.length)
    controls.resolution = {
      options: resolutions,
      default:
        resolutions.find((tier) => tier === defaults.resolution?.toUpperCase()) || resolutions[0],
    };
  controls.count = {
    min: 1,
    max: maxJobsPerCall,
    default: profile.kind === "video" ? 1 : mcpGenerationCount,
    note: `prompts × count is at most ${maxSplitJobs} per call.`,
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
    controls.loras = { max: profile.maxLoras || maxLoras };
  const slots = profile.mediaInputs || [];
  if (slots.length)
    controls.reference_asset_ids = {
      max: slots.length,
      slots: slots.map((slot) => slot.id),
      // What each slot guides, where the profile names it (Identity, Pose/Layout, Style).
      ...(slots.some((slot) => Object.hasOwn(guidingRoles, slot.role || ""))
        ? { roles: slots.map((slot) => guidingRoles[slot.role] ?? null) }
        : {}),
    };
  const strengths = slots.filter((slot) => slot.strength);
  if (strengths.length)
    controls.reference_strengths = {
      slots: Object.fromEntries(
        strengths.map(({ id, strength: { min, max, step, default: fallback } }) => [
          id,
          { min, max, step, default: fallback },
        ]),
      ),
      note: "One per reference_asset_ids entry, in order; only these slots take one.",
    };
  if (slots.length && profile.aspectPolicy === "reference")
    controls.reference_role = {
      options: ["edit", "reference"],
      note: "Requires reference_asset_ids. edit (the default) draws at the reference's proportions, whatever size is asked; reference only guides, and the asked size applies.",
    };
  if (profile.kind === "image") {
    controls.upscale_quality = {
      options: upscaleQualities,
      note: "Only when the user asks to upscale or enlarge.",
    };
    controls.face_detail = {
      note: "Requires upscale_quality. With upscale_quality set, it turns on by itself for a full-body person.",
    };
  }
  return controls;
}

/**
 * The generate fields for a video `seconds` long: the profile's duration, or frames at its FPS on
 * the frame grid the worker accepts (counted from the minimum, as backend/validation.js does, and as
 * the composer's Length chip offers). A length outside the profile's limits is refused with them.
 */
export function videoLength(profile, seconds) {
  const key = profile.capabilities?.duration === true ? "duration" : "frames";
  const fps = key === "duration" ? 1 : profile.defaults?.fps;
  const range = profile.constraints?.[key] || {};
  const { min = 1, max = Infinity, step = 1 } = range;
  const name = profile.label || profile.id;
  if (profile.capabilities?.[key] === false || min === max || !(fps > 0))
    throw new Error(`${name} has a fixed length; leave length out.`);
  const offset = range.offset ?? min;
  const value = offset + step * Math.round((seconds * fps - offset) / step);
  const time = (count) => `${Math.round((count / fps) * 10) / 10} s`;
  if (value < min || value > max)
    throw new Error(
      `${name} makes ${time(min)}${Number.isFinite(max) ? ` to ${time(max)}` : " or more"}; pick a length in that range.`,
    );
  return { [key]: value };
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
 * The controls models lists: a guide that says the profile takes no negative (effect "none") keeps
 * negative_prompt out of the listing, so the chat never suggests one; a negative the user gives still runs.
 */
export function listedControls(profile) {
  const controls = mcpControls(profile);
  if (profile.prompting?.negative?.effect === "none") delete controls.negative_prompt;
  return controls;
}

// Controls the profile sets itself: one given anyway is left out, as the request still runs as asked.
const ignorable = new Set(["seed", "steps", "cfg", "negative_prompt", "sampler", "scheduler"]);

/**
 * The profile's adjustable `controls`, and `args` without the ignorable ones it sets itself, with an
 * `ignored` note saying why each was left out ("" when none was). Any other control it does not let
 * MCP adjust is refused, naming it and the adjustable alternatives.
 */
export function assertAdjustable(profile, request) {
  const controls = mcpControls(profile);
  const args = { ...request };
  const notes = [];
  const leaveOut = (field, reason) => {
    delete args[field];
    notes.push(`${field} was left out:${reason}`);
  };
  const adjustable = Object.keys(controls).join(", ");
  for (const field of [
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
    "reference_strengths",
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
    if (ignorable.has(field)) {
      leaveOut(field, reason || " the profile sets it itself.");
      continue;
    }
    throw new Error(
      `${field} cannot be adjusted for ${profile.label || profile.id}.${reason} Adjustable controls: ${adjustable}.`,
    );
  }
  for (const field of ["steps", "cfg", "denoise"]) {
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
  )
    leaveOut(
      "negative_prompt",
      ` it has no effect at cfg 1. Next time set cfg above 1 (up to ${controls.cfg?.max ?? "its maximum"}) with it, or describe what you want positively in the prompt.`,
    );
  return { controls, args, ignored: notes.join(" ") };
}

export const clip = (value, length) => {
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

/** Liked first, then unrated, then disliked. */
const ratingOrder = (rating) => (rating === "liked" ? 0 : rating === "disliked" ? 2 : 1);

/**
 * Profile-compatible optional LoRAs, liked first, then verified fits, then by name; the studio
 * picker ranks the same way.
 */
function loraCandidates(profile, infos, ratings = {}) {
  if (profile.capabilities?.lora === false) return [];
  const entries = [];
  for (const name of profile.options?.loras || []) {
    const info = infos[name];
    // Infrastructure weights cannot enter the optional stack, and other architectures never fit.
    if (["acceleration", "supporting"].includes(info?.role) || info?.hidden) continue;
    const fit = loraCompatibility(info, profile);
    if (fit !== "other") entries.push({ name, info, fit });
  }
  return entries.sort(
    (left, right) =>
      ratingOrder(ratings[left.name]) - ratingOrder(ratings[right.name]) ||
      Number(left.fit === "unknown") - Number(right.fit === "unknown") ||
      left.name.localeCompare(right.name),
  );
}

/** Each LoRA's shortest name that generate still resolves: its stem when no other file shares it. */
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
function loraDetail({ info, fit }, short) {
  const range = strengthRange(info);
  return {
    name: short,
    ...(info?.title ? { title: clip(info.title, 120) } : {}),
    ...(info?.description ? { description: clip(info.description, 280) } : {}),
    ...(info?.triggers?.length ? { trigger_words: info.triggers.slice(0, 12) } : {}),
    strength: {
      recommended: loraDefaultStrength(info, 0.7),
      ...(range ? { min: range.min, max: range.max } : {}),
    },
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
    // A name cut short, as chats write a long file name, when only one file starts with it.
    (name) => key.length >= 8 && squash(stem(name)).startsWith(squash(stem(value))),
  ]) {
    const found = names.filter(pick);
    if (found.length === 1) return found[0];
  }
  return null;
}

// Words that ask for LoRAs in general ("lora", "all loras"), so a lookup made only of them lists every one.
const generalLoraWords = new Set([
  "a",
  "all",
  "any",
  "every",
  "list",
  "lora",
  "loras",
  "my",
  "show",
  "the",
]);
/** A LoRA lookup's words that name something, without the ones that only ask for LoRAs. */
export const loraQueryWords = (query) =>
  String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => {
      const bare = word.replace(/[^a-z0-9]/g, "");
      return bare && !generalLoraWords.has(bare);
    });

/** Every compatible LoRA as its file name and models' index line. */
export const loraIndex = (profile, infos = {}, ratings = {}) => {
  const short = shortNames(profile);
  return loraCandidates(profile, infos, ratings).map((entry) => ({
    name: entry.name,
    line: indexLine(entry, short(entry.name)),
  }));
};

/**
 * Compatible LoRAs for models. Without a lookup, a compact index of every compatible LoRA;
 * with lora_query or lora_names, full details for the first few matches.
 */
export function mcpLoras(profile, infos = {}, { query = "", names = [], ratings = {} } = {}) {
  const candidates = loraCandidates(profile, infos, ratings);
  const short = shortNames(profile);
  const wanted = loraQueryWords(query);
  if (!wanted.length && !names.length)
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
    // Name matches lead, then titles, then trigger words and descriptions; every word must appear somewhere.
    const rank = ({ name, info }) => {
      const fields = [
        stem(name),
        info?.title,
        [...(info?.triggers || []), info?.description].join(" "),
      ].map((value) => String(value || "").toLowerCase());
      const found = fields.findIndex((field) => wanted.every((word) => field.includes(word)));
      if (found >= 0) return found;
      return wanted.every((word) => fields.some((field) => field.includes(word)))
        ? fields.length
        : -1;
    };
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

// Words naming a model family or version in LoRA file names, which an equivalent for another family changes.
const familyWords = new Set([
  "chroma",
  "dev",
  "flux",
  "flux1",
  "flux2",
  "hidream",
  "il",
  "illustrious",
  "klein",
  "krea",
  "noct",
  "pony",
  "qwen",
  "schnell",
  "sd",
  "sd15",
  "sdxl",
  "wan",
  "xl",
  "zimage",
]);
/** What a LoRA name says it does, without its family, version and filler words. */
const loraCore = (name, extra = []) => {
  const skip = new Set(extra.flatMap(words));
  return words(stem(name))
    .filter(
      (word) =>
        !filler.has(word) && !familyWords.has(word) && !skip.has(word) && !/^v?\d+$/.test(word),
    )
    .join("");
};
/** This profile's LoRA that does what `value` (a name for another family) does, by its name. */
const equivalentLora = (candidates, value, profile, info) => {
  const core = loraCore(value, [profile.family, profile.label, info?.base]);
  if (core.length < 4) return undefined;
  const cores = candidates.map((entry) => [
    entry,
    loraCore(entry.name, [profile.family, profile.label, entry.info?.base]),
  ]);
  return (
    cores.find(([, other]) => other === core) ||
    cores.find(
      ([, other]) => other.length >= 4 && (other.startsWith(core) || core.startsWith(other)),
    )
  )?.[0];
};

/**
 * The generate tool's LoRA stack for a profile: each name resolved to its file, and given its
 * recommended strength when none is supplied. A LoRA for another family becomes this profile's
 * equivalent by name, or is left out, each with a line in `notes`; an unknown name is refused with
 * the closest matches.
 */
export function prepareLoras(profile, infos = {}, loras = [], notes = []) {
  const candidates = loraCandidates(profile, infos);
  const short = shortNames(profile);
  const label = profile.label || profile.id;
  // Refused, not trimmed: generate's own check keeps only the first ones, which would drop the caller's picks silently.
  const max = Math.max(1, Math.min(maxLoras, Number(profile.maxLoras) || maxLoras));
  if (loras.length > max)
    throw new Error(`${label} takes at most ${max} LoRAs; pass ${max} or fewer.`);
  const stack = [];
  for (const { name: value, strength, triggers } of loras) {
    const name = resolveLoraName(profile, value);
    let entry = candidates.find((item) => item.name === name);
    if (!entry) {
      if (name && ["acceleration", "supporting"].includes(infos[name]?.role))
        throw new Error(`${value} is applied by Studio itself; leave it out of loras.`);
      if (name && infos[name]?.hidden)
        throw new Error(`${value} is hidden in Studio's Library; choose another LoRA.`);
      const equivalent = equivalentLora(candidates, value, profile, name && infos[name]);
      if (equivalent) {
        notes.push(`Used ${short(equivalent.name)} for ${value}, its ${label} equivalent.`);
        entry = equivalent;
      } else if (name) {
        notes.push(
          `Left out ${value}: it is for ${infos[name]?.base || "another model family"} and ${label} has no equivalent.`,
        );
        continue;
      }
    }
    if (!entry) {
      const near = closest(candidates, value, (item) => [stem(item.name), item.info?.title]).map(
        (item) => short(item.name),
      );
      throw new Error(
        `No LoRA named ${value} for ${label}.${near.length ? ` Closest: ${near.join(", ")}.` : ""} Call models with lora_query to look one up.`,
      );
    }
    if (stack.some((item) => item.name === entry.name)) continue;
    stack.push({
      name: entry.name,
      strength: Number.isFinite(strength) ? strength : loraDefaultStrength(entry.info, 0.7),
      // The caller's own strength, which a batch never varies (varyLoras).
      ...(Number.isFinite(strength) ? { fixed: true } : {}),
      // A reused run keeps its Trigger Words choice; MCP callers never set it themselves.
      ...keptTriggers(triggers),
    });
  }
  return stack;
}

/**
 * A batch's LoRA stack for its prompt at `position`. A LoRA whose strength was left to Studio steps
 * through its centre (the strength `liked` gives it, else its default), then lower and higher within
 * its range, and every fourth prompt leaves the last of two or more such LoRAs out.
 */
export function varyLoras(stack, infos = {}, position = 0, liked = {}) {
  const free = stack.filter((lora) => !lora.fixed);
  const dropped = free.length > 1 && position % 4 === 3 ? free.at(-1).name : null;
  return stack
    .filter((lora) => lora.name !== dropped)
    .map(({ fixed, ...lora }) => {
      if (fixed) return lora;
      const range = strengthRange(infos[lora.name]) || {
        min: Math.max(0, lora.strength - 0.3),
        max: lora.strength + 0.3,
      };
      const centre = Math.min(range.max, Math.max(range.min, liked[lora.name] ?? lora.strength));
      const target = [centre, (range.min + centre) / 2, (centre + range.max) / 2][position % 3];
      return { ...lora, strength: Math.round(target * 20) / 20 };
    });
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
/**
 * The width and height for an aspect ("landscape", "portrait", "square" or a ratio such as 16:9):
 * the profile's own preset for the aspect, which the run's resolution then scales. Without an
 * aspect, the profile's default preset where it has one (as the composer starts), else null so the
 * saved size applies.
 */
export function mcpSize(profile, { aspect = profile.aspectDefault } = {}) {
  if (!aspect) return null;
  const defaults = profile.defaults || {};
  const presets = (profile.aspectPresets || []).filter((item) => item.w > 0 && item.h > 0);
  let width = Number(defaults.width) || 1024;
  let height = Number(defaults.height) || width;
  const key = String(aspect).trim().toLowerCase().slice(0, 20);
  const named = presets.find((item) => item.label.toLowerCase() === key);
  if (named) return { width: named.w, height: named.h };
  const orientation = orientations[key];
  const ratio = /^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/.exec(key);
  if (!orientation && !(ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0))
    throw new Error(
      `Choose aspect from ${[...presets.map((item) => item.label), "landscape", "portrait", "square"].join(", ")}.`,
    );
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
  return { width, height };
}

/**
 * A size past the profile's width or height limit shrunk to fit on its step grid, keeping its
 * shape, as Radiance does itself; null when it fits.
 */
export function fitSize(profile, width, height) {
  const { width: across = {}, height: down = {} } = profile.constraints || {};
  const scale = Math.min(1, (across.max || Infinity) / width, (down.max || Infinity) / height);
  if (!(scale < 1)) return null;
  const snap = (side, { min, step = 16 }) =>
    Math.max(min || step, Math.floor((side * scale) / step) * step);
  return { width: snap(width, across), height: snap(height, down) };
}
