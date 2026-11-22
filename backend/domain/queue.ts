import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import type { ResultContext } from "../../shared/characters.ts";
import { dreamDefaults } from "../../shared/dream.ts";
import {
  type GenerationInput,
  type PromptWriting,
  type QueueMedia,
  type QueueStatus,
  pausedReason,
  pendingStatuses,
  terminalStatuses,
} from "../../shared/queue.ts";
import { logEvent, logWarning } from "../crash-log.js";
import { tracked } from "../event-loop.js";
import { logFailure } from "./log-failure.ts";
import { type OwnedJob, type QueuedCopy, Store, everyone, queuePriority } from "./store.ts";

export interface JobObservation {
  status: QueueStatus;
  /** A lost synchronous request whose worker has confirmed it is idle. */
  restartInterrupted?: { seed?: string };
  reason?: string;
  providerJobId?: string;
  backend?: string;
  progress?: Record<string, unknown>;
  items?: QueueMedia[];
  outputs?: QueueMedia[];
}

/** Why a job was cancelled without its worker's confirmation: the worker could not be running it. */
export const unreachableCancelReason =
  "Cancelled. Its worker wasn't reachable, so nothing was left running there.";

/**
 * A save failure meaning the outputs are gone from the provider for good (`saveOutputs` throws it):
 * the job fails after `goneSaveTries` of them rather than retrying forever.
 */
export const goneOutputs = (message: string) => Object.assign(new Error(message), { gone: true });
const goneSaveTries = 3;

/** A saved job completes unless saving failed it (an Extend that couldn't be joined onto its video). */
const savedStatus = (saved: JobObservation | void) =>
  saved?.status === "failed" ? ("failed" as const) : ("completed" as const);

export interface QueueAdapter {
  submit(job: OwnedJob): Promise<JobObservation>;
  observe(job: OwnedJob): Promise<JobObservation | undefined>;
  /** Asks the provider to stop the job; a returned `cancelled` means it cannot be running there. */
  cancel(job: OwnedJob): Promise<JobObservation | void>;
  saveOutputs(job: OwnedJob): Promise<JobObservation | void>;
  eligible?(job: OwnedJob): Promise<string | undefined>;
  dreamIdleWait?(job: OwnedJob): string | undefined;
  dreamImageSwitchMinutes?(ownerId: string): number;
  /** Releases readiness resources when work arrives while admission is in flight. */
  releaseAdmission?(job: OwnedJob): void;
  settled?(job: OwnedJob): Promise<void>;
  /** Other resources that could run this queued job now, best first (an idle worker takes it). */
  alternatives?(job: OwnedJob): string[];
  /** How many jobs a resource runs at once; one unless it says more (a worker's `slots`). */
  slots?(resource: string): number;
  /** Why a job must wait despite a free slot beside accepted work on its resource. */
  slotWait?(job: OwnedJob, running: OwnedJob[]): Promise<string | undefined>;
}

/** One adapter that hands each job to the adapter `pick` chooses for it. */
export function routeAdapters(pick: (job: OwnedJob) => QueueAdapter): QueueAdapter {
  return {
    submit: (job) => pick(job).submit(job),
    observe: (job) => pick(job).observe(job),
    cancel: (job) => pick(job).cancel(job),
    saveOutputs: (job) => pick(job).saveOutputs(job),
    eligible: (job) => pick(job).eligible?.(job) || Promise.resolve(undefined),
    settled: (job) => pick(job).settled?.(job) || Promise.resolve(),
  };
}

/** What the writing stage streams into the item's progress while the prompt is written. */
interface WritingProgress {
  thinking: string;
  prompt: string;
}
/**
 * The writing stage's outcome: the prompt with its thinking and model; `why` is Dream's note on it
 * and `title` the result's title, when the writer gave one (domain/titles.ts titles the rest).
 */
export interface WrittenPrompt {
  prompt: string;
  thinking: string;
  model: string;
  why?: string;
  title?: string;
  cardContext?: ResultContext;
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

const started = (job: OwnedJob) => !pendingStatuses.has(job.status) && job.status !== "cancelled";
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
        ...(written.title ? { title: written.title } : {}),
      },
    },
    ...(job.dream
      ? {
          dream: {
            ...job.dream,
            prompt: written.prompt,
            ...(written.why ? { why: written.why } : {}),
            ...(written.cardContext ? { cardContext: written.cardContext } : {}),
          },
        }
      : {}),
  };
}
/** The model a job's input loads on its resource; empty when it names none. */
export const modelOf = (input: GenerationInput) => String(input.profileId || input.model || "");

/**
 * A resource's load: whether its slots are all taken (`current`, the last started job's id), how
 * many jobs wait for it and the model it last ran.
 */
