/** A job waiting in Studio's queue: the resources it may run on, best first, and how long it takes. */
export interface WaitingRun {
  id: string;
  resources: string[];
  /** Null while its length is unknown. */
  ms: number | null;
}

/**
 * List scheduling: in queue order, each waiting job goes to whichever of its resources frees first,
 * the earlier listed one on a tie. `freeAt` is when each resource clears what it already runs, or
 * null when that is unknown; a resource left out cannot take work. A job of unknown length leaves
 * its resource's time unknown from then on, and a job whose resources are all unknown has no end.
 * Returns each job's end and when each resource is free after the waiting work.
 */
export function listSchedule(freeAt: Map<string, number | null>, waiting: WaitingRun[]) {
  const free = new Map(freeAt);
  const endsAt = new Map<string, number | null>();
  for (const run of waiting) {
    let best: string | undefined;
    for (const resource of run.resources) {
      const at = free.get(resource);
      if (at === undefined || at === null) continue;
      if (best === undefined || at < free.get(best)!) best = resource;
    }
    if (best === undefined) {
      endsAt.set(run.id, null);
      continue;
    }
    const end = run.ms === null ? null : free.get(best)! + run.ms;
    endsAt.set(run.id, end);
    free.set(best, end);
  }
  return { endsAt, freeAt: free };
}

/** The earliest of these resources' free times, or null when none is known. */
export function earliest(freeAt: Map<string, number | null>, resources: string[]) {
  const known = resources
    .map((resource) => freeAt.get(resource))
    .filter((at): at is number => typeof at === "number");
  return known.length ? Math.min(...known) : null;
}
