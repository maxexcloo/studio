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
 * `images` says where images run by default, Cloud or Local, and `videos` where videos and Animate
 * do (Cloud, or the local Fast or Quality tier); unsaved, each is local, and a saved Cloud reads as
 * unsaved while Cloud Models is off. The side that can't run
 * gives way to the other, saying so; a model the person picks always wins (model/catalogue.js,
 * animate-profile.js). `writingModel` is the text model prompt writing asks for (assistant.js
 * `writerModel`). `galleryWork` is which unfinished work the gallery shows: none (unsaved), work
 * in progress, or queued work too (gallery/routes.js). `appearance` holds the header's Appearance
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
  videos: ["cloud", "fast", "quality"],
});
const known = (key) =>
  Object.hasOwn(preferenceDefaults, key) ||
  Object.hasOwn(preferenceChoices, key) ||
  key === "writingModel" ||
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
    for (const key of ["images", "videos"])
      if (preferences[key] === "cloud") delete preferences[key];
  return preferences;
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
    if (key === "writingModel") {
      if (typeof value !== "string" || !value.trim() || value.length > 200)
        throw new Error("Choose a text model.");
      continue;
    }
    if (!known(key)) throw new Error(`Unknown preference ${key}.`);
    if (typeof value !== "boolean") throw new Error(`Set ${key} to true or false.`);
  }
  const next = { ...saved(ownerId), ...patch };
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
