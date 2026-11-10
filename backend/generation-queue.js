import { withResolution } from "../shared/resolution.ts";
import { terminalStatuses } from "../shared/queue.ts";
import { accountAccessForId } from "./account-store.js";
import {
  onWorkerOffline,
  profileOnBackendKey,
  readyWorkers,
  routeJob,
  withComfyBackend,
} from "./comfy/backends.js";
import { demoMode } from "./comfy/comfy.js";
import { cancelPrompt } from "./comfy/queue.js";
import { forgetComfyRun } from "./comfy/traces.js";
import { getCustomWorkflow } from "./custom-workflows.js";
import { createCloudQueueAdapter, routeQueueAdapters } from "./domain/cloud-adapter.ts";
import { createGenerationQueueAdapter } from "./domain/generation-adapter.ts";
import { GenerationQueue, modelOf } from "./domain/queue.ts";
import { queuePriority } from "./domain/store.ts";
import { createUpscaleQueueAdapter, withUpscaleAdapter } from "./domain/upscale-adapter.ts";
import {
  flushGalleryStrict,
  gallery,
  replaceGalleryJob,
  updateGalleryJob,
} from "./gallery/store.js";
import { storedWritingRecord } from "./gallery/records.js";
import { jobs } from "./jobs.js";
import { writeBytesFileAsync } from "./json-store.js";
import { mediaRoot, mediaSubfolder } from "./media-paths.js";
import { ingestRunResults, removeComfyFiles } from "./media-store.js";
import { mockModelResult } from "./model/models.js";
import { withPngText } from "./png-text.js";
import { canonicalProfileId, profileAliasBackend } from "./profile/store.js";
import { writingIssue, writingRequest } from "./prompt-stage.js";
import { providerMediaWriter } from "./providers/media.ts";
import { runUpscaleJob } from "./upscale-jobs.js";
import { resultSource } from "./version-sources.js";
import { capabilityForProfile, defaultWorkerId, listWorkers, workerById } from "./workers.js";

/**
 * Studio's generation queue (domain/queue.ts) and its adapters: local workers, with their GPU
 * deployments leased while a job runs, the direct cloud profiles and smart upscales. Answers the
 * queue, where a job is queued (`queueResourceFor`) and the check every generation passes before
 * it is admitted (`validateGenerationInput`). `completed(items)` hears each finished job's results.
 */
