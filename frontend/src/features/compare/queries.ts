import { queryOptions } from "@tanstack/react-query";

import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { finished } from "../gallery/MediaTile";

export interface Comparison {
  id: string;
  createdAt: string;
  /** The shared seed; empty when the variants used different seeds. */
  seed: string;
  /** The result set every variant belongs to, which the gallery shows together. */
  set?: string;
  /** Present when every variant used the same prompt. */
  prompt?: string;
  /** Present when every variant used the same negative prompt, even an empty one. */
  negative?: string;
  /** The winner's job ID. */
  vote: string | null;
  /** The exact winning image, even when variants share a batch. */
  winnerItemId: string | null;
  variants: { jobId: string; label: string; item: MediaItem | null }[];
  /** What the variants of one result vary ("lighting"); a pick is proposed for its project's brief. */
  axis?: string;
  /** The project whose brief a vote just proposed a change to, in Dream's Inbox. */
  proposal?: { projectId: string; name: string };
  /** A Dream comparison the account kept a side of, with its question; it is read-only. */
  dream?: { question: string };
}

/** One compare set; it polls only while a variant is still generating. */
export const comparisonQuery = (id: string) =>
  queryOptions({
    queryKey: ["comparison", id],
    queryFn: () => api<Comparison>(`/api/comparisons/${encodeURIComponent(id)}`),
    refetchInterval: (query) =>
      query.state.data?.variants.every((variant) => !variant.item || finished(variant.item))
        ? false
        : 2000,
  });

/** The account's comparisons with their variants, newest first. */
export const comparisonsQuery = queryOptions({
  queryKey: ["comparisons", "list"],
  queryFn: () => api<{ comparisons: Comparison[] }>("/api/comparisons"),
});

/** A comparison's heading: Dream's question or the one its axis asks, else Compare. */
export const comparisonTitle = ({ axis, dream }: Pick<Comparison, "axis" | "dream">) =>
  dream?.question || (axis ? `Which ${titleCase(axis)}?` : "Compare");

/** Which results each of the account's comparisons holds, to find an item's comparison. */
export const comparisonMembersQuery = queryOptions({
  queryKey: ["comparisons", "members"],
  queryFn: () =>
    api<{ comparisons: { id: string; jobIds: string[]; itemIds?: string[] }[] }>(
      "/api/comparisons?members=1",
    ),
  staleTime: 60_000,
});

/** The newest comparison holding `item` (its chosen image, else its job's), if any. */
export const comparisonOf = (
  members: { comparisons: { id: string; jobIds: string[]; itemIds?: string[] }[] } | undefined,
  item: MediaItem,
) =>
  members?.comparisons.find((comparison) =>
    comparison.itemIds
      ? comparison.itemIds.includes(item.id)
      : Boolean(item.jobId && comparison.jobIds.includes(item.jobId)),
  )?.id;
