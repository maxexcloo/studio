import type { QueueMedia, QueueStatus } from "../../shared/queue.ts";
import { queuePriority, RewriteStore, type OwnedJob } from "./store.ts";

export interface JobObservation {
  status: QueueStatus;
  reason?: string;
  providerJobId?: string;
  backend?: string;
  progress?: Record<string, unknown>;
  items?: QueueMedia[];
  outputs?: QueueMedia[];
}

export interface QueueAdapter {
  submit(job: OwnedJob): Promise<JobObservation>;
  observe(job: OwnedJob): Promise<JobObservation | undefined>;
  cancel(job: OwnedJob): Promise<void>;
  saveOutputs(job: OwnedJob): Promise<JobObservation | void>;
  eligible?(job: OwnedJob): Promise<string | undefined>;
  settled?(job: OwnedJob): Promise<void>;
}

export const terminalStatuses = new Set<QueueStatus>(["completed", "failed", "cancelled"]);
const accepted = (job: OwnedJob) =>
  !terminalStatuses.has(job.status) && !["queued", "waiting"].includes(job.status);

/** Only this database's recorded IDs reach the provider adapter. Restart never resubmits accepted work. */
export class GenerationQueue {
  private runs = new Set<Promise<void>>();
  private observing = new Set<string>();
  private scheduling = new Set<string>();
  private checkingEligibility = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private acceptedIds = new Set<string>();
  private stopped = false;
  readonly store: RewriteStore;
  readonly adapter: QueueAdapter;

  constructor(store: RewriteStore, adapter: QueueAdapter) {
    this.store = store;
    this.adapter = adapter;
    for (const job of store.jobs()) {
      if (accepted(job) || job.providerJobId) this.acceptedIds.add(job.id);
    }
  }

