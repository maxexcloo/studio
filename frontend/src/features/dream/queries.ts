import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import type { CardKind } from "../../../../shared/characters";
import type { DigestGroup, Project, Review } from "../../../../shared/projects";

/** One account's Dream settings (backend/domain/dream.ts). */
export interface DreamSettings {
  enabled: boolean;
  paused: boolean;
  dailyImages: number;
  dailyVideos: number;
  images: boolean;
  videos: boolean;
  spicy: boolean;
}
export type DreamStatus = "off" | "paused" | "waiting" | "generating" | "capped" | "unavailable";
export type DreamItem = MediaItem & {
  dream?: {
    prompt: string;
    why: string;
    at: string;
    state: "unseen" | "kept" | "discarded";
    decidedAt?: string;
    spicy?: true;
    /** One side of a comparison: alike but for what `question` asks about. */
    pair?: { id: string; side: 0 | 1; question: string; label: string };
    projectId?: string;
  };
  review?: Review;
};
/** A comparison's answer: side A or B, both or neither. */
export type PairAnswer = "a" | "b" | "both" | "neither";
export interface Dream {
  settings: DreamSettings;
  /** Finished results waiting for a verdict, oldest first. */
  unseen: DreamItem[];
  /** The unseen single results per project, ranked, for While You Were Away. */
  digest: DigestGroup<DreamItem>[];
  /** When the visit before this one ended; null on the first. */
  since: string | null;
  /** What Dream has made today, counted against the daily caps. */
  today: { images: number; videos: number };
  spicyAvailable: boolean;
  status: DreamStatus;
  /** Why Dream is waiting or can't run, where the backend says. */
  reason?: string;
}

export const dreamQuery = queryOptions({
  queryKey: ["dream"],
  queryFn: () => api<Dream>("/api/dream"),
  // Only a Dream that is on and not paused has anything new to show or a reason that may clear.
  refetchInterval: (query) =>
    query.state.data?.settings.enabled && !query.state.data.settings.paused ? 15_000 : false,
});
/** The header's count of results waiting for a verdict, a comparison counting once. */
export const dreamCountQuery = queryOptions({
  queryKey: ["dream", "count"],
  queryFn: () => api<{ unseen: number; active: boolean }>("/api/dream/count"),
  refetchInterval: (query) => (query.state.data?.active ? 15_000 : false),
});
export const discardedQuery = infiniteQueryOptions({
  queryKey: ["dream", "discarded"],
  queryFn: ({ pageParam }) =>
    api<{ items: DreamItem[]; nextCursor: string }>(
      `/api/dream/discarded?limit=40&cursor=${encodeURIComponent(pageParam)}`,
    ),
  initialPageParam: "",
  getNextPageParam: (page) => page.nextCursor || undefined,
});
/**
 * Older gallery images to calibrate the taste profile with, unjudged first. Each round is a new
 * random draw, kept apart from `["dream"]` so judging a card never reshuffles the deck.
 */
export const calibrationQuery = (round: number) =>
  queryOptions({
    queryKey: ["dream-calibration", round],
    queryFn: () => api<{ items: MediaItem[] }>("/api/dream/calibration?limit=12"),
    staleTime: Infinity,
    // A later visit draws afresh rather than replaying images already judged.
    gcTime: 0,
  });
export const dreamItemPath = (item: { id: string }, action: string) =>
  `/api/dream/${encodeURIComponent(item.id)}/${action}`;
export const pairAnswerPath = (pairId: string) =>
  `/api/dream/pairs/${encodeURIComponent(pairId)}/answer`;

/**
 * When Dream works, or why it doesn't, and how much of today's share it has made, such as "Dream
 * works when the queue is free · 12 of 40 today".
 */
export const dreamWhen = ({ settings, today, status }: Dream) =>
  [
    status === "off"
      ? "Dream is off"
      : status === "paused"
        ? "Dream is paused"
        : status === "capped"
          ? "Dream has made today's share"
          : "Dream works when the queue is free",
    ...(settings.images ? [`${today.images} of ${settings.dailyImages} today`] : []),
    ...(settings.videos ? [`${today.videos} of ${settings.dailyVideos} videos`] : []),
  ].join(" · ");

export const projectsQuery = queryOptions({
  queryKey: ["dream", "projects"],
  queryFn: () => api<{ projects: Project[] }>("/api/dream/projects"),
});
export const projectPath = (project: { id: string }, action = "") =>
  `/api/dream/projects/${encodeURIComponent(project.id)}${action && `/${action}`}`;

/**
 * A recurring character, outfit or scene Dream proposes from liked results (backend/domain/dream.ts),
 * with the results it recurs in.
 */
export interface CardSuggestion {
  id: string;
  kind: CardKind;
  name: string;
  description: string;
  items: MediaItem[];
}
export const suggestionsQuery = queryOptions({
  queryKey: ["dream", "suggestions"],
  queryFn: async () =>
    (await api<{ suggestions: CardSuggestion[] }>("/api/dream/suggestions")).suggestions,
});
export const suggestionPath = (suggestion: { id: string }, action: "accept" | "dismiss") =>
  `/api/dream/suggestions/${encodeURIComponent(suggestion.id)}/${action}`;
