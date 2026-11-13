import { isVersion, resultInput } from "../../../../shared/versions.ts";
import type { MediaItem, QueueJob } from "../../types";

/** A result and the versions made from it (Edit, Prompt, Animate and so on), in tree order. */
export type VersionGroup = MediaItem[];

const results = (job?: QueueJob) => (job?.items?.length ? job.items : job?.outputs || []);

/**
 * The source a job's run was made from, and whether the run is one of its versions: compared with
 * the parent run, or for a run made outside its source's session with the source itself (`known`).
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
function itemDerivation(
  item: MediaItem,
  byJob: Map<string, QueueJob>,
  known?: Map<string, MediaItem>,
) {
  if (item.parentItemId) return { source: item.parentItemId, version: !item.derived };
  return derivation(item.jobId ? byJob.get(item.jobId) : undefined, byJob, known);
}

/** A version in its group's tree: its source among the group, and how many generations it is from the original. */
export interface Version {
  item: MediaItem;
  source?: string;
  depth: number;
}

/** Each item's source among `items`, for an item that is one of its source's versions. */
export function versionSources(items: MediaItem[], jobs: QueueJob[]) {
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const loaded = new Map(items.map((item) => [item.id, item]));
  const sources = new Map<string, string>();
  for (const item of items) {
    const made = itemDerivation(item, byJob, loaded);
    if (made?.version && loaded.has(made.source)) sources.set(item.id, made.source);
  }
  return sources;
}

/**
 * Orders `items` (newest first) as their version trees, each oldest first: an original, then each
 * of its versions followed by that version's own, the branch holding the latest version last.
 * Reversed, the latest version leads and the original ends, each branch kept together. An item
 * whose source is not among them is an original; trees keep the order of their latest version.
 */
export function versionTree(items: MediaItem[], sources: Map<string, string>): Version[] {
  const order = new Map(items.map((item, index) => [item.id, index]));
  const children = new Map<string | undefined, MediaItem[]>();
  for (const item of items) {
    const source = sources.get(item.id);
    const key = source && order.has(source) ? source : undefined;
    children.set(key, [...(children.get(key) || []), item]);
  }
  const latest = new Map<string, number>();
  const newest = (item: MediaItem): number => {
    if (!latest.has(item.id))
      latest.set(
        item.id,
        Math.min(order.get(item.id)!, ...(children.get(item.id) || []).map(newest)),
      );
    return latest.get(item.id)!;
  };
  const branches = (key?: string) =>
    [...(children.get(key) || [])].sort((a, b) => newest(b) - newest(a));
  const tree: Version[] = [];
  const visit = (item: MediaItem, depth: number, source?: string) => {
    tree.push({ item, source, depth });
    for (const version of branches(item.id)) visit(version, depth + 1, item.id);
  };
  for (const original of branches().reverse()) visit(original, 0);
  return tree;
}

/**
 * Groups loaded items into version trees (`versionTree`). Only a result made from another joins
 * it: one that records it as its source (`parentItemId`) and is a version of it (`isVersion`).
 * Sharing a session or a prompt never groups. Groups keep the order of their latest version.
 */
export function versionGroups(items: MediaItem[], jobs: QueueJob[]): VersionGroup[] {
  const groups: VersionGroup[] = [];
  for (const { item, depth } of versionTree(items, versionSources(items, jobs)))
    if (depth) groups.at(-1)!.push(item);
    else groups.push([item]);
  return groups;
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
export function derivations(item: MediaItem, items: MediaItem[], jobs: QueueJob[]) {
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const known = knownResults(items, jobs);
  const made = itemDerivation(item, byJob, known);
  const source = made ? known.get(made.source) : undefined;
  const derived = [...known.values()].filter((result) => {
    const from = result.url ? itemDerivation(result, byJob, known) : undefined;
    return from?.source === item.id && !from.version;
  });
  return { source, derived };
}
