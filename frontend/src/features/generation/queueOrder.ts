import { activeStatuses, pendingStatuses } from "../../../../shared/queue.ts";
import type { QueueJob } from "../../types";

/** The account's waiting jobs. Dream keeps its own tier. */
export const movableJob = (job: QueueJob) => !job.dream && pendingStatuses.has(job.status);

/** The scheduler sends the visible waiting order separately from the stored drag order. */
export function jobsInDispatchOrder(jobs: QueueJob[], waiting?: string[]) {
  const active: QueueJob[] = [];
  const failed: QueueJob[] = [];
  const pending = new Map<string, QueueJob>();
  const waitingIds = new Set(waiting);
  for (const job of jobs) {
    const writing = waiting && job.status === "writing" && !waitingIds.has(job.id);
    if (activeStatuses.has(job.status) || writing) active.push(job);
    else if (pendingStatuses.has(job.status)) pending.set(job.id, job);
    else if (job.status === "failed") failed.push(job);
  }
  const ordered: QueueJob[] = [];
  for (const id of waitingIds) {
    const job = pending.get(id);
    if (!job) continue;
    ordered.push(job);
    pending.delete(id);
  }
  const unranked = [...pending.values()];
  return [
    ...active,
    ...ordered,
    ...unranked.filter((job) => !job.dream),
    ...unranked.filter((job) => job.dream),
    ...failed,
  ];
}

/** A drop moves the stored waiting block beside the destination's stored waiting block. */
export function moveWaitingJobs(
  jobs: QueueJob[],
  moving: QueueJob[],
  destination: QueueJob[],
  after: boolean,
) {
  const pending = jobs.filter(movableJob);
  const moved = new Set(moving.map((job) => job.id));
  const anchor = new Set(destination.filter(movableJob).map((job) => job.id));
  const order = pending.filter((job) => !moved.has(job.id));
  let nextTo = -1;
  for (const [index, job] of order.entries()) {
    if (!anchor.has(job.id)) continue;
    nextTo = index;
    if (!after) break;
  }
  if (nextTo < 0) return;
  const at = nextTo + Number(after);
  order.splice(at, 0, ...pending.filter((job) => moved.has(job.id)));
  return { at, order };
}
