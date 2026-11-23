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
  const ids = new Set(items.map(({ id }) => id));
  const originals: MediaItem[] = [];
  const children = new Map<string, MediaItem[]>();
  for (const item of items) {
    const source = sources.get(item.id);
    if (source && ids.has(source)) {
      const siblings = children.get(source);
      if (siblings) siblings.push(item);
      else children.set(source, [item]);
    } else originals.push(item);
  }
  // Each item's index (newest first) or its latest version's, whichever is newer.
  const latest = new Map<MediaItem, number>();
  items.forEach((item, index) => latest.set(item, index));
  const branchesNewest = new Map<string, number>();
  const newest = (item: MediaItem): number => {
    const cached = branchesNewest.get(item.id);
    if (cached !== undefined) return cached;
    let index = latest.get(item)!;
    for (const child of children.get(item.id) || []) index = Math.min(index, newest(child));
    branchesNewest.set(item.id, index);
    return index;
  };
  const branches = (versions: MediaItem[] = []) =>
    versions
      .map((item) => ({ item, newest: newest(item) }))
      .sort((a, b) => b.newest - a.newest)
      .map(({ item }) => item);
  const tree: Version[] = [];
  const visit = (item: MediaItem, depth: number, source?: string) => {
    tree.push({ item, source, depth });
    for (const version of branches(children.get(item.id))) visit(version, depth + 1, item.id);
  };
  for (const original of branches(originals).reverse()) visit(original, 0);
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

/** A result's recorded ancestry and direct offshoots among loaded results and the owner's jobs. */
export function derivations(item: MediaItem, items: MediaItem[], jobs: QueueJob[]) {
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const known = knownResults(items, jobs);
  const parentOf = (result: MediaItem) =>
    result.parentItemId || (result.jobId && byJob.get(result.jobId)?.parentItemId);
  const parentId = parentOf(item);
  const sourceId = parentId === item.id ? undefined : parentId;
  const source = sourceId ? known.get(sourceId) : undefined;
  let original = source;
  const seen = new Set([item.id]);
  while (original) {
    const parent = parentOf(original);
    if (!parent) break;
    seen.add(original.id);
    original = seen.has(parent) ? undefined : known.get(parent);
  }
  const versions: MediaItem[] = [];
  const derived: MediaItem[] = [];
  for (const result of known.values()) {
    if (!result.url || result.id === item.id || parentOf(result) !== item.id) continue;
    const from = itemDerivation(result, byJob, known);
    if (from) (from.version ? versions : derived).push(result);
  }
  return {
    sourceId,
    source,
    original: original === source ? undefined : original,
    versions,
    derived,
  };
}
