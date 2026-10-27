import type { PromptWriting, QueueMedia, QueueStatus } from "../../shared/queue.ts";
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

/** What the writing stage streams into the item's progress while the prompt is written. */
export interface WritingProgress {
  thinking: string;
  prompt: string;
}
/** The writing stage's outcome: the prompt with its thinking and model; `why` is Dream's note on it. */
export interface WrittenPrompt {
  prompt: string;
  thinking: string;
  model: string;
  why?: string;
}
/**
 * Writes a job's prompt (`input.writing`), passing the text model's thinking and reply pieces on
 * as they stream (`onThinking`, `onDelta`); throws with the reason.
 */
export type PromptWriter = (
  job: OwnedJob,
  context: {
    signal: AbortSignal;
    onThinking(piece: string): void;
    onDelta(piece: string): void;
  },
) => Promise<WrittenPrompt>;

export const terminalStatuses = new Set<QueueStatus>(["completed", "failed", "cancelled"]);
/** Not yet handed to a provider: writing its prompt, or waiting for its resource. */
const unsubmitted = new Set<QueueStatus>(["writing", "queued", "waiting"]);
const accepted = (job: OwnedJob) =>
  !terminalStatuses.has(job.status) && !unsubmitted.has(job.status);
const started = (job: OwnedJob) => !unsubmitted.has(job.status) && job.status !== "cancelled";
const progressMs = 250;
const maxWrites = 2;
const writeWaitReason = "Waiting for another prompt to be written.";

/** The job once its prompt is written: the prompt runs, its record keeps the thinking, and it queues. */
export function writtenJob(job: OwnedJob, written: WrittenPrompt): OwnedJob {
  return {
    ...job,
    status: "queued",
    reason: "",
    progress: undefined,
    input: {
      ...job.input,
      prompt: written.prompt,
      writing: {
        ...(job.input.writing as PromptWriting),
        prompt: written.prompt,
        model: written.model,
        ...(written.thinking ? { thinking: written.thinking } : {}),
      },
    },
    ...(job.dream
      ? {
          dream: {
            ...job.dream,
            prompt: written.prompt,
            ...(written.why ? { why: written.why } : {}),
          },
        }
      : {}),
  };
}
/** What a job loads on its resource: the model and its enabled LoRAs at their strengths. */
const loadKey = (job: OwnedJob) =>
  JSON.stringify([
    job.input.profileId || job.input.model || "",
    (Array.isArray(job.input.loras) ? job.input.loras : [])
      .filter((lora) => lora && lora.enabled !== false)
      .map((lora) => `${lora.name}@${lora.strength ?? ""}`)
      .sort(),
  ]);
const reuseBypassLimit = 3;

/** Only this database's recorded IDs reach the provider adapter. Restart never resubmits accepted work. */
export class GenerationQueue {
  private runs = new Set<Promise<void>>();
  private observing = new Set<string>();
  private scheduling = new Set<string>();
  private checkingEligibility = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private acceptedIds = new Set<string>();
  /** Load key of the last job started on each resource. */
  private loaded = new Map<string, string>();
  /** Jobs whose prompt is being written, to abort on cancel or stop. */
  private writing = new Map<string, AbortController>();
  private stopped = false;
  readonly store: RewriteStore;
  readonly adapter: QueueAdapter;
  readonly writer?: PromptWriter;

  constructor(store: RewriteStore, adapter: QueueAdapter, writer?: PromptWriter) {
    this.store = store;
    this.adapter = adapter;
    this.writer = writer;
    // One job runs per resource at a time, so after a restart the latest updated started job is what is loaded.
    const latest = new Map<string, OwnedJob>();
    for (const job of store.jobs()) {
      if (accepted(job) || job.providerJobId) this.acceptedIds.add(job.id);
      if (started(job) && !(job.updatedAt < (latest.get(job.resource)?.updatedAt ?? "")))
        latest.set(job.resource, job);
    }
    for (const [resource, job] of latest) this.loaded.set(resource, loadKey(job));
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
    // An interrupted prompt stays in its writing stage and is written afresh after a restart.
    for (const controller of this.writing.values()) controller.abort();
    await Promise.all(this.runs);
  }

