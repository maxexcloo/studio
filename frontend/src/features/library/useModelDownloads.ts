import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { failure, post } from "../../api";
import { useIsAdmin } from "../auth/AccountGate";
import { fetchModels, modelsQuery } from "../generation/GenerationProvider";
import {
  type DownloadState,
  type ModelDownload,
  catalogueQuery,
  downloadsQuery,
  importsQuery,
} from "./queries";

const running = (item: ModelDownload) => ["downloading", "queued"].includes(item.status);

/**
 * The model downloads an administrator's queue shows: running, waiting, stopped with a partial
 * file to resume, then failed. A finished one refreshes the models and the Library.
 */
export function useModelDownloads() {
  const client = useQueryClient();
  const seenCompleted = useRef(new Set<string>());
  const query = useQuery({
    ...downloadsQuery,
    enabled: useIsAdmin(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.active || data?.queued?.length ? 2000 : 30000;
    },
  });
  const { data } = query;
  useEffect(() => {
    if (!data) return;
    const completed = new Set(
      (data.recent || [])
        .filter((item) => item.status === "done")
        .map((item) => `${item.id}:${item.finishedAt || ""}`),
    );
    if ([...completed].some((key) => !seenCompleted.current.has(key))) {
      void fetchModels(false)
        .then((models) => client.setQueryData(modelsQuery.queryKey, models))
        .catch(failure);
      for (const queryKey of [catalogueQuery.queryKey, importsQuery.queryKey])
        void client.invalidateQueries({ queryKey });
    }
    seenCompleted.current = completed;
  }, [data, client]);
  // One row per file, the first listing winning.
  const shown = new Map<string, ModelDownload>();
  for (const item of [
    data?.active,
    ...(data?.queued || []),
    ...(data?.paused || []),
    ...(data?.recent || []).filter((item) => ["failed", "paused"].includes(item.status)),
  ]) {
    const key = item && `${item.folder}/${item.file}`;
    if (key && !shown.has(key)) shown.set(key, item);
  }
  return [...shown.values()];
}

/**
 * A download's actions: Stop keeps its partial file, Resume or Retry starts it again, and Discard
 * deletes the partial file. Starting or discarding needs ComfyUI running, which a refusal says.
 */
export function useDownloadAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ item, action }: { item: ModelDownload; action: "stop" | "start" | "discard" }) =>
      post<DownloadState>(
        action === "start" ? "/api/models/downloads" : "/api/models/downloads/cancel",
        { id: item.id, ...(action === "discard" ? { discard: true } : {}) },
      ),
    onSuccess: (state) => {
      client.setQueryData(downloadsQuery.queryKey, state);
      void client.invalidateQueries({ queryKey: downloadsQuery.queryKey });
    },
  });
}

/** Which actions a download offers. */
export function downloadActions(item: ModelDownload) {
  const stopped = !running(item) && !!item.id;
  return {
    stop: running(item),
    start: stopped && item.retryable !== false,
    discard: stopped && !!item.receivedBytes,
  };
}
