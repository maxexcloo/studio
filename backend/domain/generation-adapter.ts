import type { QueueMedia } from "../../shared/queue.ts";
import type { JobObservation, QueueAdapter } from "./queue.ts";
import type { OwnedJob } from "./store.ts";

type RecordValue = Record<string, any>;
interface GenerationAdapterOptions {
  generate(req: RecordValue, res: RecordValue): Promise<unknown>;
  jobs: Map<string, RecordValue>;
  gallery(): RecordValue[];
  accountForOwner(ownerId: string): RecordValue | null;
  flushGallery(): Promise<unknown>;
  durableSave?(job: OwnedJob): Promise<unknown>;
  cancelPrompt(job: { promptId: string; backend?: string }): Promise<unknown>;
  recover?(job: OwnedJob): Promise<unknown>;
  eligible?(job: OwnedJob): Promise<string | undefined>;
  settled?(job: OwnedJob): Promise<void>;
}

/** The old HTTP contract and the queue call the same generation domain entry point. */
export function createGenerationQueueAdapter(options: GenerationAdapterOptions): QueueAdapter {
  const ownedItems = (job: OwnedJob) =>
    options
      .gallery()
      .filter((item) => item.jobId === job.id && (item.ownerId || "") === job.ownerId);
  const current = (job: OwnedJob): RecordValue | undefined => {
    const live = options.jobs.get(job.id);
    return live && (live.ownerId || "") === job.ownerId ? live : undefined;
  };
  const observation = (job: OwnedJob): JobObservation | undefined => {
    const live = current(job);
    const items = ownedItems(job);
    const outputs = items.filter((item) => item.status === "done" && item.url);
    const details = {
      providerJobId: live?.promptId || job.providerJobId,
      backend: live?.comfyBackend || job.backend,
      items: items as QueueMedia[],
      outputs: outputs as QueueMedia[],
      ...(live?.progress ? { progress: live.progress } : {}),
    };
    if (live?.status === "done" || (outputs.length && (!live || live.terminalAt)))
      return { ...details, status: "completed" };
    if (live?.status === "error")
      return { ...details, status: "failed", reason: live.error || "Generation failed." };
    if (live?.status === "canceled")
      return { ...details, status: "cancelled", reason: "Generation cancelled." };
    if (live)
      return {
        ...details,
        status: "running",
        reason:
          live.status === "queued"
            ? "Accepted by the worker; waiting for execution."
            : live.status === "canceling"
              ? live.error || "Cancelling the recorded generation."
              : "",
      };
    return undefined;
  };
  return {
    eligible: options.eligible,
    async submit(job) {
      const account = job.ownerId ? options.accountForOwner(job.ownerId) : null;
      if (job.ownerId && (!account || account.authenticated === false))
        return { status: "failed", reason: "This account no longer has access." };
      let status = 200;
      let payload: RecordValue | undefined;
      const res: RecordValue = {
        headersSent: false,
        status(code: number) {
          status = code;
          return res;
        },
        json(value: RecordValue) {
          payload = value;
          res.headersSent = true;
          return res;
        },
      };
      await options.generate(
        {
          body: { ...job.input, clientJobId: job.id },
          studioAccount: account || undefined,
          studioQueueBackend: job.backend,
          // Only the queue record marks Dream work; a request body cannot.
          studioDream: job.dream,
          headers: {},
        },
        res,
      );
      if (!payload) throw new Error("Generation did not acknowledge its submission.");
      if (status >= 400)
        return {
          status: "failed",
          reason: String(payload.error || `Generation refused (${status}).`),
        };
      return observation(job) || { status: "running", items: payload.items || [] };
    },
    async observe(job) {
      let result = observation(job);
      if (!result && options.recover) {
        await options.recover(job);
        result = observation(job);
      }
      return result;
    },
    async cancel(job) {
      const live = current(job);
      if (live && !live.terminalAt) options.jobs.set(job.id, { ...live, status: "canceling" });
      const promptId = live?.promptId || job.providerJobId;
      if (promptId)
        await options.cancelPrompt({ promptId, backend: live?.comfyBackend || job.backend });
      // An unknown provider outcome stays recorded until recovery confirms cancellation.
    },
    async saveOutputs(job) {
      await options.durableSave?.(job);
      await options.flushGallery();
      return observation(job);
    },
    settled: options.settled,
  } as QueueAdapter;
}
