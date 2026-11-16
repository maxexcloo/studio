/** Each account's Dream settings until it saves its own choice. */
export const dreamDefaults = {
  enabled: false,
  paused: false,
  dailyImages: 40,
  dailyVideos: 4,
  images: true,
  videos: false,
  spicy: false,
  imageBackend: "local" as "local" | "cloud",
  videoBackend: "local" as "local" | "cloud",
};
export type DreamSettings = typeof dreamDefaults;
/**
 * The settings an administrator may force on every account (Settings › Dream), overriding each
 * account's own choice; unset leaves the account's choice.
 */
export const dreamOverrideKeys = {
  enabled: "STUDIO_DREAM_OVERRIDE_ENABLED",
  paused: "STUDIO_DREAM_OVERRIDE_PAUSED",
  spicy: "STUDIO_DREAM_OVERRIDE_SPICY",
  imageBackend: "STUDIO_DREAM_OVERRIDE_IMAGE_BACKEND",
  videoBackend: "STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND",
};
export type DreamOverride = keyof typeof dreamOverrideKeys;
export function dreamSettingError(key: keyof DreamSettings, value: unknown): string {
  if (key === "imageBackend" || key === "videoBackend")
    return value === "local" || value === "cloud" ? "" : `Choose Local or Cloud for ${key}.`;
  if (key === "dailyImages" || key === "dailyVideos") {
    const max = key === "dailyImages" ? 500 : 100;
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max
      ? ""
      : `Set ${key} to a whole number from 0 to ${max}.`;
  }
  return typeof value === "boolean" ? "" : `Set ${key} to true or false.`;
}
