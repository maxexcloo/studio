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

const flag = (key, label, description, { defaultOn = true } = {}) => ({
  key,
  label,
  description,
  kind: "flag",
  defaultOn,
});

/**
 * Catalogue switches: what the generation catalogue offers. LoRAs, Cloud Models
 * and Presets & Civitai Imports are access-profile features; STUDIO_ENABLE_PRESETS
 * stays a deployment variable that switches presets off for everyone (features.js).
 */
export const catalogueFlags = [
  flag(
    "STUDIO_VIDEO_CLOUD_FALLBACK",
    "Video Cloud Fallback",
    "While the local video worker is off, MCP video runs on a granted cloud profile instead of being refused.",
    { defaultOn: false },
  ),
  flag(
    "STUDIO_GALLERY_CAPTIONS",
    "Gallery Captions",
    "While Studio is idle, the assistant model describes finished images so gallery search finds what they show. Needs a model that reads images.",
  ),
  flag(
    "STUDIO_IMAGE_SEARCH",
    "Image Search",
    "Gallery search also finds images that look like the words, read by SigLIP 2 on Studio's CPU while it is idle. Downloads the model (about 690 MB) into the data folder.",
  ),
];

const flagOn = (item) =>
  item.defaultOn ? process.env[item.key] !== "0" : process.env[item.key] === "1";

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
