import fs from "node:fs";
import { currentDataDir } from "./data-dir.js";
import { databaseFile, readRuntimeDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * Settings a deployment can own. A value from the environment (compose,
 * Kubernetes, the shell) is the deployment's and locked here; one saved from
 * Settings lives in SQLite and stays editable; anything else is the default.
 * Settings show each value with its source, so nothing changes behind the
 * deployment's back and nothing saved here silently loses to it after a restart.
 */
const dataDir = currentDataDir();
const documentName = "settings";

function readSaved() {
  // Reading alone never creates a database (tests import this without a data folder).
  if (!fs.existsSync(databaseFile(dataDir))) return {};
  try {
    return readRuntimeDocument(dataDir, documentName);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

const saved = readSaved();
// Saved values fill in what the environment leaves unset; the environment always wins.
const applied = new Set();
for (const [key, value] of Object.entries(saved)) {
  if (process.env[key]) continue;
  process.env[key] = value;
  applied.add(key);
}

export function settingSource(key) {
  const value = process.env[key];
  if (value === undefined || value === "") return { source: "default", locked: false };
  if (applied.has(key)) return { source: "studio", locked: false };
  return { source: "deployment", locked: true };
}

// A switch is 0 or 1, or unset for its default (on unless `defaultOn` is false).
const flag = (key, label, description, defaultOn = true) => ({
  key,
  label,
  description,
  kind: "flag",
  defaultOn,
});

/**
 * Settings › Generation switches. Background AI (A–Z) covers every model call Studio makes on its
 * own; what a person asks for (Improve, Ask for a Change, Animate, Chat replies) is never switched
 * off here. Run While Busy sits with the gallery passes.
 */
export const catalogueFlags = [
  flag(
    "STUDIO_CHAT_TITLES",
    "Chat Titles",
    "The assistant model names each new chat from its first request; without it a chat stays New Chat until renamed.",
  ),
  flag(
    "STUDIO_GALLERY_CAPTIONS",
    "Gallery Captions",
    "While Studio is idle, the assistant model describes finished images so gallery search finds what they show. Needs a model that reads images.",
  ),
  flag(
    "STUDIO_GALLERY_TITLES",
    "Gallery Titles",
    "The assistant model titles finished images and videos from their prompts, as they finish and while Studio is idle.",
  ),
  flag(
    "STUDIO_IMAGE_SEARCH",
    "Image Search",
    "Gallery search also finds images that look like the words, read by SigLIP 2 on Studio's CPU while it is idle. Downloads the model (about 690 MB) into the data folder.",
  ),
  flag(
    "STUDIO_NEXT_STEPS",
    "Next Steps",
    "The assistant model writes the Suggestions menu's changes for finished images (ahead of time while Studio is idle, and as one opens) and for the composer's draft.",
  ),
  flag(
    "STUDIO_PROMPT_IDEAS",
    "Prompt Ideas",
    "The assistant model offers prompt ideas from each account's taste when an empty prompt is focused.",
  ),
  flag(
    "STUDIO_SUGGESTED_PROMPTS",
    "Suggested Prompts",
    "While Studio is idle, the assistant model writes a prompt for uploads and other items without one, which Recreate uses.",
  ),
  flag(
    "STUDIO_TASTE_UPDATES",
    "Taste Updates",
    "The assistant model rewrites an account's taste profile after a few stars, compare votes and iterations; its Refresh on the Dream page still works.",
  ),
  flag(
    "STUDIO_GALLERY_WHILE_BUSY",
    "Run While Busy",
    "Caption, index and title the gallery even while Studio is generating or chatting, instead of waiting until it is idle.",
    false,
  ),
];

const flagOn = (item) => (process.env[item.key] ? process.env[item.key] !== "0" : item.defaultOn);

/** Saves a catalogue switch: its default is no saved value, so a later default change still applies. */
export function saveFlag(key, on) {
  const item = catalogueFlags.find((entry) => entry.key === key);
  return saveDeploymentSetting(key, on === item.defaultOn ? "" : on ? "1" : "0");
}

/** Whether a catalogue switch is on now (Settings saves apply at once). */
export function flagEnabled(key) {
  return flagOn(catalogueFlags.find((item) => item.key === key));
}

export function describeFlag(item) {
  return { ...item, value: flagOn(item), ...settingSource(item.key) };
}

/** Saves one deployment setting in SQLite, unless the deployment owns it; empty clears it. */
export function saveDeploymentSetting(key, value) {
  if (settingSource(key).locked)
    throw new Error("This setting comes from the deployment configuration. Change it there.");
  if (value === "" || value === null || value === undefined) {
    delete saved[key];
    delete process.env[key];
    applied.delete(key);
  } else {
    saved[key] = String(value);
    process.env[key] = saved[key];
    applied.add(key);
  }
  writeRuntimeDocument(dataDir, documentName, saved);
  return settingSource(key);
}

export function isCatalogueFlag(key) {
  return catalogueFlags.some((item) => item.key === key);
}
