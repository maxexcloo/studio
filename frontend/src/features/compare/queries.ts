import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { finished } from "../gallery/MediaTile";

export interface Comparison {
  id: string;
  createdAt: string;
  /** The shared seed; empty when the variants used different seeds. */
  seed: string;
  /** Present when every variant used the same prompt. */
  prompt?: string;
  /** Present when every variant used the same negative prompt, even an empty one. */
  negative?: string;
  /** The starred winner's job ID. */
  vote: string | null;
  variants: { jobId: string; label: string; item: MediaItem | null }[];
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
