import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { DreamCounts, DreamDigest, DreamSettings, KeepRates } from "../../../../shared/dream";
import type { Inbox } from "../../../../shared/inbox";
import type { Project, ProjectStats } from "../../../../shared/projects";
import type { DreamActivity } from "../../../../shared/taste";
import { api } from "../../api";
import type { MediaItem } from "../../types";

export type DreamMedia = "image" | "video";

export type { DreamSettings } from "../../../../shared/dream";
type DreamStatus = "off" | "paused" | "waiting" | "generating" | "capped" | "unavailable";
export type DreamItem = MediaItem & {
  dream?: {
    prompt: string;
    why: string;
    at: string;
    state: "unseen" | "kept" | "discarded";
    decidedAt?: string;
    /** How Dream made it; a clip animates a still or extends a video. */
    arm?: string;
    uncensored?: true;
    /** One side of a comparison: alike but for what `question` asks about. */
    pair?: { id: string; side: 0 | 1 | 2; size?: 3; question: string; label: string };
    projectId?: string;
  };
};
/** A comparison's answer: a side, all or none. */
export const comparisonVotes = ["a", "b", "c"] as const;
export type PairAnswer = (typeof comparisonVotes)[number] | "both" | "neither";
export type SetOverride = "like" | "discard";
export type SetOverrides = Record<string, SetOverride>;
export interface Dream {
  settings: DreamSettings;
  /** Finished results waiting for a verdict, oldest first. */
  unseen: DreamItem[];
  /** When the visit before this one ended; null on the first. */
  since: string | null;
  /** What Dream has made today. */
  today: DreamCounts;
  /** Jobs counted towards the limits, when different from the day's totals. */
  usage?: DreamCounts;
  uncensoredAvailable: boolean;
  /** The settings an administrator forces on every account, which this one can't change. */
  locked: (keyof DreamSettings)[];
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
/** The header's count of cards waiting for a verdict. */
export const dreamCountQuery = queryOptions({
  queryKey: ["dream", "count"],
  queryFn: () =>
    api<{ unseen: number; images: number; videos: number; active: boolean }>("/api/dream/count"),
  refetchInterval: (query) => (query.state.data?.active ? 15_000 : false),
  refetchOnWindowFocus: "always",
});
/** The account's Dream keeps by profile, LoRA and caption tag; verdicts refresh it with Dream's. */
export const keepRatesQuery = queryOptions({
  queryKey: ["dream", "keep-rates"],
  queryFn: () => api<KeepRates>("/api/dream/keep-rates"),
  staleTime: 5 * 60_000,
});
export const discardedQuery = (media: DreamMedia) =>
  infiniteQueryOptions({
    queryKey: ["dream", "discarded", media],
    queryFn: ({ pageParam }) =>
      api<{ items: DreamItem[]; nextCursor: string }>(
        `/api/dream/discarded?media=${media}&limit=40&cursor=${encodeURIComponent(pageParam)}`,
      ),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
export const libraryReviewQuery = (seed: string, media: DreamMedia) =>
  infiniteQueryOptions({
    queryKey: ["dream-library-review", seed, media],
    queryFn: ({ pageParam }) =>
      api<{ items: MediaItem[]; nextCursor: string; remaining: number }>(
        `/api/gallery/library-review?seed=${seed}&media=${media}&cursor=${pageParam}`,
      ),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: Infinity,
    gcTime: 0,
  });
export const libraryReviewPath = (item: MediaItem) =>
  `/api/gallery/library-review/${encodeURIComponent(item.id)}`;

export const dreamItemPath = (item: { id: string }, action: string) =>
  `/api/dream/${encodeURIComponent(item.id)}/${action}`;
export const pairAnswerPath = (pairId: string) =>
  `/api/dream/pairs/${encodeURIComponent(pairId)}/answer`;
export const setAnswerPath = (setId: string) =>
  `/api/dream/sets/${encodeURIComponent(setId)}/answer`;

/**
 * When Dream works, or why it doesn't, and how much of today's share it has made: one line each,
 * such as "Dream works when the queue is free" and "12 of 40 today".
 */
const dailyShare = (today: number, used: number, limit: number, kind: "images" | "videos") =>
  used === today
    ? `${today} of ${limit} ${kind === "images" ? "today" : "videos"}`
    : `${today} ${kind} today · ${used} of ${limit} since reset`;

export const dreamWhen = ({ settings, today, usage = today, status }: Dream) => [
  status === "capped" ? "Dream has made today's share" : "Dream works when the queue is free",
  ...(settings.images
    ? [dailyShare(today.images, usage.images, settings.dailyImages, "images")]
    : []),
  ...(settings.videos
    ? [dailyShare(today.videos, usage.videos, settings.dailyVideos, "videos")]
    : []),
];

export const projectsQuery = queryOptions({
  queryKey: ["dream", "projects"],
  queryFn: () =>
    api<{ projects: Project[]; stats: Record<string, ProjectStats<DreamItem>> }>(
      "/api/dream/projects",
    ),
});
export const projectPath = (project: { id: string }, action = "") =>
  `/api/dream/projects/${encodeURIComponent(project.id)}${action && `/${action}`}`;
/** A project's results for its detail view, newest first. */
export const projectResultsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["dream", "projects", projectId, "results"],
    queryFn: () => api<{ items: DreamItem[] }>(projectPath({ id: projectId }, "results")),
  });

/** What Dream proposes in Dream › Projects' Inbox (backend/domain/inbox.ts). */
export const inboxQuery = queryOptions({
  queryKey: ["dream", "inbox"],
  queryFn: () => api<Inbox<DreamItem>>("/api/dream/inbox"),
  refetchInterval: 60_000,
});
export const proposalPath = (proposal: { id: string }, action: "accept" | "dismiss" | "undo") =>
  `/api/dream/inbox/${encodeURIComponent(proposal.id)}/${action}`;

/** Dream › This Week (backend/domain/dream-digest.ts). */
export const weekQuery = queryOptions({
  queryKey: ["dream", "week"],
  queryFn: () => api<DreamDigest<DreamItem>>("/api/dream/week"),
});

export const historyQuery = (media: DreamMedia) =>
  queryOptions({
    queryKey: ["dream", "history", media],
    queryFn: () => api<{ items: DreamActivity[] }>(`/api/dream/history?media=${media}`),
  });