interface ResourceLoad {
  busy: boolean;
  current?: string;
  queued: number;
  model: string;
}
/** What a job loads on its resource: the model and its enabled LoRAs at their strengths. */
const loadKey = (job: OwnedJob) =>
  JSON.stringify([
    modelOf(job.input),
    (Array.isArray(job.input.loras) ? job.input.loras : [])
      .filter((lora) => lora && lora.enabled !== false)
      .map((lora) => `${lora.name}@${lora.strength ?? ""}`)
      .sort(),
  ]);
/**
 * What a job would load beside what `warm` jobs hold: 0 when one has its model and LoRAs, 1 its
 * model alone (a LoRA change, not a model load), 2 neither.
 */
const loadCost = (job: OwnedJob, warm: OwnedJob[]) => {
  if (warm.some((other) => loadKey(other) === loadKey(job))) return 0;
  const model = modelOf(job.input);
  return model && warm.some((other) => modelOf(other.input) === model) ? 1 : 2;
};
const reuseBypassLimit = 3;
const tier = (job: OwnedJob) => job.priority ?? queuePriority.manual;
const mediaRank = (job: OwnedJob) => tier(job) + (job.input.kind === "video" ? 0.5 : 0);
/** A local video job: on a worker, not a cloud provider. */
const localVideo = (job: OwnedJob) =>
  job.resource.startsWith("worker:") && job.input.kind === "video";
const videoWaitReason = "Waiting for another video to finish.";
const videoModelReason = "Waiting for the running video to finish before loading another model.";
const dreamVideoModelIdleMinutes = 2;
/** How long a worker's run may show no progress before it is given up: a video's steps take longer. */
const stallMinutes = (job: OwnedJob) => (job.input.kind === "video" ? 30 : 10);

/** Only this database's recorded IDs reach the provider adapter. Recoverable work keeps its run. */
export class GenerationQueue {
  private observing = new Set<string>();
  private scheduling = new Set<string>();
  private checkingEligibility = new Set<string>();
  /**
   * Jobs whose submission is in flight. They are not observed until it returns: the provider has
   * no record of them yet, and recovering one then would stand in for the run it is starting.
   */
  private submitting = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private acceptedIds = new Set<string>();
  /** Saves of each job that found its outputs gone. */
  private goneSaves = new Map<string, number>();
  /**
   * The job last started or finished on each resource: what its worker has loaded. Forgotten when
   * the worker stops, restarts or goes offline (`unload`).
   */
  private loaded = new Map<string, OwnedJob>();
  private modelIdleSince?: number;
  /** Jobs whose prompt is being written, to abort on cancel or stop. */
  private writing = new Map<string, AbortController>();
  private positions = new Map<string, number>();
  /** Each running job's last progress and when it changed, to find a stalled run. */
  private progressSeen = new Map<string, { key: string; at: number }>();
  /** The clock stalls are measured by (tests move it). */
  now = () => Date.now();
  private stopped = false;
  private readonly tickFailed = logFailure("The queue");
  readonly store: Store;
  readonly adapter: QueueAdapter;
  readonly writer?: PromptWriter;

  constructor(store: Store, adapter: QueueAdapter, writer?: PromptWriter) {
    this.store = store;
    this.adapter = adapter;
    this.writer = writer;
    for (const job of store.openJobs()) {
      if (started(job) || job.providerJobId) this.acceptedIds.add(job.id);
    }
    this.loaded = new Map(store.loadedJobs().map((job) => [job.resource, job]));
  }

  /** Each resource's load, for routing new work (comfy/backends.js routeJob). */
  loads(): Map<string, ResourceLoad> {
    const loads = new Map<string, ResourceLoad>();
    const at = (resource: string) => {
      if (!loads.has(resource))
        loads.set(resource, {
          busy: this.scheduling.has(resource),
          queued: 0,
          model: modelOf(this.loaded.get(resource)?.input ?? {}),
        });
      return loads.get(resource)!;
    };
    for (const resource of this.loaded.keys()) at(resource);
    const running = new Map<string, number>();
    for (const job of this.store.openJobs()) {
      // A started job a restart recovered isn't accepted in this process yet, but still runs.
      if (this.acceptedIds.has(job.id) || started(job)) {
        running.set(job.resource, (running.get(job.resource) ?? 0) + 1);
        if (running.get(job.resource)! >= this.slots(job.resource))
          Object.assign(at(job.resource), { busy: true, current: job.id });
        else at(job.resource);
      } else at(job.resource).queued += 1;
    }
    return loads;
  }

  private slots(resource: string) {
    return this.adapter.slots?.(resource) ?? 1;
  }

  /** Forgets what a resource has loaded: its worker stopped, restarted or went offline. */
  unload(resource: string) {
    this.loaded.delete(resource);
  }

