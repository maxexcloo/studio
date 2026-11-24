import { isCloudProfile } from "../shared/profiles.ts";
import { workSettings } from "../shared/work-defaults.ts";
import { mediaDefaultProfileKeys } from "./generation-defaults.js";

// Settings › Where Work Runs: how new work starts for everyone, saved as deployment settings
// (deployment-settings.js). Each kind's default model (`mediaDefaultProfileKeys` and the text
// profile) says where it runs; `workSettings` (shared/work-defaults.ts) holds the rest.

const numeric = (name) => name === "imageCount" || name === "videoSeconds";

/** Why `value` can't be saved for `name`; "" when it can. */
export function workSettingError(name, value) {
  const { choices, range } = workSettings[name];
  if (range)
    return Number.isInteger(value) && value >= range[0] && value <= range[1]
      ? ""
      : `Set ${name} to a whole number from ${range[0]} to ${range[1]}.`;
  return choices.includes(value) ? "" : `Set ${name} to ${choices.join(", ")}.`;
}

/** Each setting's value now, or null where unset (Dream's backends are Local until set). */
export function workDefaults() {
  const values = Object.fromEntries(
    Object.entries(workSettings).map(([name, { key }]) => {
      const raw = process.env[key];
      return [name, raw ? (numeric(name) ? Number(raw) : raw) : null];
    }),
  );
  return {
    ...values,
    dreamImageBackend: values.dreamImageBackend ?? "local",
    dreamVideoBackend: values.dreamVideoBackend ?? "local",
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
