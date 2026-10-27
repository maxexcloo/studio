import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";

/** A result and the versions made from it (Edit, Recreate, Animate and so on), oldest first. */
export type VersionGroup = MediaItem[];

/**
 * Groups loaded items into version chains. A run made from a result records it as its parent
 * (`parentJobId`, and `parentItemId` within that job); runs from Chat revisions record only the job,
 * which is enough when that job made one result. Groups keep the order of their latest version.
 */
export function versionGroups(items: MediaItem[], jobs: QueueJob[]): VersionGroup[] {
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const loaded = new Set(items.map((item) => item.id));
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const root = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const top = root(next);
    parent.set(id, top);
    return top;
  };
  for (const item of items) {
    const job = item.jobId ? byJob.get(item.jobId) : undefined;
    if (!job?.parentJobId) continue;
    const results = byJob.get(job.parentJobId)?.items || [];
    const source =
      job.parentItemId || (results.length === 1 ? String(results[0].id || "") : undefined);
    if (source && loaded.has(source)) parent.set(root(item.id), root(source));
  }
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = root(item.id);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  // Items arrive newest first; versions read oldest first, so the latest is last.
  return [...groups.values()].map((group) => group.reverse());
}

/** The loaded items' version groups, from the owner's job history. */
export function useVersionGroups(items: MediaItem[]) {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => versionGroups(items, jobs || []), [items, jobs]);
}
