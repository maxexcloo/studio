import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isVersion } from "../../../../shared/versions";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";

/** A result and the versions made from it (Edit, Prompt, Animate and so on), oldest first. */
export type VersionGroup = MediaItem[];

/** The source a job's run was made from, and whether the run is one of its versions. */
export function derivation(job: QueueJob | undefined, byJob: Map<string, QueueJob>) {
  const parent = job?.parentItemId && job.parentJobId ? byJob.get(job.parentJobId) : undefined;
  if (!job?.parentItemId || !parent) return;
  return { source: job.parentItemId, version: isVersion(job, parent) };
}

/**
 * Groups loaded items into version chains. Only a run made from a result joins it: one that
 * records the result as its source (`parentItemId`) and is a version of it (`isVersion`). Sharing a
 * session or a prompt never groups. Groups keep the order of their latest version.
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
    const made = derivation(item.jobId ? byJob.get(item.jobId) : undefined, byJob);
    if (made?.version && loaded.has(made.source)) parent.set(root(item.id), root(made.source));
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

/**
 * The result this item was made from and the results made from it that changed too much to be its
 * versions (`isVersion`), for Details › From and Derived.
 */
export function useDerivations(item: MediaItem) {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => {
    const byJob = new Map((jobs || []).map((job) => [job.id, job]));
    const results = (job?: QueueJob) => (job?.items?.length ? job.items : job?.outputs || []);
    const job = item.jobId ? byJob.get(item.jobId) : undefined;
    const made = derivation(job, byJob);
    const source = made
      ? results(byJob.get(job!.parentJobId!)).find((result) => result.id === made.source)
      : undefined;
    const derived = (jobs || [])
      .filter((run) => run.parentItemId === item.id && derivation(run, byJob)?.version === false)
      .flatMap((run) => results(run).filter((result) => result.url));
    return { source, derived };
  }, [jobs, item.id, item.jobId]);
}
