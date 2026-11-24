/** Each account's Dream settings until it saves its own choice. */
export const dreamDefaults = {
  enabled: false,
  paused: false,
  dailyImages: 40,
  dailyVideos: 4,
  images: true,
  videos: false,
  uncensored: false,
  imageBackend: "local" as "local" | "cloud",
  videoBackend: "local" as "local" | "cloud",
};
export type DreamSettings = typeof dreamDefaults;
export const maxDreamIdleMinutes = 120;
export const dreamTimingSettings = {
  imageIdleMinutes: { key: "STUDIO_DREAM_IMAGE_IDLE_MINUTES", defaultValue: 0 },
  imageSwitchMinutes: { key: "STUDIO_DREAM_IMAGE_SWITCH_MINUTES", defaultValue: 2 },
  videoIdleMinutes: { key: "STUDIO_DREAM_VIDEO_IDLE_MINUTES", defaultValue: 5 },
};
export type DreamTiming = keyof typeof dreamTimingSettings;
export type DreamCounts = { images: number; videos: number };

export function dreamLimitReached(
  settings: DreamSettings,
  usage: DreamCounts,
  kind: "image" | "video",
) {
  const [enabled, limit, used] =
    kind === "image"
      ? [settings.images, settings.dailyImages, usage.images]
      : [settings.videos, settings.dailyVideos, usage.videos];
  return settings.enabled && enabled && limit > 0 && used >= limit;
}

export const dreamSeriesLength = 4;
export const dreamPassReasons = ["taste", "similar", "glitch", "skip"] as const;
export type DreamPassReason = (typeof dreamPassReasons)[number];
export const dreamPairAnswers = ["a", "b", "c", "both", "neither"] as const;
export type PairAnswer = (typeof dreamPairAnswers)[number];

export type DreamResultSet = { id: string; source?: string; title: string; index: number };

type DreamResult = {
  id?: string;
  type?: string;
  dream?: { pair?: { id: string } };
  resultSet?: DreamResultSet;
};

export const dreamSet = (item: DreamResult) =>
  item.dream && !item.dream.pair && item.resultSet?.source === "dream" ? item.resultSet : undefined;

/** Each comparison and set counts once in its media kind. */
export function dreamCardCounts(
  items: readonly DreamResult[],
  { enabled, paused }: Pick<DreamSettings, "enabled" | "paused">,
) {
  const count = (type: "image" | "video") =>
    enabled
      ? new Set(
          items.flatMap((item) => {
            if (item.type !== type) return [];
            const set = dreamSet(item);
            return [set ? `set:${set.id}` : (item.dream?.pair?.id ?? item.id)];
          }),
        ).size
      : 0;
  const images = count("image");
  const videos = count("video");
  return { unseen: images + videos, images, videos, active: enabled && !paused };
}

/**
 * The settings an administrator may force on every account (Administration › Dream), overriding each
 * account's own choice; unset leaves the account's choice.
 */
export const dreamOverrideKeys = {
  enabled: "STUDIO_DREAM_OVERRIDE_ENABLED",
  uncensored: "STUDIO_DREAM_OVERRIDE_UNCENSORED",
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

/** A model, LoRA or theme (caption tag) in the weekly digest, with its kept and passed results. */
export interface DreamDigestRow {
  name: string;
  kept: number;
  passed: number;
}
/** Dream › This Week: the account's last seven days of Dream verdicts, read from its records. */
export interface DreamDigest<Item> {
  kept: number;
  passed: number;
  /** The best kept results: Super Liked, then liked, then the best reviewed and newest. */
  top: Item[];
  /** The best keep rates, from at least two verdicts each. */
  best: Record<"models" | "loras" | "themes", DreamDigestRow[]>;
  /** The themes passed most, and why results were passed, a pass without a reason as "skip". */
  passedThemes: DreamDigestRow[];
  reasons: { reason: DreamPassReason; count: number }[];
  /** What Dream leans on next: its taste's favourites, its active projects, and how often it explores. */
  next: {
    models: string[];
    loras: string[];
    themes: string[];
    projects: string[];
    explore: number;
  };
}
