import { currentDataDir } from "./data-dir.js";
import {
  deleteRuntimeDocument,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

/**
 * Each account's own preferences, the `preferences:<account id>` document in studio.sqlite
 * (`preferences:` in single-user mode). Cloud Models, LoRAs and Uncensored Models only narrow
 * what the account's group grants (account-policy.js); they start on wherever the group grants
 * them. Spicy Prompts starts off and counts only with Uncensored Models (`explicitWording`).
 * `images` says where images run by default, Cloud or Local, and `videos` where videos and Animate
 * do (Cloud, or the local Fast or Quality tier); unsaved, each is local. The side that can't run
 * gives way to the other, saying so; a model the person picks always wins (model/catalogue.js,
 * animate-profile.js). `writingModel` is the text model prompt writing asks for (assistant.js
 * `writerModel`). `galleryWork` is which unfinished work the gallery shows: none (unsaved), work
 * in progress, or queued work too (gallery/routes.js). Keys Studio no longer knows are dropped as
 * the document is read.
 */
export const preferenceDefaults = Object.freeze({
  cloudModels: true,
  loras: true,
  spicyPrompts: false,
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
  key === "writingModel";
const dataDir = currentDataDir();
const cache = new Map();
const documentName = (ownerId) => `preferences:${ownerId}`;

/** The values the account has saved, without defaults. */
function saved(ownerId = "") {
  if (!cache.has(ownerId)) {
    let value = {};
    try {
      value = readRuntimeDocument(dataDir, documentName(ownerId));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    cache.set(ownerId, Object.fromEntries(Object.entries(value).filter(([key]) => known(key))));
  }
  return cache.get(ownerId);
}

export const accountPreferences = (ownerId = "") => ({ ...preferenceDefaults, ...saved(ownerId) });

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
    if (key === "writingModel") {
      if (typeof value !== "string" || !value.trim() || value.length > 200)
        throw new Error("Choose a text model.");
      continue;
    }
    if (!known(key)) throw new Error(`Unknown preference ${key}.`);
    if (typeof value !== "boolean") throw new Error(`Set ${key} to true or false.`);
  }
  const next = { ...saved(ownerId), ...Object.fromEntries(entries) };
  writeRuntimeDocument(dataDir, documentName(ownerId), next);
  cache.set(ownerId, next);
  return accountPreferences(ownerId);
}

/** A deleted account's preferences go with it. */
export function forgetAccountPreferences(ownerId) {
  deleteRuntimeDocument(dataDir, documentName(ownerId));
  cache.delete(ownerId);
}
