import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { MediaItem } from "../../types";
import { assistantQuery } from "../generation/PromptAssistant";
import { motionIdeasQuery, nextStepsQuery } from "../taste/suggestions";
import { canSuggestChangeForItem } from "./useItemChange";

export const reviewSuggestionCount = 5;

const specificQueries = (item: MediaItem) =>
  item.type === "image"
    ? [
        nextStepsQuery(item, undefined, "recreate"),
        nextStepsQuery(item, undefined, "edit"),
        motionIdeasQuery(item),
      ]
    : [];

export function usePrefetchResultSuggestions(current?: MediaItem, reviewItems?: MediaItem[]) {
  const client = useQueryClient();
  const available = useQuery({ ...assistantQuery, enabled: !!current }).data?.available;
  const attempted = useRef(new Set<string>());
  const pending = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    if (!available || !current || !canSuggestChangeForItem(current)) return;
    const upcoming = reviewItems
      ?.filter((item) => item.id !== current.id && canSuggestChangeForItem(item))
      .slice(0, reviewSuggestionCount);
    const queries = [
      ...(reviewItems || current.type === "video" ? [nextStepsQuery(current)] : []),
      ...(upcoming?.map((item) => nextStepsQuery(item)) ?? []),
      ...specificQueries(current),
    ];
    let cancelled = false;
    async function prefetch() {
      for (const query of queries) {
        // Reorder the remaining work after navigation, with only one background write at a time.
        await pending.current;
        if (cancelled) return;
        const key = JSON.stringify(query.queryKey);
        const state = client.getQueryState(query.queryKey);
        if (attempted.current.has(key) && (state?.dataUpdatedAt || state?.errorUpdatedAt)) continue;
        attempted.current.add(key);
        pending.current = client.prefetchQuery(query);
      }
    }
    const idle = window.requestIdleCallback ?? setTimeout;
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(() => void prefetch());
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [available, client, current, reviewItems]);
}