  start() {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick().catch(() => undefined), 1000);
      this.timer.unref();
      void this.tick().catch(() => undefined);
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.runs);
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const run = this.run().finally(() => {
      this.runs.delete(run);
    });
    this.runs.add(run);
    return run;
  }

  private async run() {
    await Promise.all(
      this.store
        .jobs()
        .filter(
          (item) =>
            !terminalStatuses.has(item.status) &&
            this.acceptedIds.has(item.id) &&
            !this.observing.has(item.id),
        )
        .map(async (initial) => {
          this.observing.add(initial.id);
          let job = initial;
          try {
            const observed = await this.adapter.observe(job);
            if (!observed) {
              const latest = this.store.job(job.ownerId, job.id)!;
              if (!terminalStatuses.has(latest.status))
                this.store.save({
                  ...latest,
                  reason: "Recovering the recorded generation; it will not be submitted again.",
                });
              return;
            }
            job = {
              ...this.store.job(job.ownerId, job.id)!,
              ...observed,
              reason: observed.reason || "",
            };
            if (observed.status === "completed") {
              job = this.store.save({ ...job, status: "saving" });
              const saved = await this.adapter.saveOutputs(job);
              // A cancellation that raced saving cannot discard already saved results.
              const completed = this.store.save({ ...job, ...saved, status: "completed" });
              await this.adapter.settled?.(completed);
            } else {
              this.store.save(job);
              if (terminalStatuses.has(job.status)) await this.adapter.settled?.(job);
            }
          } catch (error) {
            const latest = this.store.job(job.ownerId, job.id)!;
            this.store.save({
              ...latest,
              reason: `Waiting for the recorded generation: ${(error as Error).message}`,
            });
          } finally {
            this.observing.delete(initial.id);
          }
        }),
    );
    const occupied = new Set(
      this.store
        .jobs()
        .filter((job) => !terminalStatuses.has(job.status) && this.acceptedIds.has(job.id))
        .map((job) => job.resource),
    );
    // A started MCP set finishes before anything else on its resource, so its jobs stay contiguous.
    const startedSets = new Set(
      this.store
        .jobs()
        .filter(
          (job) =>
            job.queueSet &&
            (this.acceptedIds.has(job.id) ||
              !["queued", "waiting", "cancelled"].includes(job.status)),
        )
        .map((job) => job.queueSet),
    );
    const rank = (job: OwnedJob) =>
      job.queueSet && startedSets.has(job.queueSet) ? -1 : (job.priority ?? queuePriority.manual);
    const groups = new Map<string, OwnedJob[]>();
    for (const job of this.store
      .jobs()
      .filter(
        (item) => ["queued", "waiting"].includes(item.status) && !this.acceptedIds.has(item.id),
      )) {
      if (occupied.has(job.resource)) {
        this.store.save({
          ...job,
          status: "waiting",
          reason: "Waiting for earlier work to finish and save its outputs.",
        });
      } else if (!this.scheduling.has(job.resource)) {
        const group = groups.get(job.resource) || [];
        group.push(job);
        groups.set(job.resource, group);
      }
    }
    // Lower tiers wait while higher ones are queued (no aging); the stable sort keeps FIFO within a tier.
    for (const candidates of groups.values()) candidates.sort((a, b) => rank(a) - rank(b));
    await Promise.all(
      [...groups].map(async ([resource, candidates]) => {
        // Resource groups run independently. A slow cloud request or offline worker cannot hold the scheduler.
        this.scheduling.add(resource);
        try {
          for (let job of candidates) {
            let reason: string | undefined;
            this.checkingEligibility.add(job.id);
            try {
              reason = await this.adapter.eligible?.(job);
            } catch (error) {
              reason = (error as Error).message;
            } finally {
              this.checkingEligibility.delete(job.id);
            }
            job = this.store.job(job.ownerId, job.id)!;
            if (job.status === "cancelled") {
              await this.adapter.settled?.(job);
              continue;
            }
            if (reason) {
              this.store.save({ ...job, status: "waiting", reason });
              continue;
            }
            job = this.store.save({ ...job, status: "starting", reason: "" });
            // Persist starting before crossing the provider boundary: interrupted responses are never resubmitted.
            this.acceptedIds.add(job.id);
            try {
              const observation = await this.adapter.submit(job);
              const latest = this.store.job(job.ownerId, job.id)!;
              let submitted = this.store.save({
                ...latest,
                ...observation,
                ...(observation.status === "completed" ? { status: "saving" as const } : {}),
              });
              if (observation.status === "completed") {
                const saved = await this.adapter.saveOutputs(submitted);
                submitted = this.store.save({ ...submitted, ...saved, status: "completed" });
              }
              if (latest.cancelRequested && !terminalStatuses.has(observation.status))
                await this.adapter.cancel(submitted);
              if (terminalStatuses.has(observation.status)) {
                await this.adapter.settled?.(submitted);
                continue;
              }
            } catch (error) {
              const latest = this.store.job(job.ownerId, job.id)!;
              this.store.save({
                ...latest,
                reason: `Submission outcome is unknown; checking before any retry: ${(error as Error).message}`,
              });
            }
            for (const pending of candidates) {
              const latest = this.store.job(pending.ownerId, pending.id)!;
              if (["queued", "waiting"].includes(latest.status) && !this.acceptedIds.has(latest.id))
                this.store.save({
                  ...latest,
                  status: "waiting",
                  reason: "Waiting for earlier work to finish and save its outputs.",
                });
            }
            break;
          }
        } finally {
          this.scheduling.delete(resource);
        }
      }),
    );
  }

  async cancel(ownerId: string, id: string): Promise<OwnedJob | undefined> {
    const job = this.store.job(ownerId, id);
    if (!job || terminalStatuses.has(job.status)) return job;
    if (!this.acceptedIds.has(job.id)) {
      const cancelled = this.store.save({
        ...job,
        status: "cancelled" as const,
        reason: "Cancelled before submission.",
      });
      if (!this.checkingEligibility.has(job.id)) await this.adapter.settled?.(cancelled);
      return cancelled;
    }
    const pending = this.store.save({
      ...job,
      cancelRequested: true,
      reason: "Cancelling the recorded generation.",
    });
    await this.adapter.cancel(pending);
    return this.store.job(ownerId, id);
  }

  retry(ownerId: string, id: string, jobLimit?: number): OwnedJob | undefined {
    const job = this.store.job(ownerId, id);
    if (!job || job.status !== "failed") return;
    return this.store.enqueue(
      ownerId,
      job.sessionId,
      job.input,
      job.operation,
      job.parentJobId,
      job.resource,
      undefined,
      jobLimit,
    );
  }
}
