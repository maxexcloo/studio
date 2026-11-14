import { queryOptions } from "@tanstack/react-query";
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
  /** The starred winner's job ID. */
  vote: string | null;
  /** The exact starred image, even when variants share a batch. */
  winnerItemId: string | null;
  variants: { jobId: string; label: string; item: MediaItem | null }[];
  /** What the variants of one result vary ("lighting"); a pick goes to its project's brief. */
  axis?: string;
  /** The project brief a vote just changed, which Undo restores. */
  brief?: { projectId: string; name: string; styles: string };
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
