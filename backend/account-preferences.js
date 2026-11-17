import { appearanceChoices } from "../shared/appearance.ts";
import { cleanBrief } from "../shared/chat-brief.ts";
import { dataDir } from "./data-dir.js";
import { minorAgeRefusal } from "./minor-age.js";
import {
  deleteRuntimeDocument,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

/**
 * Each account's own preferences, the `preferences:<account id>` document in studio.sqlite
 * (`preferences:` in single-user mode). Cloud Models, LoRAs and Uncensored Models only narrow
 * what the account's group grants (account-policy.js); they start on wherever the group grants
 * them. Uncensored Models also lets prompt writing word what it offers explicitly.
 * `images`, `videos` and `text` say where each kind runs by default, Cloud or Local (`sideOf`), and
 * `<kind>Cloud` and `<kind>Local` its default model on each side: an image or video profile ID, or
 * a gateway text model. Unsaved, a default is the deployment's (model/catalogue.js,
 * animate-profile.js, assistant.js). A side that can't run gives way to the other, saying so; a
 * model the person picks always wins. `galleryWork` is which unfinished work the gallery shows:
 * none (unsaved), work in progress, or queued work too (gallery/routes.js). `appearance` holds the header's Appearance
 * settings (shared/appearance.ts), and `chatBrief` the standing brief chats write to
 * (shared/chat-brief.ts). Keys Studio no longer knows are dropped as the document is read.
 */
const preferenceDefaults = Object.freeze({
  cloudModels: true,
  loras: true,
  tileCaptions: false,
  uncensoredModels: true,
});
/** Preferences that take one of a few values rather than on or off; they have no default. */
const preferenceChoices = Object.freeze({
  galleryWork: ["none", "running", "queued"],
  images: ["cloud", "local"],
  text: ["cloud", "local"],
  videos: ["cloud", "local"],
});
/** Each kind's default model per side, by the kind's preference key. */
export const defaultModelKeys = Object.freeze({
  images: { cloud: "imageCloud", local: "imageLocal" },
  text: { cloud: "textCloud", local: "textLocal" },
  videos: { cloud: "videoCloud", local: "videoLocal" },
});
const modelKeys = new Set(Object.values(defaultModelKeys).flatMap((sides) => Object.values(sides)));
const known = (key) =>
  Object.hasOwn(preferenceDefaults, key) ||
  Object.hasOwn(preferenceChoices, key) ||
  modelKeys.has(key) ||
  key === "appearance" ||
  key === "chatBrief";
const cache = new Map();
const documentName = (ownerId) => `preferences:${ownerId}`;

/** The values the account has saved, without defaults. */
function saved(ownerId = "") {
  if (!cache.has(ownerId)) {
    const value = readRuntimeDocument(dataDir, documentName(ownerId)) ?? {};
    cache.set(ownerId, Object.fromEntries(Object.entries(value).filter(([key]) => known(key))));
  }
  return cache.get(ownerId);
}

export function accountPreferences(ownerId = "") {
  const preferences = { ...preferenceDefaults, ...saved(ownerId) };
  if (!preferences.cloudModels)
    for (const key of ["images", "text", "videos"])
      if (preferences[key] === "cloud") delete preferences[key];
  return preferences;
}

/**
 * Where a kind (`images`, `videos` or `text`) runs by default: the saved side, else Local, except
 * Text, which runs on Cloud unless Cloud Models is off.
 */
export function sideOf(preferences, kind) {
  return preferences[kind] || (kind === "text" && preferences.cloudModels ? "cloud" : "local");
}

/** A kind's chosen side and the default model saved for each side, if any. */
export function kindDefaults(preferences, kind) {
  const keys = defaultModelKeys[kind];
  return {
    side: sideOf(preferences, kind),
    cloud: preferences[keys.cloud],
    local: preferences[keys.local],
  };
}

/** Which preferences the account has saved, so a value carried over from a device never replaces one. */
export const savedPreferenceKeys = (ownerId = "") => Object.keys(saved(ownerId));

export function saveAccountPreferences(ownerId, patch) {
  const entries = Object.entries(patch || {});
  if (!entries.length) throw new Error("Choose a preference to change.");
  for (const [key, value] of entries) {
    const choices = preferenceChoices[key];
    if (choices) {
      if (!choices.includes(value)) throw new Error(`Set ${key} to ${choices.join(", ")}.`);
      continue;
    }
    if (key === "appearance") {
      const settings = Object.entries(value && typeof value === "object" ? value : { value });
      for (const [setting, choice] of settings)
        if (
          !Object.hasOwn(appearanceChoices, setting) ||
          !appearanceChoices[setting].includes(choice)
        )
          throw new Error(`Set appearance ${setting} to one of its choices.`);
      continue;
    }
    if (key === "chatBrief") {
      const brief = cleanBrief(value);
      const refusal = minorAgeRefusal(Object.values(brief).flat().join("\n"));
      if (refusal) throw new Error(refusal);
      patch = { ...patch, chatBrief: brief };
      continue;
    }
    if (modelKeys.has(key)) {
      if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 200))
        throw new Error(`Choose a model for ${key}.`);
      continue;
    }
    if (!known(key)) throw new Error(`Unknown preference ${key}.`);
    if (typeof value !== "boolean") throw new Error(`Set ${key} to true or false.`);
  }
  // A default model set to null goes back to the deployment's.
  const next = Object.fromEntries(
    Object.entries({ ...saved(ownerId), ...patch }).filter(([, value]) => value !== null),
  );
  writeRuntimeDocument(dataDir, documentName(ownerId), next);
  cache.set(ownerId, next);
  return accountPreferences(ownerId);
}

/** Reads every account's preferences afresh, after a migration rewrote them. */
export const reloadAccountPreferences = () => cache.clear();

/** A deleted account's preferences go with it. */
export function forgetAccountPreferences(ownerId) {
  deleteRuntimeDocument(dataDir, documentName(ownerId));
  cache.delete(ownerId);
}
