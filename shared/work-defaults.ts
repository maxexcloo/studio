import { dreamVideoSeconds } from "./dream.ts";

const sides = ["local", "cloud"] as const;
/**
 * The deployment's starting video length and Dream's sides from Settings › Where Work Runs.
 * Unset, a model's own length applies and Dream runs locally.
 */
export const workSettings = {
  videoSeconds: { key: "STUDIO_VIDEO_SECONDS", choices: dreamVideoSeconds.filter(Boolean) },
  dreamImageBackend: { key: "STUDIO_DREAM_IMAGE_BACKEND", choices: sides },
  dreamVideoBackend: { key: "STUDIO_DREAM_VIDEO_BACKEND", choices: sides },
} as const;
