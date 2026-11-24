import { dreamVideoSeconds } from "./dream.ts";
import {
  grokVideoAspects,
  imageAspects,
  maxImageCount,
  resolutions,
  videoResolutions,
} from "./resolution.ts";

const sides = ["local", "cloud"] as const;
/**
 * Settings › Where Work Runs, beyond each kind's default model: the sizes, count and length new
 * drafts and chat runs start at, and where Dream's images and videos run, each a deployment
 * setting (backend/work-defaults.js). Unset, a model's own defaults apply and Dream runs locally.
 */
export const workSettings = {
  imageAspect: { key: "STUDIO_IMAGE_ASPECT", choices: imageAspects },
  imageCount: { key: "STUDIO_IMAGE_COUNT", range: [1, maxImageCount] },
  imageResolution: { key: "STUDIO_IMAGE_RESOLUTION", choices: resolutions },
  videoAspect: { key: "STUDIO_VIDEO_ASPECT", choices: grokVideoAspects },
  videoResolution: { key: "STUDIO_VIDEO_RESOLUTION", choices: videoResolutions },
  videoSeconds: { key: "STUDIO_VIDEO_SECONDS", choices: dreamVideoSeconds.filter(Boolean) },
  dreamImageBackend: { key: "STUDIO_DREAM_IMAGE_BACKEND", choices: sides },
  dreamVideoBackend: { key: "STUDIO_DREAM_VIDEO_BACKEND", choices: sides },
} as const satisfies Record<
  string,
  { key: string; choices?: readonly (string | number)[]; range?: readonly [number, number] }
>;
export type WorkSetting = keyof typeof workSettings;
