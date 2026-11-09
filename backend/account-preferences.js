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
 * `videos` is where Animate prefers to run (Cloud, or the local Fast or Quality tier); unsaved, it
 * is Fast where the account has local video, otherwise Cloud (animate-profile.js).
 */
export const preferenceDefaults = Object.freeze({
  cloudModels: true,
  loras: true,
  spicyPrompts: false,
  tileCaptions: false,
  uncensoredModels: true,
});
/** Preferences that take one of a few values rather than on or off; they have no default. */
const preferenceChoices = Object.freeze({ videos: ["cloud", "fast", "quality"] });
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
    cache.set(ownerId, value);
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
    if (!Object.hasOwn(preferenceDefaults, key)) throw new Error(`Unknown preference ${key}.`);
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
