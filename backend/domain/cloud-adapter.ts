import type { QueueMedia } from "../../shared/queue.ts";
import { CliProxyMedia, type CloudRequest } from "../providers/cliproxy.ts";
import type { JobObservation, QueueAdapter } from "./queue.ts";
import { Store, type OwnedJob } from "./store.ts";

interface ProviderRecord {
  state: "submitting" | "running" | "saved" | "failed" | "cancelled";
  request: Omit<CloudRequest, "reference">;
  providerId?: string;
  outputs: QueueMedia[];
  reason?: string;
  /** The one resubmit after a moderation refusal: why the first prompt was refused. */
  retried?: { reason: string };
}
interface CloudAdapterOptions {
  store: Store;
  provider: CliProxyMedia;
  resolve(job: OwnedJob): Promise<CloudRequest>;
  /**
   * The job's prompt rewritten by the prompt assistant to pass moderation, keeping its subject,
   * scene, action and camera; throws when it cannot.
   */
  soften?(job: OwnedJob, prompt: string, reason: string): Promise<string>;
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
  now?: () => number;
}
interface ProviderError extends Error {
  status?: number;
  providerRejected?: boolean;
}

// A running video's status polls: soon after submission, then less often (videos take ~30 s).
const pollDelays = [2_000, 3_000, 5_000, 8_000, 15_000];
// An unanswered poll (network, 429 or 5xx) waits longer each time, failing after unansweredLimit.
const unansweredDelay = (failures: number) => Math.min(5_000 * 2 ** failures, 120_000);
const unansweredLimit = 30 * 60_000;
const moderation =
  /moderat|content polic|safety|violat|flagged|inappropriate|prohibited|not allowed|refus|blocked/i;

/** A readable reason for a provider's terminal refusal, keeping its HTTP status and own words. */
function refusal(message: string) {
  if (moderation.test(message)) return `The provider refused this for moderation. ${message}`;
  if (/expired|not found|unknown|no such/i.test(message))
    return `The provider no longer has this video. ${message}`;
  return `The provider rejected this request. ${message}`;
}