export function createGenerationQueue({
  assistantEngine,
  catalogue,
  cloudProvider,
  completed,
  directCloud,
  generationRoutes,
  promptStage,
  recoverRunningJobs,
  runtime,
  store,
}) {
  const { loadComfyContext, mediaModels, workerWorkloads } = catalogue;
  // This runtime owns only the IDs persisted in its own SQLite queue and gallery.
  const mediaLeases = new Map();
  // Work goes to a worker picked by load (pickWorker in workers.js); background work (MCP, Dream,
  // finishing) breaks ties towards the last worker, keeping the first free for manual work.
  async function queueResourceFor(input, priority = queuePriority.manual) {
    if (directCloud?.isProfile(input)) return "provider:cliproxyapi";
    const models = await mediaModels(false)
      .then((result) => result.models)
      .catch(() => (demoMode ? mockModelResult() : { profiles: [] }));
    const profile = models.profiles?.find(
      (item) => item.id === canonicalProfileId(input.profileId),
    );
    const capability = profile
      ? capabilityForProfile(profile)
      : input.kind === "video"
        ? "video"
        : "image";
    const worker = routeJob(capability, {
      profileId: profileOnBackendKey(input.profileId, input.profileBackend),
      loads: generationQueue.loads(),
      model: modelOf(input),
      last: priority > queuePriority.manual,
    });
    return `worker:${worker?.id || defaultWorkerId() || ""}`;
  }
  /** The deployments that can serve a job's worker; one- and two-GPU video share its address. */
  function managedWorkloads(job) {
    if (job.resource.startsWith("provider:cliproxyapi")) return [];
    return workerWorkloads(workerById(job.backend));
  }
  const queueAdapter = createGenerationQueueAdapter({
    submitGeneration: generationRoutes.submitGeneration,
    jobs,
    gallery: () => gallery,
    accountForOwner: accountAccessForId,
    flushGallery: flushGalleryStrict,
    durableSave: async (job) => {
      const records = gallery.filter(
        (item) =>
          item.jobId === job.id && item.status === "done" && (item.ownerId || "") === job.ownerId,
      );
      const moved = await withComfyBackend(job.backend, () =>
        ingestRunResults(
          records.map((item) => ({
            output: item,
            ...(item.upscale?.url ? { upscale: item.upscale } : {}),
          })),
          job.ownerId,
          { strict: true },
        ),
      );
      for (const result of moved.results)
        updateGalleryJob(result.output.id, {
          ...result.output,
          ...(result.upscale ? { upscale: result.upscale } : {}),
        });
      await flushGalleryStrict();
      const live = jobs.get(job.id);
      if (live && (live.ownerId || "") === job.ownerId)
        jobs.set(job.id, {
          ...live,
          status: "done",
          error: "",
          outputs: gallery.filter(
            (item) =>
              item.jobId === job.id &&
              item.status === "done" &&
              (item.ownerId || "") === job.ownerId,
          ),
        });
      if (moved.comfyFiles.length)
        await withComfyBackend(job.backend, async () => {
          await removeComfyFiles(moved.comfyFiles);
          if (job.providerJobId)
            await forgetComfyRun({ promptIds: [job.providerJobId] }).catch(() => false);
        });
    },
    cancelPrompt: ({ promptId, backend }) =>
      withComfyBackend(backend, () => cancelPrompt(promptId)),
    recover: async (job) => {
      if ((job.providerJobId || job.cancelRequested) && !jobs.has(job.id))
        jobs.set(job.id, {
          status: job.cancelRequested ? "cancelling" : "running",
          recovered: true,
          promptId: job.providerJobId,
          comfyBackend: job.backend,
          ownerId: job.ownerId || undefined,
        });
      await recoverRunningJobs();
    },
    eligible: async (job) => {
      if (demoMode) return;
      if (!job.backend || !workerById(job.backend))
        return "Waiting for its worker to be configured.";
      const workloads = managedWorkloads(job);
      try {
        if (workloads.length && !mediaLeases.has(job.id))
          mediaLeases.set(job.id, await runtime.controller.acquire(workloads));
        await withComfyBackend(job.backend, () => loadComfyContext());
      } catch (error) {
        mediaLeases.get(job.id)?.release();
        mediaLeases.delete(job.id);
        return error.message;
      }
    },
    settled: async (job) => {
      if (job.status === "failed")
        updateGalleryJob(job.id, { status: "failed", error: job.reason });
      if (job.status === "cancelled") updateGalleryJob(job.id, { status: "cancelled" });
      mediaLeases.get(job.id)?.release();
      mediaLeases.delete(job.id);
    },
  });
  // Reconstruct leases synchronously before the HTTP listener accepts work.
  for (const job of store
    .jobs()
    .filter(
      (item) =>
        !terminalStatuses.has(item.status) &&
        (["starting", "running", "saving"].includes(item.status) || item.providerJobId),
    )) {
    const workloads = managedWorkloads(job);
    if (workloads.length) mediaLeases.set(job.id, runtime.controller.retain(workloads));
  }
  const directCloudAdapter =
    directCloud &&
    createCloudQueueAdapter({
      store,
      provider: cloudProvider,
      resolve: directCloud.resolve,
      // A gone or disabled account's prompts never reach the text model.
      soften: async (job, prompt, reason) => {
        if (!assistantEngine || (job.ownerId && !accountAccessForId(job.ownerId)?.authenticated))
          throw new Error("the prompt assistant is unavailable");
        const written = await assistantEngine.rewrite({
          prompt,
          preset: "custom",
          instruction: `The provider's moderation refused this prompt (${reason.slice(0, 200)}). Keep its subject, scene, action and camera; soften only the wording likely to have tripped moderation.`,
          signal: AbortSignal.timeout(120_000),
        });
        if (written.source !== "assistant")
          throw new Error(written.reason || "the prompt assistant did not answer");
        return written.prompt;
      },
      saveMedia: providerMediaWriter(mediaRoot, mediaSubfolder, writeBytesFileAsync, withPngText),
      saveGallery: async (job, outputs, request) => {
        await replaceGalleryJob(
          job.id,
          outputs,
          {
            ...job.input,
            kind: request.kind,
            ownerId: job.ownerId,
            model: job.input.model || job.input.profileId,
            modelName: request.model,
            comfyBackend: "cliproxyapi",
            width: outputs[0]?.width || request.width,
            height: outputs[0]?.height || request.height,
            duration: request.duration,
            resolution: request.resolution,
          },
          jobs,
        );
        await flushGalleryStrict();
      },
    });
  const upscaleQueueAdapter = createUpscaleQueueAdapter({
    store,
    jobs,
    itemFor: (ownerId, itemId) =>
      gallery.find((item) => item.id === itemId && (item.ownerId || "") === ownerId),
    execute: (job, callbacks) =>
      withComfyBackend(job.backend, async () => {
        const account = job.ownerId ? accountAccessForId(job.ownerId) : undefined;
        if (!job.providerJobId && job.ownerId && !account?.authenticated)
          throw new Error("This account can no longer upscale images.");
        const info = job.providerJobId ? null : (await loadComfyContext()).info;
        return runUpscaleJob(job.id, job.input.upscaleBody, info, undefined, {
          ...callbacks,
          promptId: job.providerJobId,
          plan: job.input.upscalePlan,
        });
      }),
    cancelPrompt: (promptId, backend) => withComfyBackend(backend, () => cancelPrompt(promptId)),
    flushGallery: flushGalleryStrict,
    eligible: queueAdapter.eligible,
    settled: async (job) => {
      const item = gallery.find(
        (entry) => entry.id === job.input.galleryItemId && (entry.ownerId || "") === job.ownerId,
      );
      if (item && item.upscale?.jobId === job.id && ["failed", "cancelled"].includes(job.status))
        updateGalleryJob(item.id, {
          upscale: {
            ...item.upscale,
            status: job.status,
            error: job.reason,
            progress: null,
          },
        });
      await queueAdapter.settled(job);
    },
  });
  const generationAdapter = withUpscaleAdapter(
    directCloudAdapter ? routeQueueAdapters(queueAdapter, directCloudAdapter) : queueAdapter,
    upscaleQueueAdapter,
  );
  const generationQueue = new GenerationQueue(
    store,
    {
      ...generationAdapter,
      // A local generation may move to another idle worker that runs it until it starts.
      alternatives: (job) => {
        const capability = job.input.kind === "video" ? "video" : "image";
        return job.resource.startsWith("worker:") && job.operation !== "upscale"
          ? readyWorkers(
              capability,
              profileOnBackendKey(job.input.profileId, job.input.profileBackend),
            ).map((worker) => `worker:${worker.id}`)
          : [];
      },
      settled: async (job) => {
        await generationAdapter.settled(job);
        if (job.status !== "completed") return;
        // Its results keep the result it was made from, once the run has left the queue too.
        if (job.parentItemId)
          updateGalleryJob(
            job.id,
            resultSource(job, job.parentItemId, {
              parent: job.parentJobId ? store.job(job.ownerId, job.parentJobId) : undefined,
              source: gallery.find(
                (item) => item.id === job.parentItemId && (item.ownerId || "") === job.ownerId,
              ),
            }),
          );
        const items = gallery.filter(
          (item) => item.jobId === job.id && (item.ownerId || "") === job.ownerId,
        );
        completed(items);
      },
    },
    promptStage,
  );
  // A worker that stops, restarts or goes offline no longer has the model it last ran loaded.
  onWorkerOffline((id) => generationQueue.unload(`worker:${id}`));
  runtime?.controller.onStop((workload) => {
    for (const worker of listWorkers())
      if (workerWorkloads(worker).includes(workload)) generationQueue.unload(`worker:${worker.id}`);
  });
  async function validateGenerationInput(input, account) {
    if (input.writing === undefined) return validateGeneration(input, account);
    if (typeof input.writing?.prompt === "string") {
      // Already written (a Dream variation): the record goes with the prompt it explains.
      const record = storedWritingRecord(input.writing);
      if (record) input.writing = { ...record, prompt: input.writing.prompt };
      else delete input.writing;
      return validateGeneration(input, account);
    }
    // Written in the queue: only the request is admitted, and the rest is checked as it will run,
    // with a stand-in for the prompt still to be written.
    input.writing = writingRequest(input.writing);
    const issue = writingIssue(input.writing, { engine: assistantEngine, account });
    if (issue) return { status: issue.status, payload: { ok: false, error: issue.error } };
    input.prompt = "(written by the prompt assistant)";
    try {
      return await validateGeneration(input, account);
    } finally {
      input.prompt = "";
    }
  }
  async function validateGeneration(input, account) {
    // A per-backend id merged into a combined profile runs on the backend it named.
    const named = profileAliasBackend(input.profileId);
    // A merged profile's old id (a reused result, preset or MCP call) runs and is stored as the kept one.
    for (const key of ["profileId", "model", "workflow"])
      if (typeof input[key] === "string") input[key] = canonicalProfileId(input[key]);
    // The backend a combined profile's run uses, stored with it: the one asked for while the profile
    // still defines it, else its current one. Any other profile runs without one.
    const combined =
      typeof input.profileId === "string" && input.profileId.startsWith("custom:")
        ? getCustomWorkflow(input.profileId)
        : null;
    const wanted = input.profileBackend || named;
    if (combined?.backendIds?.length)
      input.profileBackend = combined.backendIds.includes(wanted) ? wanted : combined.backend;
    else delete input.profileBackend;
    // Every path (composer, Chat, Compare, Dream, MCP) draws at its size tier, 1K unless it names one.
    const sized = (await mediaModels().catch(() => null))?.models?.profiles?.find(
      (profile) => profile.id === input.profileId,
    );
    Object.assign(input, withResolution(input, sized));
    if (directCloud?.isProfile(input)) {
      try {
        await directCloud.resolve({ ownerId: account?.userId || "", input });
        return { status: 200, payload: { ok: true } };
      } catch (error) {
        return { status: error.status || 400, payload: { ok: false, error: error.message } };
      }
    }
    return generationRoutes.validateInput(input, account);
  }
  return { generationQueue, queueResourceFor, validateGenerationInput };
}
