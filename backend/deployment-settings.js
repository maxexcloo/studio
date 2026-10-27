import { envFileKeys, removeLocalEnvValue, writeLocalEnvValue } from "./env.js";

/**
 * Settings a deployment can own. A value from the real environment (compose,
 * Kubernetes, the shell) is the deployment's and locked here; one in Studio's own
 * .env was saved from Settings and stays editable; anything else is the default.
 * Settings show each value with its source, so nothing changes behind the
 * deployment's back and nothing saved here silently loses to it after a restart.
 */
export function settingSource(key) {
  const value = process.env[key];
  if (value === undefined || value === "") return { source: "default", locked: false };
  if (envFileKeys.has(key)) return { source: "studio", locked: false };
  return { source: "deployment", locked: true };
}

const flag = (key, label, description, { defaultOn = true, applies = "now" } = {}) => ({
  key,
  label,
  description,
  kind: "flag",
  defaultOn,
  applies,
});

/**
 * Catalogue switches: what the generation catalogue offers. Some are read once,
 * at start. STUDIO_ENABLE_TESSERA remains a
 * deployment variable (features.js) but is no longer switched in Settings.
 * LoRAs, Cloud Models and Presets & Civitai Imports are access-profile features;
 * STUDIO_ENABLE_LORAS, STUDIO_ENABLE_GROK and STUDIO_ENABLE_PRESETS stay
 * deployment variables that switch one off for everyone (features.js).
 */
export const catalogueFlags = [
  flag("STUDIO_ENABLE_INPAINT", "Inpainting", "Painting over part of a reference image.", {
    applies: "restart",
  }),
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

/** Writes one deployment setting to Studio's .env, unless the deployment owns it. */
export function saveDeploymentSetting(key, value) {
  if (settingSource(key).locked)
    throw new Error("This setting comes from the deployment configuration. Change it there.");
  if (value === "" || value === null || value === undefined) removeLocalEnvValue(key);
  else writeLocalEnvValue(key, String(value));
  return settingSource(key);
}

export function isCatalogueFlag(key) {
  return catalogueFlags.some((item) => item.key === key);
}
