/** Each account's Dream settings until it saves its own choice. */
export const dreamDefaults = {
  enabled: true,
  paused: true,
  dailyImages: 100,
  dailyVideos: 50,
  images: true,
  videos: true,
  /** Seconds per video clip, or 0 for Auto (5 to 8). */
  videoSeconds: 0,
  uncensored: false,
  useLoadedProfile: true,
  imageBackend: "local" as "local" | "cloud",
  videoBackend: "local" as "local" | "cloud",
  /** The image deck's mix: relative shares of new ideas, comparisons and existing work. */
  mixNew: 40,
  mixComparisons: 30,
  mixExisting: 30,
  /** Percent of ideas written uncensored, where `uncensored` and Uncensored Models allow. */
  uncensoredShare: 40,
};
export type DreamSettings = typeof dreamDefaults;
/** The largest value of each numeric Dream setting, all from 0. */
export const dreamSettingMaxima = {
  dailyImages: 500,
  dailyVideos: 100,
  mixNew: 100,
  mixComparisons: 100,
  mixExisting: 100,
  uncensoredShare: 100,
};
/** The clip lengths Dream offers; 0 is Auto. Each model clamps to its own frame limits. */
export const dreamVideoSeconds = [0, 5, 8, 10] as const;
export const maxDreamIdleMinutes = 120;
export const dreamTimingSettings = {
  imageIdleMinutes: { key: "STUDIO_DREAM_IMAGE_IDLE_MINUTES", defaultValue: 0 },
  imageSwitchMinutes: { key: "STUDIO_DREAM_IMAGE_SWITCH_MINUTES", defaultValue: 5 },
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

/** How many of the latest judged Dream images a profile, LoRA or caption tag was in, and kept. */
export type KeepCount = { kept: number; total: number };
/** `GET /api/dream/keep-rates`: the account's keeps by profile id, LoRA file and caption tag. */
export type KeepRates = {
  profiles: Record<string, KeepCount>;
  loras: Record<string, KeepCount>;
  tags: Record<string, KeepCount>;
};
/** A keep rate shows once this many judged images back it. */
export const keepRateMinimum = 10;
/** "Kept 63%", or nothing below `keepRateMinimum` judged images. */
export const keptLabel = (count?: KeepCount) =>
  count && count.total >= keepRateMinimum
    ? `Kept ${Math.round((count.kept / count.total) * 100)}%`
    : undefined;

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
  if (key === "videoSeconds")
    return (dreamVideoSeconds as readonly unknown[]).includes(value)
      ? ""
      : "Choose Auto, 5, 8 or 10 seconds for videoSeconds.";
  if (key in dreamSettingMaxima) {
    const max = dreamSettingMaxima[key as keyof typeof dreamSettingMaxima];
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

/** Context a chat gave Studio (MCP), which Dream may draw on as a soft hint. */
export interface ChatNote {
  id: string;
  text: string;
  at: string;
  /** The project the chat was attached to. */
  project?: string;
  /** The jobs of the results it came with. */
  results?: string[];
  /** The character card it came with. */
  card?: string;
}

/** A liked result whose prompt a Dream idea saw, which its Details link to. */
export interface DreamLikedPrompt {
  id: string;
  number?: number;
  type: string;
  title: string;
}
/** What fed a Dream result, kept on it as it was made and listed in its Details. */
export interface DreamInputs {
  /** The taste's likes and styles drawn for the idea, and the caption tag it featured. */
  likes?: string[];
  styles?: string[];
  feature?: string;
  /** Liked results whose prompts the writer saw. */
  prompts?: DreamLikedPrompt[];
  /** The project whose brief it followed. */
  project?: string;
  /** Chat notes, Dream's guidance and My Preferences it was given. */
  notes?: string[];
  guidance?: string;
  preferences?: string;
  /** The rules older results were given, before My Preferences replaced them. */
  rules?: string[];
  /** Why it runs on its model and LoRAs. */
  choice?: string;
  /** How its seed relates to other results, such as a comparison's shared seed. */
  seed?: string;
}