  private updateModelIdle(jobs: Iterable<OwnedJob>) {
    for (const job of jobs) {
      if (terminalStatuses.has(job.status)) continue;
      // Dream jobs waiting for this quiet period cannot themselves keep the queue busy.
      if (tier(job) !== queuePriority.dream || this.acceptedIds.has(job.id) || started(job)) {
        this.modelIdleSince = undefined;
        return;
      }
    }
    this.modelIdleSince ??= this.now();
  }

  dreamModelWait(job: OwnedJob) {
    if (tier(job) !== queuePriority.dream || !job.resource.startsWith("worker:")) return;
    const model = modelOf(job.input);
    if (!model) return;
    const video = localVideo(job);
    const loaded = this.loaded.get(job.resource);
    if (
      loaded &&
      loaded.input.profileBackend === job.input.profileBackend &&
      (video ? modelOf(loaded.input) === model : loadKey(loaded) === loadKey(job))
    )
      return;
    const minutes = video
      ? dreamVideoModelIdleMinutes
      : (this.adapter.dreamImageSwitchMinutes?.(job.ownerId) ?? dreamDefaults.imageSwitchMinutes);
    if (!minutes) return;
    this.updateModelIdle(this.store.openJobs());
    if (this.modelIdleSince === undefined || this.now() - this.modelIdleSince < minutes * 60_000)
      return `Dream waits for the queue to be idle for ${minutes} ${minutes === 1 ? "minute" : "minutes"} before ${video ? "loading another model" : "changing the model or LoRAs"}.`;
  }

  isWriting(id: string) {
    return this.writing.has(id);
  }

  queuePosition(id: string) {
    return this.positions.get(id);
  }

