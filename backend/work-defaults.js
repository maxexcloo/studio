import { isCloudProfile } from "../shared/profiles.ts";
import { workSettings } from "../shared/work-defaults.ts";
import { mediaDefaultProfileKeys } from "./generation-defaults.js";

// Settings › Where Work Runs: how new work starts for everyone, saved as deployment settings
// (deployment-settings.js). Each kind's default model (`mediaDefaultProfileKeys` and the text
// profile) says where it runs; `workSettings` (shared/work-defaults.ts) holds the rest.

/** Why `value` can't be saved for `name`; "" when it can. */
export function workSettingError(name, value) {
  const { choices } = workSettings[name];
  return choices.includes(value) ? "" : `Set ${name} to ${choices.join(", ")}.`;
}

/** Each setting's value now: Video Length null for Auto, Dream's backends Local until set. */
export function workDefaults() {
  const { videoSeconds, dreamImageBackend, dreamVideoBackend } = workSettings;
  return {
    videoSeconds: Number(process.env[videoSeconds.key]) || null,
    dreamImageBackend: process.env[dreamImageBackend.key] || "local",
    dreamVideoBackend: process.env[dreamVideoBackend.key] || "local",
  };
}

/** The Dream settings Where Work Runs decides for every account. */
export function dreamWorkSettings() {
  const work = workDefaults();
  return {
    imageBackend: work.dreamImageBackend,
    videoBackend: work.dreamVideoBackend,
    videoSeconds: work.videoSeconds ?? 0,
  };
}

/** Each kind's default model by the side it runs on, for Dream and Animate. */
export function defaultSides(profiles = []) {
  const side = (kind) => {
    const id = process.env[mediaDefaultProfileKeys[kind]];
    if (!id) return {};
    const profile = profiles.find((entry) => entry.id === id) ?? { id };
    return { [isCloudProfile(profile) ? "cloud" : "local"]: id };
  };
  return { image: side("image"), video: side("video") };
}
