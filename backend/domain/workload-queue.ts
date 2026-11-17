import { activeStatuses, pausedReason, terminalStatuses } from "../../shared/queue.ts";
import type { RuntimeQueueCancel } from "../../shared/runtime.ts";
import type { WorkloadQueue } from "../runtime/controller.ts";
import type { GenerationQueue } from "./queue.ts";
import { type OwnedJob, queuePriority } from "./store.ts";

/** Accepted work holds its workload until it finishes, as Studio retains it when it starts. */
export const acceptedWork = (job: OwnedJob) =>
  !terminalStatuses.has(job.status) &&
  (activeStatuses.has(job.status) || Boolean(job.providerJobId));

const endedReason = "Its worker was restarted while it ran.";

/**
 * Settings › Workers' view of the queue (runtime/controller.ts): each workload's accepted jobs,
 * Cancel Queue, the leases a change no longer waits for and work a forced restart ends. `leases`
 * holds the lease admission took for each job; `admitting` the jobs whose admission is under way.
 */
export function workloadQueue({
  queue,
  leases,
  admitting,
  workloads,
  endRun,
}: {
  queue: GenerationQueue;
  leases: Map<string, { release(): void }>;
  admitting: Set<string>;
  /** The workloads that can serve a job. */
  workloads(job: OwnedJob): string[];
  /** Stops a job's live run from saving anything more. */
  endRun(job: OwnedJob, status: "failed" | "cancelled", reason: string): void;
}): WorkloadQueue {
  const { store } = queue;
  const on = (workload: string) =>
    store.openJobs().filter((job) => workloads(job).includes(workload));
  return {
    load(workload) {
      const jobs = on(workload);
      return {
        jobs: jobs.filter(acceptedWork).map((job) => ({
          id: job.id,
          title:
            String(job.input.prompt || "")
              .trim()
              .slice(0, 80) || `Untitled ${job.operation}`,
          status: job.status,
          since: job.updatedAt,
          ...(job.cancelRequested ? { cancelling: true as const } : {}),
        })),
        queued: jobs.filter((job) => !acceptedWork(job)).length,
      };
    },
    waitingTier(workload) {
      return Math.min(
        ...on(workload)
          .filter((job) => !acceptedWork(job) && job.reason !== pausedReason)
          .map((job) => job.priority ?? queuePriority.manual),
      );
    },
    async cancel(workload) {
      const counts: RuntimeQueueCancel = { cancelled: 0, cancelling: 0 };
      for (const job of on(workload)) {
        // A worker that can't confirm leaves the request recorded; the job counts as cancelling.
        const after = await queue
          .cancel(job.ownerId, job.id)
          .catch(() => store.job(job.ownerId, job.id));
        if (after?.status === "cancelled") counts.cancelled += 1;
        else if (after && !terminalStatuses.has(after.status)) counts.cancelling += 1;
      }
      return counts;
    },
    releaseStale() {
      const open = new Map(store.jobsById([...leases.keys()]).map((job) => [job.id, job]));
      for (const [id, lease] of leases) {
        const job = open.get(id);
        if (admitting.has(id) || (job && acceptedWork(job))) continue;
        lease.release();
        leases.delete(id);
      }
    },
    async end(workload) {
      // Saving work already has its outputs with Studio, so it finishes.
      for (const job of on(workload).filter(
        (item) => acceptedWork(item) && item.status !== "saving",
      )) {
        endRun(job, job.cancelRequested ? "cancelled" : "failed", endedReason);
        await queue.end(job.ownerId, job.id, endedReason);
      }
    },
  };
}