/** Never repeats provider submits after acceptance, including a lost synchronous image response. */
export function createCloudQueueAdapter({
  store,
  provider,
  resolve,
  soften,
  saveMedia,
  saveGallery,
  now = Date.now,
}: CloudAdapterOptions): QueueAdapter {
  const controllers = new Map<string, AbortController>();
  // When each running video is next polled; in memory, so a restart polls at once.
  const polls = new Map<
    string,
    { at: number; count: number; failures: number; since?: number; reason?: string }
  >();
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
  const save = (job: OwnedJob, state: ProviderRecord) => {
    store.saveProviderRecord(job.ownerId, job.id, state);
    return state;
  };

  /**
   * Fails a refused job, or once, when moderation refused it with nothing saved yet, has the prompt
   * assistant soften its prompt and submits it again; the job keeps both prompts.
   */
  async function refused(
    job: OwnedJob,
    state: ProviderRecord,
    message: string,
  ): Promise<JobObservation> {
    polls.delete(job.id);
    const reason = refusal(message);
    if (soften && !state.retried && !state.outputs.length && moderation.test(message)) {
      const latest = store.job(job.ownerId, job.id)!;
      const original = String(latest.input.refusedPrompt || latest.input.prompt || "");
      let prompt: string;
      try {
        prompt = (await soften(latest, original, message)).trim();
        if (!prompt || prompt === original) throw new Error("it returned the same prompt");
      } catch (error) {
        return result(
          save(job, {
            ...state,
            state: "failed",
            reason: `${reason} Rewriting the prompt to retry failed: ${(error as Error).message}`,
          }),
        );
      }
      if (cancelled(job)) return result(save(job, { ...state, state: "cancelled" }));
      const retrying = store.save({
        ...latest,
        input: { ...latest.input, prompt, refusedPrompt: original },
      });
      let input: CloudRequest;
      try {
        input = await resolve(retrying);
      } catch (error) {
        return result(save(job, { ...state, state: "failed", reason: (error as Error).message }));
      }
      const { reference: _reference, ...request } = input;
      return send(
        retrying,
        input,
        save(job, { state: "submitting", request, outputs: [], retried: { reason } }),
      );
    }
    return result(
      save(job, {
        ...state,
        state: "failed",
        reason: state.retried
          ? `${reason} It was retried once with a prompt the assistant rewrote, which was refused too: ${store.job(job.ownerId, job.id)?.input.prompt}`
          : reason,
      }),
    );
  }

  /** Submits a recorded request: an image run saves its outputs; a video records its provider ID. */
  async function send(
    job: OwnedJob,
    input: CloudRequest,
    initial: ProviderRecord,
  ): Promise<JobObservation> {
    let state = initial;
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      if (cancelled(job))
        return { status: "cancelled" as const, reason: "Cancelled before provider submission." };
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
      if (input.kind === "video") {
        const providerId = await provider.video(input, signal);
        state = save(job, { ...state, state: "running", providerId });
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
          throw new Error("CLIProxyAPI returned no image data; inspect provider before retrying.");
        state.outputs.push(await saveMedia(job, index, bytes, "image", input.model, input.prompt));
        save(job, state);
      }
      state = save(job, {
        ...state,
        state: state.outputs.length ? "saved" : "cancelled",
        ...(cancelled(job)
          ? {
              reason:
                "Cancelled; already saved images were kept. Provider work may still finish or be billed.",
            }
          : {}),
      });
      return result(state);
    } catch (error) {
      if (cancelled(job))
        return result(
          save(job, {
            ...state,
            state: state.outputs.length ? "saved" : "cancelled",
            reason: "Local waiting cancelled. Provider work may still finish or be billed.",
          }),
        );
      if ((error as ProviderError).providerRejected) {
        if (state.outputs.length)
          return result(save(job, { ...state, state: "saved", reason: (error as Error).message }));
        return refused(job, state, (error as Error).message);
      }
      throw error;
    } finally {
      controllers.delete(job.id);
    }
  }

  /** Polls a running video when it is due; a terminal refusal fails it, others back off. */
  async function poll(job: OwnedJob, state: ProviderRecord): Promise<JobObservation> {
    const due = polls.get(job.id) || { at: 0, count: 0, failures: 0 };
    if (now() < due.at) return { ...result(state), reason: due.reason || "" };
    let polled;
    try {
      polled = await provider.poll(state.providerId!);
    } catch (error) {
      const { status, message } = error as ProviderError;
      // Any other 4xx answers for good: the provider will never finish this video.
      if (status && status >= 400 && status < 500 && status !== 429)
        return refused(job, state, message);
      const since = due.since ?? now();
      if (now() - since >= unansweredLimit) {
        polls.delete(job.id);
        return result(
          save(job, {
            ...state,
            state: "failed",
            reason: `CLIProxyAPI did not answer this video's status for ${unansweredLimit / 60_000} minutes. ${message}`,
          }),
        );
      }
      const reason = `Waiting for the recorded generation: ${message}`;
      polls.set(job.id, {
        ...due,
        at: now() + unansweredDelay(due.failures),
        failures: due.failures + 1,
        since,
        reason,
      });
      return { ...result(state), reason };
    }
    polls.set(job.id, {
      at: now() + pollDelays[Math.min(due.count, pollDelays.length - 1)],
      count: due.count + 1,
      failures: 0,
    });
    if (["failed", "error", "expired"].includes(polled.status)) {
      const detail = typeof polled.error === "string" ? polled.error : polled.error?.message;
      return refused(
        job,
        state,
        `CLIProxyAPI video generation ${polled.status}${detail ? `: ${detail}` : "."}`,
      );
    }
    if (!["completed", "done"].includes(polled.status)) return result(state);
    polls.delete(job.id);
    const url = polled.video?.url || polled.video_url || polled.output_url;
    if (!url) throw new Error("CLIProxyAPI completed the video without an output URL.");
    const bytes = await provider.download(url);
    if (cancelled(job))
      return { status: "cancelled", reason: "Cancelled before saving the provider video." };
    return result(
      save(job, {
        ...state,
        state: "saved",
        outputs: [
          await saveMedia(job, 0, bytes, "video", state.request.model, state.request.prompt),
        ],
      }),
    );
  }

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
      return send(job, input, save(job, { state: "submitting", request, outputs: [] }));
    },
    async observe(job) {
      let state = record(job);
      if (!state) return undefined;
      if (cancelled(job) && !state.outputs.length) {
        polls.delete(job.id);
        state = save(job, {
          ...state,
          state: "cancelled",
          reason: "Local waiting cancelled. Provider work may still finish or be billed.",
        });
      }
      if (["saved", "failed", "cancelled"].includes(state.state)) return result(state);
      if (state.providerId) return poll(job, state);
      if (state.outputs.length && !controllers.has(job.id))
        return result(
          save(job, {
            ...state,
            state: "saved",
            reason:
              "Previously saved images recovered. An interrupted provider response was not resubmitted.",
          }),
        );
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
      try {
        await saveGallery(job, state.outputs, state.request);
      } catch (error) {
        // An Extend that can't be joined onto its video fails rather than retrying the save.
        if (!(error as { extendFailed?: boolean }).extendFailed) throw error;
        return result(
          save(job, { ...state, state: "failed" as const, reason: (error as Error).message }),
        );
      }
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
