import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isVersion, resultInput } from "../../../../shared/versions";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";

/** A result and the versions made from it (Edit, Prompt, Animate and so on), oldest first. */
export type VersionGroup = MediaItem[];

const none: MediaItem[] = [];
const results = (job?: QueueJob) => (job?.items?.length ? job.items : job?.outputs || []);

/**
 * The source a job's run was made from, and whether the run is one of its versions: compared with
 * the parent run, or for a run made outside its source's Chat with the source itself (`known`).
 */
export function derivation(
  job: QueueJob | undefined,
  byJob: Map<string, QueueJob>,
  known?: Map<string, MediaItem>,
) {
  if (!job?.parentItemId) return;
  const parent = job.parentJobId ? byJob.get(job.parentJobId) : undefined;
  const source = parent ? undefined : known?.get(job.parentItemId);
  if (!parent && !source) return;
  return {
    source: job.parentItemId,
    version: isVersion(job, parent || { input: resultInput(source!) }),
  };
}

/**
 * The source an item was made from and whether it is one of its versions: what the item kept of
 * its run, or, before it has, its run's while that is in the queue.
 */
export function itemDerivation(
  item: MediaItem,
  byJob: Map<string, QueueJob>,
  known?: Map<string, MediaItem>,
) {
  if (item.parentItemId) return { source: item.parentItemId, version: !item.derived };
  return derivation(item.jobId ? byJob.get(item.jobId) : undefined, byJob, known);
}

/**
 * Groups loaded items into version chains. Only a result made from another joins it: one that
 * records it as its source (`parentItemId`) and is a version of it (`isVersion`). Sharing a session
 * or a prompt never groups. Groups keep the order of their latest version.
 */
export function versionGroups(items: MediaItem[], jobs: QueueJob[]): VersionGroup[] {
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const loaded = new Map(items.map((item) => [item.id, item]));
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const root = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const top = root(next);
    parent.set(id, top);
    return top;
  };
  for (const item of items) {
    const made = itemDerivation(item, byJob, loaded);
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

/** The loaded items' version groups. */
export function useVersionGroups(items: MediaItem[]) {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => versionGroups(items, jobs || []), [items, jobs]);
}

/** Results by ID: those of the owner's jobs (the latest while they run), then the loaded `items`. */
export function knownResults(items: MediaItem[], jobs: QueueJob[]) {
  const known = new Map<string, MediaItem>();
  for (const result of [...jobs.flatMap(results), ...items])
    if (!known.has(result.id)) known.set(result.id, result);
  return known;
}

/**
 * The result this item was made from and the results made from it that changed too much to be its
 * versions (`isVersion`), for Details › From and Derived, among the loaded `items` and the owner's
 * jobs.
 */
export function useDerivations(item: MediaItem, items: MediaItem[] = none) {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => {
    const byJob = new Map((jobs || []).map((job) => [job.id, job]));
    const known = knownResults(items, jobs || []);
    const made = itemDerivation(item, byJob, known);
    const source = made ? known.get(made.source) : undefined;
    const derived = [...known.values()].filter((result) => {
      const from = result.url ? itemDerivation(result, byJob, known) : undefined;
      return from?.source === item.id && !from.version;
    });
    return { source, derived };
  }, [jobs, items, item]);
}
