import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem } from "../../types";

/** One account's Dream settings (backend/domain/dream.ts). */
export interface DreamSettings {
  enabled: boolean;
  paused: boolean;
  buffer: number;
  dailyImages: number;
  dailyVideos: number;
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
  };
};
export interface Dream {
  settings: DreamSettings;
  /** Finished results waiting for a verdict, oldest first. */
  unseen: DreamItem[];
  today: { images: number; videos: number };
  spicyAvailable: boolean;
  status: DreamStatus;
  reason?: string;
}

export const dreamQuery = queryOptions({
  queryKey: ["dream"],
  queryFn: () => api<Dream>("/api/dream"),
  // Only a Dream that is about to make something has anything new to show.
  refetchInterval: (query) =>
    ["waiting", "generating"].includes(query.state.data?.status || "") ? 15_000 : false,
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
