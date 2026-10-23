import type { QueueMedia } from "../../shared/queue.ts";
import { CliProxyMedia, type CloudRequest } from "../providers/cliproxy.ts";
import type { JobObservation, QueueAdapter } from "./queue.ts";
import { RewriteStore, type OwnedJob } from "./store.ts";

interface ProviderRecord {
  state: "submitting" | "running" | "saved" | "failed" | "cancelled";
  request: Omit<CloudRequest, "reference">;
  providerId?: string;
  outputs: QueueMedia[];
  reason?: string;
}
interface CloudAdapterOptions {
  store: RewriteStore;
  provider: CliProxyMedia;
  resolve(job: OwnedJob): Promise<CloudRequest>;
  saveMedia(
    job: OwnedJob,
    index: number,
    bytes: Uint8Array,
    kind: "image" | "video",
    model: string,
    providerPrompt: string,
  ): Promise<QueueMedia>;
  saveGallery(
    job: OwnedJob,
    outputs: QueueMedia[],
    request: Omit<CloudRequest, "reference">,
  ): Promise<void>;
}

/** Never repeats provider submits after acceptance, including a lost synchronous image response. */
export function createCloudQueueAdapter({
  store,
  provider,
  resolve,
  saveMedia,
  saveGallery,
}: CloudAdapterOptions): QueueAdapter {
  const controllers = new Map<string, AbortController>();
  const record = (job: OwnedJob) => store.providerRecord<ProviderRecord>(job.ownerId, job.id);
  const cancelled = (job: OwnedJob) => Boolean(store.job(job.ownerId, job.id)?.cancelRequested);
  const result = (value: ProviderRecord): JobObservation => ({
    status:
      value.state === "saved"
        ? "completed"
        : value.state === "failed"
          ? "failed"
          : value.state === "cancelled"
            ? "cancelled"
            : "running",
    reason: value.reason || "",
    providerJobId: value.providerId,
    backend: "cliproxyapi",
    outputs: value.outputs,
    items: value.outputs,
  });
  return {
    async eligible() {
      try {
        await provider.models();
        return undefined;
      } catch {
        return "Waiting for CLIProxyAPI model discovery; the request has not been submitted.";
      }
    },
    async submit(job) {
      if (record(job))
        throw new Error(
          "This provider submission is already recorded; recover it before retrying.",
        );
      let input: CloudRequest;
      try {
        input = await resolve(job);
      } catch (error) {
        return { status: "failed", reason: (error as Error).message };
      }
      const { reference: _reference, ...request } = input;
      let state: ProviderRecord = { state: "submitting", request, outputs: [] };
      store.saveProviderRecord(job.ownerId, job.id, state);
      const controller = new AbortController();
      controllers.set(job.id, controller);
      try {
        if (cancelled(job))
          return { status: "cancelled", reason: "Cancelled before provider submission." };
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
        if (input.kind === "video") {
          const providerId = await provider.video(input, signal);
          state = { ...state, state: "running", providerId };
          store.saveProviderRecord(job.ownerId, job.id, state);
          const latest = store.job(job.ownerId, job.id)!;
          store.save({ ...latest, providerJobId: providerId });
          return result(state);
        }
        for (let index = 0; index < input.count; index++) {
          if (cancelled(job)) break;
          const images = await provider.image(input, signal);
          if (cancelled(job)) break;
          const image = images[0];
          if (!image)
            throw new Error("CLIProxyAPI returned no image; inspect provider before retrying.");
          const bytes = image.b64_json
            ? new Uint8Array(Buffer.from(image.b64_json, "base64"))
            : image.url
              ? await provider.download(image.url, signal)
              : undefined;
          if (!bytes?.length)
            throw new Error(
              "CLIProxyAPI returned no image data; inspect provider before retrying.",
            );
          state.outputs.push(
            await saveMedia(job, index, bytes, "image", input.model, input.prompt),
          );
          store.saveProviderRecord(job.ownerId, job.id, state);
        }
        state = {
          ...state,
          state: state.outputs.length ? "saved" : "cancelled",
          ...(cancelled(job)
            ? {
                reason:
                  "Cancelled; already saved images were kept. Provider work may still finish or be billed.",
              }
            : {}),
        };
        store.saveProviderRecord(job.ownerId, job.id, state);
        return result(state);
      } catch (error) {
        if (cancelled(job)) {
          state = {
            ...state,
            state: state.outputs.length ? "saved" : "cancelled",
            reason: "Local waiting cancelled. Provider work may still finish or be billed.",
          };
          store.saveProviderRecord(job.ownerId, job.id, state);
          return result(state);
        }
        if ((error as { providerRejected?: boolean }).providerRejected) {
          state = {
            ...state,
            state: state.outputs.length ? "saved" : "failed",
            reason: (error as Error).message,
          };
          store.saveProviderRecord(job.ownerId, job.id, state);
          return result(state);
        }
        throw error;
      } finally {
        controllers.delete(job.id);
      }
    },
    async observe(job) {
      let state = record(job);
      if (!state) return undefined;
      if (cancelled(job) && !state.outputs.length) {
        state = {
          ...state,
          state: "cancelled",
          reason: "Local waiting cancelled. Provider work may still finish or be billed.",
        };
        store.saveProviderRecord(job.ownerId, job.id, state);
      }
      if (["saved", "failed", "cancelled"].includes(state.state)) return result(state);
      if (state.providerId) {
        const polled = await provider.poll(state.providerId);
        if (["failed", "error"].includes(polled.status))
          state = { ...state, state: "failed", reason: "CLIProxyAPI video generation failed." };
        else if (["completed", "done"].includes(polled.status)) {
          const url = polled.video?.url || polled.video_url || polled.output_url;
          if (!url) throw new Error("CLIProxyAPI completed the video without an output URL.");
          const bytes = await provider.download(url);
          if (cancelled(job))
            return { status: "cancelled", reason: "Cancelled before saving the provider video." };
          state = {
            ...state,
            state: "saved",
            outputs: [
              await saveMedia(job, 0, bytes, "video", state.request.model, state.request.prompt),
            ],
          };
        }
        store.saveProviderRecord(job.ownerId, job.id, state);
        return result(state);
      }
      if (state.outputs.length && !controllers.has(job.id)) {
        state = {
          ...state,
          state: "saved",
          reason:
            "Previously saved images recovered. An interrupted provider response was not resubmitted.",
        };
        store.saveProviderRecord(job.ownerId, job.id, state);
        return result(state);
      }
      return {
        status: "running",
        reason:
          "The synchronous provider response is not confirmed. This request will not be submitted again automatically.",
      };
    },
    async cancel(job) {
      controllers.get(job.id)?.abort();
    },
    async saveOutputs(job) {
      const state = record(job);
      if (!state?.outputs.length) throw new Error("Provider outputs are not yet safely saved.");
      await saveGallery(job, state.outputs, state.request);
    },
  };
}

export function routeQueueAdapters(local: QueueAdapter, cloud: QueueAdapter): QueueAdapter {
  const adapter = (job: OwnedJob) =>
    job.resource.startsWith("provider:cliproxyapi") ? cloud : local;
  return {
    submit: (job) => adapter(job).submit(job),
    observe: (job) => adapter(job).observe(job),
    cancel: (job) => adapter(job).cancel(job),
    saveOutputs: (job) => adapter(job).saveOutputs(job),
    eligible: (job) => adapter(job).eligible?.(job) || Promise.resolve(undefined),
    settled: (job) => adapter(job).settled?.(job) || Promise.resolve(),
  };
}
