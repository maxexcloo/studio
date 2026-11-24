import { dreamVideoSeconds } from "./dream.ts";

const sides = ["local", "cloud"] as const;
/**
 * Settings › Where Work Runs, beyond each kind's default model: the Video Length new video drafts,
 * Dream and Animate start at, and where Dream's images and videos run, each a deployment setting
 * (backend/work-defaults.js). Unset, a model's own length applies and Dream runs locally.
 */
export const workSettings = {
  videoSeconds: { key: "STUDIO_VIDEO_SECONDS", choices: dreamVideoSeconds.filter(Boolean) },
  dreamImageBackend: { key: "STUDIO_DREAM_IMAGE_BACKEND", choices: sides },
  dreamVideoBackend: { key: "STUDIO_DREAM_VIDEO_BACKEND", choices: sides },
} as const;
export type WorkSetting = keyof typeof workSettings;