  start() {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(() => void tracked("Queue", () => this.tick()), 1000);
      this.timer.unref();
      void this.tick();
    }
  }

  /**
   * Starts nothing more. Runs in flight aren't awaited: a started generation carries on in its
   * worker and job recovery saves it after a restart, and an interrupted prompt stays in its
   * writing stage and is written afresh.
   */
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.writing.values()) controller.abort();
  }

  async waitForSubmissions(deadline: number) {
    while (this.submitting.size && Date.now() < deadline) await delay(25);
    // Provider submission schedules the accepted run before returning to the queue.
    await delay(0);
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
    void (async () => {
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
        void this.tick();
      }
    })().catch(() => undefined);
  }

  /** One scheduling pass; a failure is logged, never thrown, so callers can start one freely. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.run().catch(this.tickFailed);
  }

  /**
   * Whether a paused queue holds the job: its owner's, or everyone's. Held work keeps its place,
   * waiting as Paused, and nothing of it starts; started work runs on.
   */
  private held() {
    const pauses = this.store.pauses();
    return (job: OwnedJob) => pauses.has(everyone) || pauses.has(job.ownerId);
  }

  private async run() {
    const held = this.held();
    const dreamDelay = (job: OwnedJob) =>
      job.priority === queuePriority.dream ? this.adapter.dreamIdleWait?.(job) : undefined;
    // Read once until the observations below are awaited; this tick's saves update the list.
    const jobs = new Map(this.store.openJobs().map((job) => [job.id, job]));
    this.updateModelIdle(jobs.values());
    const save = (job: OwnedJob) => {
      const saved = this.store.save(job);
      jobs.set(saved.id, saved);
      return saved;
    };
    const wait = (job: OwnedJob, reason: string) => {
      if (job.status !== "waiting" || job.reason !== reason)
        save({ ...job, status: "waiting", reason });
    };
    const saveObservation = (latest: OwnedJob, observation: Partial<OwnedJob>) => {
      const changed = Object.entries(observation).some(
        ([key, value]) => !isDeepStrictEqual(latest[key as keyof OwnedJob], value),
      );
      return changed ? this.store.save({ ...latest, ...observation }) : latest;
    };
    for (const job of jobs.values()) {
      if (!pendingStatuses.has(job.status) || this.acceptedIds.has(job.id)) continue;
      // A prompt already being written finishes; its job then waits as Paused.
      if (held(job) && job.reason !== pausedReason && !this.writing.has(job.id))
        save({
          ...job,
          status: job.status === "waiting" ? "queued" : job.status,
          reason: pausedReason,
        });
      else if (!held(job) && job.reason === pausedReason) save({ ...job, reason: "" });
    }
    // The shared text model writes at most maxWrites prompts at once, in priority and media order.
    const unwritten = [...jobs.values()]
      .filter((job) => job.status === "writing" && !this.writing.has(job.id) && !held(job))
      .sort((a, b) => mediaRank(a) - mediaRank(b));
    for (const job of unwritten) {
      const delay = dreamDelay(job);
      if (!delay && this.writing.size < maxWrites) this.write(job);
      else {
        const reason = delay || writeWaitReason;
        if (job.reason !== reason) save({ ...job, reason });
      }
    }
    await Promise.all(
      [...jobs.values()]
        .filter(
          (item) =>
            !terminalStatuses.has(item.status) &&
            this.acceptedIds.has(item.id) &&
            !this.observing.has(item.id) &&
            !this.submitting.has(item.id),
        )
        .map(async (initial) => {
          this.observing.add(initial.id);
          let job = initial;
          try {
            const observed = await this.adapter.observe(job);
            if (!observed) {
              const latest = this.store.job(job.ownerId, job.id)!;
              if (!terminalStatuses.has(latest.status))
                saveObservation(latest, {
                  reason: "Recovering the recorded generation; it will not be submitted again.",
                });
              return;
            }
            const latest = this.store.job(job.ownerId, job.id)!;
            if (terminalStatuses.has(latest.status)) return;
            if (observed.restartInterrupted) {
              if (latest.cancelRequested || latest.retried) {
                const stopped = this.store.save({
                  ...latest,
                  status: latest.cancelRequested ? "cancelled" : "failed",
                  reason: latest.cancelRequested
                    ? "Cancelled."
                    : observed.reason || "Interrupted by restart.",
                  progress: undefined,
                });
                await this.adapter.settled?.(stopped);
              } else {
                const { seed } = observed.restartInterrupted;
                const retry = this.store.save({
                  ...latest,
                  status: "queued",
                  reason: "Resuming after Studio restarted.",
                  retried: true,
                  providerJobId: undefined,
                  admittedAt: undefined,
                  progress: undefined,
                  ...(seed !== undefined && { input: { ...latest.input, seed } }),
                });
                this.acceptedIds.delete(retry.id);
                this.progressSeen.delete(retry.id);
                this.adapter.releaseAdmission?.(retry);
                logEvent("Requeued an image interrupted by Studio restart", { job: retry.id });
              }
              return;
            }
            const observation = { ...observed, reason: observed.reason || "" };
            job = { ...latest, ...observation };
            if (observed.status === "completed") {
              job = this.store.save(this.saving(job));
              let saved;
              try {
                saved = await this.adapter.saveOutputs(job);
              } catch (error) {
                await this.saveFailed(job, error as Error & { gone?: boolean });
                return;
              }
              this.goneSaves.delete(job.id);
              // A cancellation that raced saving cannot discard already saved results.
              const completed = this.store.save({ ...job, ...saved, status: savedStatus(saved) });
              this.loaded.set(completed.resource, completed);
              await this.adapter.settled?.(completed);
            } else {
              job = saveObservation(latest, observation);
              if (terminalStatuses.has(job.status)) {
                this.progressSeen.delete(job.id);
                await this.adapter.settled?.(job);
              } else if (this.stalled(job)) await this.giveUpStalled(job);
            }
          } catch (error) {
            const latest = this.store.job(job.ownerId, job.id)!;
            if (terminalStatuses.has(latest.status)) return;
            saveObservation(latest, {
              reason: `Waiting for the recorded generation: ${(error as Error).message}`,
            });
          } finally {
            this.observing.delete(initial.id);
          }
        }),
    );
    if (this.stopped) return;
    // Read again: jobs were added, observed or cancelled while the observations were awaited.
    const all = this.store.schedulable(reuseBypassLimit);
    this.updateModelIdle(all);
    const running = new Map<string, OwnedJob[]>();
    for (const job of all)
      if (!terminalStatuses.has(job.status) && this.acceptedIds.has(job.id))
        running.set(job.resource, [...(running.get(job.resource) ?? []), job]);
    const free = (resource: string) => this.slots(resource) - (running.get(resource)?.length ?? 0);
    // Resources whose every slot runs a job; the rest take work.
    const occupied = new Set([...running.keys()].filter((resource) => free(resource) <= 0));
    const isStarted = (job: OwnedJob) =>
      this.acceptedIds.has(job.id) || Boolean(job.providerJobId) || started(job);
    // A started set goes ahead of other waiting jobs of the same priority and media kind.
    const startedSets = new Set(
      all.filter((job) => job.queueSet && isStarted(job)).map((job) => job.queueSet),
    );
    const rank = (job: OwnedJob) =>
      mediaRank(job) - (job.queueSet && startedSets.has(job.queueSet) ? 0.25 : 0);
    this.rebalance(all, occupied, rank, held);
    const waitingNow = (item: OwnedJob) =>
      ["queued", "waiting"].includes(item.status) && !this.acceptedIds.has(item.id) && !held(item);
    // Dream starts only while no one's own work waits, on any worker: a free worker otherwise
    // keeps for the work routed to another.
    const ownWaiting = all.some((item) => waitingNow(item) && tier(item) < queuePriority.dream);
    const waiting = new Map<string, OwnedJob[]>();
    const heldBack = new Map<string, OwnedJob[]>();
    const writers: OwnedJob[] = [];
    for (const job of all) {
      if (!pendingStatuses.has(job.status) || isStarted(job)) continue;
      if (job.status === "writing") {
        if (!this.isWriting(job.id)) writers.push(job);
      } else {
        const ready = waitingNow(job);
        const dreamWaits = ownWaiting && job.priority === queuePriority.dream;
        if (ready && dreamWaits) wait(job, "Waiting for user work to start.");
        const group = ready && !dreamWaits ? waiting : heldBack;
        const jobs = group.get(job.resource) ?? [];
        jobs.push(job);
        group.set(job.resource, jobs);
      }
    }
    this.positions.clear();
    const showOrder = (jobs: OwnedJob[]) =>
      jobs.forEach((job, index) => this.positions.set(job.id, index + 1));
    showOrder(
      writers.sort((a, b) => Number(held(a)) - Number(held(b)) || mediaRank(a) - mediaRank(b)),
    );
    for (const [resource, jobs] of heldBack)
      if (!waiting.has(resource)) showOrder(jobs.sort((a, b) => rank(a) - rank(b)));
    if (!waiting.size) return;
    // Higher tiers go first, with photos ahead of videos within each tier.
    // At the same rank, jobs reusing what the resource holds go first: the model and LoRAs of a job
    // running there or the last one it ran, then its model alone. A resource with several slots
    // reorders after each start, so its slots share a model rather than load another beside it.
    // Once an older job of a tier has been overtaken reuseBypassLimit times, its rank runs strictly
    // FIFO. Overtakes are counted from the stored jobs (later jobs of the same resource and tier that
    // started), so the bound survives restarts. Started work is never pre-empted.
    const laterStarts = new Map<string, number>();
    const overtaken = new Set<string>();
    for (let index = all.length - 1; index >= 0; index--) {
      const job = all[index];
      if (!waiting.has(job.resource)) continue;
      const key = JSON.stringify([job.resource, tier(job)]);
      const count = laterStarts.get(key) ?? 0;
      if (isStarted(job)) laterStarts.set(key, count + 1);
      else if (count >= reuseBypassLimit) overtaken.add(job.id);
    }
    const order = (resource: string, jobs: OwnedJob[], fifo: Set<number>) => {
      const loaded = this.loaded.get(resource);
      const warm = [...(running.get(resource) ?? []), ...(loaded ? [loaded] : [])];
      const cost = (job: OwnedJob) => (fifo.has(rank(job)) ? 0 : loadCost(job, warm));
      return jobs.sort((a, b) => rank(a) - rank(b) || cost(a) - cost(b));
    };
    await Promise.all(
      [...waiting].map(async ([resource, candidates]) => {
        const fifo = new Set(candidates.filter((job) => overtaken.has(job.id)).map(rank));
        const next = order(resource, [...candidates], fifo);
        const deferred = (heldBack.get(resource) ?? []).sort((a, b) => rank(a) - rank(b));
        const skipped: OwnedJob[] = [];
        const showRemaining = () => showOrder([...next, ...skipped, ...deferred]);
        showRemaining();
        if (occupied.has(resource)) {
          for (const job of candidates)
            wait(job, "Waiting for earlier work to finish and save its outputs.");
          return;
        }
        if (this.scheduling.has(resource)) return;
        // Resource groups run independently. A slow cloud request or offline worker cannot hold the scheduler.
        this.scheduling.add(resource);
        let room = free(resource);
        try {
          while (!this.stopped && next.length) {
            let job = next.shift()!;
            // While a local video runs, a worker's other slots take only work for its model.
            const videos = (running.get(resource) ?? []).filter(localVideo);
            if (
              videos.length &&
              !videos.some((video) => modelOf(video.input) === modelOf(job.input))
            ) {
              wait(job, videoModelReason);
              skipped.push(job);
              continue;
            }
            const delay = dreamDelay(job) || this.dreamModelWait(job);
            if (delay) {
              wait(job, delay);
              skipped.push(job);
              continue;
            }
            const active = running.get(resource);
            if (active?.length && this.adapter.slotWait) {
              const reason = await this.adapter.slotWait(job, active);
              if (this.stopped) return;
              if (reason) {
                const latest = this.store.job(job.ownerId, job.id);
                if (latest && waitingNow(latest)) wait(latest, reason);
                break;
              }
              const latest = this.store.job(job.ownerId, job.id);
              if (!latest || !waitingNow(latest) || this.held()(latest)) continue;
              job = latest;
            }
            let reason: string | undefined;
            this.checkingEligibility.add(job.id);
            try {
              reason = await this.adapter.eligible?.(job);
            } catch (error) {
              reason = (error as Error).message;
            } finally {
              this.checkingEligibility.delete(job.id);
            }
            if (this.stopped) return;
            job = this.store.job(job.ownerId, job.id)!;
            if (job.status === "cancelled") {
              this.positions.delete(job.id);
              await this.adapter.settled?.(job);
              continue;
            }
            // Paused while its eligibility was checked: the next tick marks it Paused.
            if (this.held()(job)) {
              skipped.push(job);
              continue;
            }
            // One local video runs at a time across workers: two at once on one-GPU workers sharing a
            // node run it out of system memory. A two-GPU worker holds the node alone, so it never
            // meets this. Synchronous from here to "starting", so two workers' passes can't both start.
            // A user can submit during an asynchronous readiness check.
            const delayed = dreamDelay(job) || this.dreamModelWait(job);
            if (delayed) this.adapter.releaseAdmission?.(job);
            reason ||= delayed;
            if (!reason && localVideo(job) && this.videoRunning(job.id)) reason = videoWaitReason;
            if (reason) {
              wait(job, reason);
              skipped.push(job);
              continue;
            }
            job = this.store.save({
              ...job,
              status: "starting",
              reason: "",
              admittedAt: this.now(),
            });
            // Persist starting before crossing the provider boundary so recovery can check it.
            this.positions.delete(job.id);
            this.acceptedIds.add(job.id);
            this.modelIdleSince = undefined;
            this.loaded.set(resource, job);
            this.submitting.add(job.id);
            try {
              const observation = await this.adapter.submit(job);
              const latest = this.store.job(job.ownerId, job.id)!;
              if (terminalStatuses.has(latest.status)) continue;
              const observed = { ...latest, ...observation };
              let submitted = this.store.save(
                observation.status === "completed" ? this.saving(observed) : observed,
              );
              if (observation.status === "completed") {
                const saved = await this.adapter.saveOutputs(submitted);
                submitted = this.store.save({ ...submitted, ...saved, status: savedStatus(saved) });
              }
              if (latest.cancelRequested && !terminalStatuses.has(observation.status))
                await this.adapter.cancel(submitted);
              if (terminalStatuses.has(observation.status)) {
                await this.adapter.settled?.(submitted);
                continue;
              }
            } catch (error) {
              const latest = this.store.job(job.ownerId, job.id)!;
              if (terminalStatuses.has(latest.status)) continue;
              this.store.save({
                ...latest,
                reason: `Submission outcome is unknown; checking before any retry: ${(error as Error).message}`,
              });
            } finally {
              this.submitting.delete(job.id);
            }
            // A resource with another free slot starts its next candidate in this pass.
            if (--room > 0) {
              running.set(resource, [...(running.get(resource) ?? []), job]);
              order(resource, next, fifo);
              showRemaining();
              continue;
            }
            for (const pending of candidates) {
              const latest = this.store.job(pending.ownerId, pending.id)!;
              if (["queued", "waiting"].includes(latest.status) && !this.acceptedIds.has(latest.id))
                wait(latest, "Waiting for earlier work to finish and save its outputs.");
            }
            break;
          }
        } finally {
          this.scheduling.delete(resource);
        }
      }),
    );
  }

  /**
   * Whether a worker's running generation has shown no new progress for its stallMinutes, while
   * the worker still lists it (a hung run keeps its worker from all other work).
   */
  private stalled(job: OwnedJob) {
    if (!job.resource.startsWith("worker:") || job.operation === "upscale") return false;
    if (job.status !== "running" || job.cancelRequested) return false;
    const { value, max, node, phase } = (job.progress ?? {}) as Record<string, unknown>;
    const key = JSON.stringify([value, max, node, phase]);
    const seen = this.progressSeen.get(job.id);
    if (seen?.key !== key) {
      this.progressSeen.set(job.id, { key, at: this.now() });
      return false;
    }
    return this.now() - seen.at >= stallMinutes(job) * 60_000;
  }

  /**
   * Interrupts a stalled run on its worker and fails it with why, then queues it once more on
   * another worker, a free one first; its tier, set and Dream origin go with it.
   */
  private async giveUpStalled(job: OwnedJob) {
    const minutes = stallMinutes(job);
    logWarning("Run stalled", { job: job.id, worker: job.resource, minutes });
    this.progressSeen.delete(job.id);
    await Promise.resolve(this.adapter.cancel(job)).catch(() => undefined);
    const failed = this.store.save({
      ...this.store.job(job.ownerId, job.id)!,
      status: "failed",
      progress: undefined,
      reason: `Stopped: no progress for ${minutes} min.`,
    });
    await this.adapter.settled?.(failed);
    if (job.retried) return;
    const busy = new Set(
      this.store
        .openJobs()
        .filter((other) => this.acceptedIds.has(other.id))
        .map((other) => other.resource),
    );
    const others = (this.adapter.alternatives?.(job) ?? []).filter(
      (resource) => resource !== job.resource,
    );
    const target = others.find((resource) => !busy.has(resource)) ?? others[0];
    if (!target) return;
    const retry = this.again(failed, target);
    if (retry)
      logEvent("Retry for stalled job", {
        job: job.id,
        replacement: retry.id,
        worker: retry.resource,
      });
  }

  /**
   * Queues a failed job once more on its own or another resource, keeping its tier, set and Dream
   * origin; a job queued again this way only fails the next time.
   */
  again(job: OwnedJob, resource = job.resource): OwnedJob | undefined {
    if (job.retried) return;
    return this.requeue(job, { id: job.id, automatic: true }, resource);
  }

  /** Whether another local video job has started and not yet finished and saved. */
  private videoRunning(id: string) {
    return this.store
      .openJobs()
      .some(
        (job) =>
          job.id !== id &&
          !terminalStatuses.has(job.status) &&
          this.acceptedIds.has(job.id) &&
          localVideo(job),
      );
  }

  /**
   * A job waiting behind another job on a busy worker moves to an idle one that can run it, one per
   * idle worker, higher tiers first; an idle worker with the job's model loaded goes first, then the
   * first idle worker for manual work and the last for background work. Model affinity only orders
   * idle workers: it never keeps work waiting while one that can run it is idle. A job on an idle
   * worker without its model moves only to an idle worker that has it, and a job never moves behind
   * work of its rank or higher, which that worker starts first. Updates `all` in place.
   */
  private rebalance(
    all: OwnedJob[],
    occupied: Set<string>,
    rank: (job: OwnedJob) => number,
    held: (job: OwnedJob) => boolean,
  ) {
    if (!this.adapter.alternatives) return;
    const pending = (job: OwnedJob) =>
      ["queued", "waiting"].includes(job.status) && !this.acceptedIds.has(job.id) && !held(job);
    // An unknown model never matches, so without model information nothing moves for affinity.
    const hasModel = (resource: string, job: OwnedJob) => {
      const loaded = this.loaded.get(resource);
      return (
        Boolean(modelOf(job.input)) &&
        loaded !== undefined &&
        modelOf(loaded.input) === modelOf(job.input)
      );
    };
    const taken = new Set<string>();
    const batches = new Map<string, OwnedJob[]>();
    for (const job of all)
      if (job.queueBatch)
        batches.set(job.queueBatch, [...(batches.get(job.queueBatch) || []), job]);
    // A job whose own worker can't take it now (not reachable, or stopped) moves as from a busy one.
    const stranded = (job: OwnedJob) => {
      if (!job.resource.startsWith("worker:")) return false;
      const ready = this.adapter.alternatives!(job);
      return ready.length > 0 && !ready.includes(job.resource);
    };
    const movable = all
      .map((job, index) => ({ job, index }))
      .filter(
        ({ job }) =>
          pending(job) &&
          (occupied.has(job.resource) ||
            stranded(job) ||
            (modelOf(job.input) && !hasModel(job.resource, job))) &&
          !this.scheduling.has(job.resource),
      )
      .sort((a, b) => mediaRank(a.job) - mediaRank(b.job));
    for (const { job } of movable) {
      const batch = job.queueBatch ? batches.get(job.queueBatch)! : [job];
      const members = batch.filter(pending);
      // One prompt's split Count moves its waiting jobs as a unit. Once part of it starts, the rest
      // keep that worker unless it can't take them.
      if (
        job.queueBatch &&
        (job.id !== members[0].id || (members.length < batch.length && !stranded(job)))
      )
        continue;
      const targets = this.adapter
        .alternatives(job)
        .filter(
          (resource) =>
            resource !== job.resource &&
            !taken.has(resource) &&
            !occupied.has(resource) &&
            !this.scheduling.has(resource) &&
            !all.some(
              (other) => other.resource === resource && pending(other) && rank(other) <= rank(job),
            ),
        );
      const target =
        targets.find((resource) => hasModel(resource, job)) ??
        (!occupied.has(job.resource) && !stranded(job)
          ? undefined
          : tier(job) === queuePriority.manual
            ? targets[0]
            : targets.at(-1));
      if (!target) continue;
      taken.add(target);
      logEvent(`Moved job ${job.id} from ${job.resource} to ${target}`);
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        const moved = members.map((member) =>
          this.store.save({
            ...member,
            resource: target,
            backend: target.startsWith("worker:") ? target.slice("worker:".length) : member.backend,
            reason: "",
          }),
        );
        this.store.db.exec("COMMIT");
        for (const member of moved) all[all.findIndex((item) => item.id === member.id)] = member;
      } catch (error) {
        this.store.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private saving(job: OwnedJob): OwnedJob {
    return { ...job, status: "saving", savingAt: job.savingAt ?? this.now() };
  }

  /**
   * A failed save keeps the job saving, to try again, unless its outputs are gone for good: then it
   * fails with the reason. Stop leaves accepted work to finish saving (AGENTS.md).
   */
  private async saveFailed(job: OwnedJob, error: Error & { gone?: boolean }) {
    const latest = this.store.job(job.ownerId, job.id)!;
    const tries = error.gone ? (this.goneSaves.get(job.id) ?? 0) + 1 : 0;
    if (tries < goneSaveTries) {
      if (tries) this.goneSaves.set(job.id, tries);
      else this.goneSaves.delete(job.id);
      this.store.save({
        ...latest,
        reason: `Waiting for the recorded generation: ${error.message}`,
      });
      return;
    }
    this.goneSaves.delete(job.id);
    const ended = this.store.save({
      ...latest,
      status: "failed",
      progress: undefined,
      reason: error.message,
    });
    await this.adapter.settled?.(ended);
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
    let outcome;
    try {
      outcome = await this.adapter.cancel(pending);
    } catch (error) {
      // The request stays recorded; recovery confirms the cancellation once the worker answers.
      logWarning(`Could not confirm cancelling job ${id}: ${(error as Error).message}`);
      throw error;
    }
    const latest = this.store.job(ownerId, id)!;
    if (outcome?.status !== "cancelled" || terminalStatuses.has(latest.status)) return latest;
    logWarning(`Cancelled job ${id} without its worker: ${outcome.reason}`);
    const cancelled = this.store.save({
      ...latest,
      status: "cancelled",
      progress: undefined,
      reason: outcome.reason || unreachableCancelReason,
    });
    await this.adapter.settled?.(cancelled);
    return cancelled;
  }

  /**
   * Settings › Maintenance: ends an unfinished job for good. It is cancelled as usual; one whose
   * provider never confirms (a lost worker, a recording nothing can recover) is marked cancelled
   * anyway, so it stops holding its place.
   */
  async abandon(ownerId: string, id: string): Promise<OwnedJob | undefined> {
    const job = await this.cancel(ownerId, id).catch(() => this.store.job(ownerId, id));
    if (!job || terminalStatuses.has(job.status)) return job;
    const abandoned = this.store.save({
      ...job,
      status: "cancelled",
      progress: undefined,
      reason: "Ended by an administrator.",
    });
    await this.adapter.settled?.(abandoned);
    return abandoned;
  }

  /**
   * Ends accepted work its worker can no longer be running, as after Settings › Workers' Restart:
   * cancelled where cancellation was asked, otherwise failed so it can be retried.
   */
  async end(ownerId: string, id: string, reason: string): Promise<OwnedJob | undefined> {
    const job = this.store.job(ownerId, id);
    if (!job || terminalStatuses.has(job.status)) return job;
    this.progressSeen.delete(id);
    const ended = this.store.save({
      ...job,
      status: job.cancelRequested ? "cancelled" : "failed",
      progress: undefined,
      reason: job.cancelRequested ? "Cancelled." : reason,
    });
    await this.adapter.settled?.(ended);
    return ended;
  }

  retry(ownerId: string, id: string, clear = false): OwnedJob | undefined {
    const job = this.store.job(ownerId, id);
    if (!job || job.status !== "failed") return;
    return this.requeue(job, { id: job.id, clear });
  }

  /** Queues the job's input again as a new job, in the job's set and its place in the gallery. */
  requeue(job: OwnedJob, replaces?: QueuedCopy["replaces"], resource = job.resource): OwnedJob {
    const listed = job.items.find((item) => typeof item.createdAt === "string")?.createdAt as
      | string
      | undefined;
    return this.store.enqueue(
      job.ownerId,
      job.sessionId,
      job.input,
      job.operation,
      job.parentJobId,
      resource,
      undefined,
      {
        parentItemId: job.parentItemId,
        queueSet: job.queueSet,
        galleryAt: job.galleryAt || listed || job.createdAt,
        ...(replaces
          ? {
              priority: job.priority,
              queueBatch: job.queueBatch,
              dream: job.dream,
              faceRedo: job.faceRedo,
            }
          : {}),
      },
      replaces,
    );
  }
}
