import { appearanceChoices } from "../shared/appearance.ts";
import { gallerySortLabels } from "../shared/gallery-sort.ts";
import { maxTasteGuidance, tasteAreas } from "../shared/taste.ts";
import { dataDir } from "./data-dir.js";
import {
  deleteRuntimeDocument,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

/**
 * Each account's own preferences, the `preferences:<account id>` document in studio.sqlite
 * (`preferences:` in single-user mode). LoRAs and Uncensored Models only narrow what the
 * account's group grants (account-policy.js); they start on wherever the group grants them. Uncensored Models also lets prompt writing word what it offers explicitly.
 * Where work runs and how new work starts are Studio's, not an account's (work-defaults.js).
 * `galleryWork` is which unfinished
 * work the gallery shows: none (unsaved), work in progress, or queued work too (gallery/routes.js). `appearance` holds the header's Appearance
 * settings (shared/appearance.ts). `galleryViews` are the gallery's saved views, each a name with
 * the search, filters and sort it restores (frontend gallery/savedViews.ts). `tasteAreas` says, per
 * area of Settings › Taste › Where Taste Applies, whether it uses the account's taste and the
 * guidance sent with its work (shared/taste.ts). Keys Studio no longer knows are dropped as the document is read.
 */
const preferenceDefaults = Object.freeze({
  loras: true,
  tileCaptions: false,
  uncensoredModels: true,
});
/** Preferences that take one of a few values rather than on or off; they have no default. */
const preferenceChoices = Object.freeze({
  galleryWork: ["none", "running", "queued"],
});
const known = (key) =>
  Object.hasOwn(preferenceDefaults, key) ||
  Object.hasOwn(preferenceChoices, key) ||
  key === "appearance" ||
  key === "galleryViews" ||
  key === "tasteAreas";
const cache = new Map();
const documentName = (ownerId) => `preferences:${ownerId}`;

const maxGalleryViews = 30;
const text = (value, max) => typeof value === "string" && value.length <= max;
/** A saved view's filters: lists of values, a choice or an on/off filter, as the gallery sends them. */
const viewFilter = (value) =>
  typeof value === "boolean" ||
  text(value, 40) ||
  (Array.isArray(value) && value.length <= 50 && value.every((item) => text(item, 200)));
const galleryView = (view) =>
  Boolean(view) &&
  text(view.id, 64) &&
  view.id !== "" &&
  text(view.name, 80) &&
  view.name.trim() !== "" &&
  text(view.search, 200) &&
  Object.hasOwn(gallerySortLabels, view.sort) &&
  Boolean(view.filters) &&
  typeof view.filters === "object" &&
  Object.values(view.filters).every(viewFilter);

/** The values the account has saved, without defaults. */
function saved(ownerId = "") {
  if (!cache.has(ownerId)) {
    const value = readRuntimeDocument(dataDir, documentName(ownerId)) ?? {};
    cache.set(ownerId, Object.fromEntries(Object.entries(value).filter(([key]) => known(key))));
  }
  return cache.get(ownerId);
}

export function accountPreferences(ownerId = "") {
  return { ...preferenceDefaults, ...saved(ownerId) };
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
    if (key === "galleryViews") {
      if (
        !Array.isArray(value) ||
        value.length > maxGalleryViews ||
        !value.every(galleryView) ||
        new Set(value.map((view) => view.id)).size !== value.length
      )
        throw new Error(`Save up to ${maxGalleryViews} named gallery views.`);
      continue;
    }
    if (key === "tasteAreas") {
      const areas = Object.entries(value && typeof value === "object" ? value : { value });
      if (
        !areas.every(
          ([area, setting]) =>
            tasteAreas.includes(area) &&
            setting &&
            typeof setting === "object" &&
            Object.entries(setting).every(([field, choice]) =>
              field === "taste"
                ? typeof choice === "boolean"
                : field === "guidance" &&
                  typeof choice === "string" &&
                  choice.length <= maxTasteGuidance,
            ),
        )
      )
        throw new Error(
          `Set tasteAreas to each area's taste switch and guidance of up to ${maxTasteGuidance} characters.`,
        );
      continue;
    }
    if (!known(key)) throw new Error(`Unknown preference ${key}.`);
    if (typeof value !== "boolean") throw new Error(`Set ${key} to true or false.`);
  }
  // Setting a preference to null restores its default.
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
