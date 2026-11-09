import { pausedReason } from "../shared/queue.ts";
import { listSchedule } from "./domain/eta.ts";
import { jobs, queueClearsAt } from "./jobs.js";
import { generationEstimate, upscaleEstimate } from "./timings.js";
import { upscaleWork } from "./upscale-timing.js";
import { upscalePlan, upscaleQualities } from "./upscale.js";
import { listWorkers } from "./workers.js";

/**
 * What one run of `input` should take here, its Smart upscale (`autoUpscale`) included, or null
 * until the estimates are trusted. `warm` says whether its model is already loaded.
 */
export function runEstimate(input, { now = Date.now(), warm } = {}) {
  const estimate = generationEstimate(input, { now, warm });
  if (!estimate?.trusted) return null;
  const quality = input.autoUpscale?.quality;
  if (input.kind === "video" || !upscaleQualities.includes(quality)) return estimate.totalMs;
  const plan = upscalePlan({
    width: input.width,
    height: input.height,
    quality,
    target: Number(input.autoUpscale.target) || 0,
  });
  const upscale = upscaleEstimate({
    quality,
    faceDetail: Boolean(input.autoUpscale.faceDetail),
    work: upscaleWork({
      width: plan.estimatedWidth,
      height: plan.estimatedHeight,
      count: Math.max(1, Number(input.count) || 1),
    }),
  });
  return upscale?.trusted ? estimate.totalMs + upscale.totalMs : null;
}

const waitingStatuses = new Set(["starting", "queued", "waiting", "writing"]);

/**
 * When the local work waiting in Studio's queue should be done, list-scheduled (domain/eta.ts) onto
 * whichever worker frees first after what it already runs: work being handed to its worker first,
 * then the rest in queue order, each on its own worker or, for Automatic work, any worker that could
 * take it. `ahead(job)` limits it to the jobs that would go before new work. Returns each job's end
 * and when each `worker:<id>` resource is free after them, null where that is unknown.
 */
export function queueSchedule(queue, { now = Date.now(), ahead = () => true } = {}) {
  const freeAt = new Map(
    listWorkers().map((worker) => [`worker:${worker.id}`, queueClearsAt(now, worker.id)]),
  );
  const tier = (job) => (job.status === "starting" ? -1 : (job.priority ?? 0));
  const waiting = queue.store
    .schedulable()
    .filter(
      (job) =>
        job.resource.startsWith("worker:") &&
        waitingStatuses.has(job.status) &&
        job.reason !== pausedReason &&
        // Work its worker already has is in queueClearsAt.
        !jobs.has(job.id) &&
        ahead(job),
    )
    .map((job, index) => ({ job, index }))
    .sort((a, b) => tier(a.job) - tier(b.job) || a.index - b.index)
    .map(({ job }) => ({
      id: job.id,
      resources:
        job.status === "starting"
          ? [job.resource]
          : [...new Set([job.resource, ...(queue.adapter.alternatives?.(job) ?? [])])],
      ms: runEstimate(job.input, { now }),
    }));
  return listSchedule(freeAt, waiting);
}

/**
 * Each worker's work for its status (runtime/services.ts), by worker id: the queue's load and when
 * it should be free of its running and waiting work, null when unknown.
 */
export function workerLoads(queue, now = Date.now()) {
  const loads = queue.loads();
  const { freeAt } = queueSchedule(queue, { now });
  return new Map(
    listWorkers().map((worker) => {
      const resource = `worker:${worker.id}`;
      return [
        worker.id,
        {
          ...(loads.get(resource) ?? { busy: false, queued: 0, model: "" }),
          freeAt: freeAt.get(resource) ?? null,
        },
      ];
    }),
  );
}