  /**
   * The writing stage: the prompt assistant writes the job's prompt, its streamed thinking and
   * prompt gathered into `progress`; the written prompt then becomes the input and the job queues on its
   * resource. A failure fails the job with the reason; a cancellation aborts the writing.
   */
  private write(initial: OwnedJob) {
    const controller = new AbortController();
    this.writing.set(initial.id, controller);
    if (initial.reason) this.store.save({ ...initial, reason: "" });
    const current = () => {
      const latest = this.store.job(initial.ownerId, initial.id);
      return latest?.status === "writing" && !controller.signal.aborted ? latest : undefined;
    };
    const shown: WritingProgress = { thinking: "", prompt: "" };
    let saved = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      pending = undefined;
      saved = Date.now();
      const latest = current();
      if (latest) this.store.save({ ...latest, progress: { ...shown } });
    };
    const stream = (key: keyof WritingProgress) => (piece: string) => {
      shown[key] += piece;
      pending ??= setTimeout(flush, Math.max(0, saved + progressMs - Date.now()));
    };
    const run = (async () => {
      try {
        if (!this.writer) throw new Error("The prompt assistant is not configured.");
        const written = await this.writer(initial, {
          signal: controller.signal,
          onThinking: stream("thinking"),
          onDelta: stream("prompt"),
        });
        clearTimeout(pending);
        const latest = current();
        if (!latest) return;
        this.store.save(writtenJob(latest, written));
      } catch (error) {
        clearTimeout(pending);
        const latest = current();
        if (!latest) return;
        const failed = this.store.save({
          ...latest,
          status: "failed",
          progress: undefined,
          reason: `Writing the prompt failed: ${(error as Error).message}`,
        });
        await this.adapter.settled?.(failed);
      } finally {
        this.writing.delete(initial.id);
        // The written job queues for its worker, and the freed slot starts the next write.
        void this.tick().catch(() => undefined);
      }
    })()
      .catch(() => undefined)
      .finally(() => this.runs.delete(run));
    this.runs.add(run);
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
    // The shared text model writes at most maxWrites prompts at once, higher tiers first, then FIFO;
    // the rest wait in their writing stage.
    const unwritten = this.store
      .jobs()
      .filter((job) => job.status === "writing" && !this.writing.has(job.id))
      .sort((a, b) => (a.priority ?? queuePriority.manual) - (b.priority ?? queuePriority.manual));
    for (const job of unwritten)
      if (this.writing.size < maxWrites) this.write(job);
      else if (job.reason !== writeWaitReason) this.store.save({ ...job, reason: writeWaitReason });
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
    const all = this.store.jobs();
    const isStarted = (job: OwnedJob) => this.acceptedIds.has(job.id) || started(job);
    // A started MCP set finishes before anything else on its resource, so its jobs stay contiguous.
    const startedSets = new Set(
      all.filter((job) => job.queueSet && isStarted(job)).map((job) => job.queueSet),
    );
    const rank = (job: OwnedJob) =>
      job.queueSet && startedSets.has(job.queueSet) ? -1 : (job.priority ?? queuePriority.manual);
    const groups = new Map<string, OwnedJob[]>();
    for (const job of all.filter(
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
    // Within a tier, jobs reusing the loaded model and LoRAs go first, unless an older job of that tier
    // has already been overtaken reuseBypassLimit times; then the tier runs strictly FIFO. Overtakes are
    // counted from the stored jobs (later jobs of the same resource and tier that started), so the bound
    // survives restarts. Started work is never pre-empted.
    const position = new Map(all.map((job, index) => [job.id, index]));
    const tier = (job: OwnedJob) => job.priority ?? queuePriority.manual;
    const overtaken = (job: OwnedJob) =>
      all
        .slice(position.get(job.id)! + 1)
        .filter((later) => later.resource === job.resource && tier(later) === tier(job))
        .filter(isStarted).length;
    for (const [resource, candidates] of groups) {
      const fifo = new Set(
        candidates.filter((job) => overtaken(job) >= reuseBypassLimit).map(rank),
      );
      const reuses = (job: OwnedJob) =>
        fifo.has(rank(job)) || loadKey(job) !== this.loaded.get(resource) ? 1 : 0;
      candidates.sort((a, b) => rank(a) - rank(b) || reuses(a) - reuses(b));
    }
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
            this.loaded.set(resource, loadKey(job));
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
      this.writing.get(job.id)?.abort();
      const cancelled = this.store.save({
        ...job,
        status: "cancelled" as const,
        reason:
          job.status === "writing"
            ? "Cancelled while writing the prompt."
            : "Cancelled before submission.",
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
