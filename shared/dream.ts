/** Dream defaults are inherited until an account saves its own choice. */
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
export const dreamSettingKeys: Record<keyof DreamSettings, string> = {
  enabled: "STUDIO_DREAM_ENABLED",
  paused: "STUDIO_DREAM_PAUSED",
  dailyImages: "STUDIO_DREAM_DAILY_IMAGES",
  dailyVideos: "STUDIO_DREAM_DAILY_VIDEOS",
  images: "STUDIO_DREAM_IMAGES",
  videos: "STUDIO_DREAM_VIDEOS",
  spicy: "STUDIO_DREAM_SPICY",
  imageBackend: "STUDIO_DREAM_IMAGE_BACKEND",
  videoBackend: "STUDIO_DREAM_VIDEO_BACKEND",
};
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
