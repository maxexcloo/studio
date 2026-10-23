import type { QueueMedia } from "../../shared/queue.ts";
import type { JobObservation, QueueAdapter } from "./queue.ts";
import { RewriteStore, type OwnedJob } from "./store.ts";

type RecordValue = Record<string, any>;
interface UpscaleOptions {
  store: RewriteStore;
  jobs: Map<string, RecordValue>;
  itemFor(ownerId: string, itemId: string): RecordValue | undefined;
  execute(
    job: OwnedJob,
    callbacks: { onSubmitting(): void; onAccepted(promptId: string): void },
  ): Promise<void>;
  cancelPrompt(promptId: string, backend?: string): Promise<unknown>;
  flushGallery(): Promise<unknown>;
  eligible?: QueueAdapter["eligible"];
  settled?: QueueAdapter["settled"];
}

/** Upscale shares durable admission and worker leases with generation, including restart and saving. */
export function createUpscaleQueueAdapter(options: UpscaleOptions): QueueAdapter {
  const running = new Set<string>();
  const ownItem = (job: OwnedJob) => options.itemFor(job.ownerId, String(job.input.galleryItemId));
  const liveJob = (job: OwnedJob) => {
    const live = options.jobs.get(job.id);
    return live && (live.ownerId || "") === job.ownerId ? live : undefined;
  };
  function observation(job: OwnedJob): JobObservation | undefined {
    const item = ownItem(job);
    const upscale = item?.upscale;
    const live = liveJob(job);
    if (upscale?.jobId === job.id && upscale.status === "done" && upscale.url) {
      const output: QueueMedia = {
        jobId: job.id,
        index: 0,
        type: item!.type,
        status: "done",
        url: upscale.url,
        thumbnailUrl: upscale.thumbnailUrl,
        width: upscale.width,
        height: upscale.height,
      };
      return {
        status: "completed",
        items: [output],
        outputs: [output],
        providerJobId: job.providerJobId,
      };
    }
    if (live?.status === "error") return { status: "failed", reason: live.error };
    if (live?.status === "canceled" && !running.has(job.id))
      return { status: "cancelled", reason: "Upscale cancelled." };
    return live
      ? {
          status: "running",
          providerJobId: live.promptId || job.providerJobId,
          reason: job.cancelRequested
            ? "Cancelling the recorded upscale; waiting for the worker to confirm it has stopped."
            : live.error || "",
          progress: upscale?.progress || undefined,
        }
      : undefined;
  }
  function launch(job: OwnedJob) {
    if (running.has(job.id)) return;
    running.add(job.id);
    options.jobs.set(job.id, {
      status: job.cancelRequested ? "canceling" : "running",
      kind: "upscale",
      ownerId: job.ownerId || undefined,
      galleryItemId: job.input.galleryItemId,
      comfyBackend: job.backend,
      promptId: job.providerJobId,
      outputs: [],
    });
    void options
      .execute(job, {
        onSubmitting() {
          options.store.saveProviderRecord(job.ownerId, job.id, { submitting: true });
        },
        onAccepted(promptId) {
          const latest = options.store.job(job.ownerId, job.id)!;
          options.store.save({ ...latest, providerJobId: promptId });
          if (latest.cancelRequested)
            options.jobs.set(job.id, { ...liveJob(job), status: "canceling", promptId });
        },
      })
      .catch(
        (
          error: Error & {
            droppedRun?: boolean;
            providerFailed?: boolean;
            providerRejected?: boolean;
          },
        ) => {
          const latest = options.store.job(job.ownerId, job.id)!;
          const boundary = options.store.providerRecord<{ submitting: boolean }>(
            job.ownerId,
            job.id,
          );
          const uncertain =
            !error.droppedRun &&
            !error.providerFailed &&
            !error.providerRejected &&
            (Boolean(latest.providerJobId) || boundary?.submitting);
          options.jobs.set(job.id, {
            ...liveJob(job),
            status: uncertain
              ? latest.cancelRequested
                ? "canceling"
                : "running"
              : latest.cancelRequested && error.droppedRun
                ? "canceled"
                : "error",
            error: error.message,
          });
          if (uncertain)
            options.store.save({
              ...latest,
              reason: `Checking the recorded upscale: ${error.message}`,
            });
        },
      )
      .finally(() => running.delete(job.id));
  }
  return {
    eligible: options.eligible,
    settled: options.settled,
    async submit(job) {
      if (!ownItem(job))
        return { status: "failed", reason: "The source image is no longer in your gallery." };
      launch(job);
      return { status: "running" };
    },
    async observe(job) {
      const observed = observation(job);
      if (
        observed?.status === "completed" ||
        observed?.status === "failed" ||
        observed?.status === "cancelled"
      )
        return observed;
      // Restore only this queue's acknowledged prompt. An interrupted POST without an ID is never repeated.
      if (job.providerJobId && !running.has(job.id)) launch(job);
      return observation(job);
    },
    async cancel(job) {
      if (job.providerJobId) {
        const live = liveJob(job);
        if (live) options.jobs.set(job.id, { ...live, status: "canceling" });
        await options.cancelPrompt(job.providerJobId, job.backend);
        if (!running.has(job.id)) launch({ ...job, cancelRequested: true });
      }
      // Without an acknowledgement, cancellation cannot safely release the worker lease.
    },
    async saveOutputs() {
      await options.flushGallery();
    },
  };
}

export function withUpscaleAdapter(generation: QueueAdapter, upscale: QueueAdapter): QueueAdapter {
  const forJob = (job: OwnedJob) => (job.operation === "upscale" ? upscale : generation);
  return {
    submit: (job) => forJob(job).submit(job),
    observe: (job) => forJob(job).observe(job),
    cancel: (job) => forJob(job).cancel(job),
    saveOutputs: (job) => forJob(job).saveOutputs(job),
    eligible: (job) => forJob(job).eligible?.(job) || Promise.resolve(undefined),
    settled: (job) => forJob(job).settled?.(job) || Promise.resolve(),
  };
}
