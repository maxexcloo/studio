import { activeComfyUrl, comfy, normalizeComfyError } from "./comfy.js";
import { cancelPrompt, promptTracker } from "./comfy-queue.js";
import { flushGalleryStrict, gallery, outputsFrom, updateGalleryJob } from "./gallery-store.js";
import { jobs, setTerminalJob, trackUpscale } from "./jobs.js";
import { recordUpscale, upscaleEstimate } from "./timings.js";
import { upscaleWork } from "./upscale-timing.js";
import { faceDetailSource, upscaleGraph, upscalePlan } from "./upscale.js";
import { saveIntoStudioFolder } from "./graphs.js";
import { ingestRunResults, mediaStorageEnabled, removeComfyFiles } from "./media-store.js";
import { forgetComfyRun } from "./comfy-traces.js";

export function findUpscaleTarget(id) {
  return gallery.find((item) => item.id === id || item.url === id) || null;
}

function patchUpscale(itemId, patch, options = {}) {
  const item = findUpscaleTarget(itemId);
  if (!item) return false;
  return updateGalleryJob(item.id, { upscale: { ...(item.upscale || {}), ...patch } }, options);
}

/** Where an upscale's state and result go: the gallery item, by default. */
function galleryTarget(itemId) {
  return {
    patch: (patch, options) => patchUpscale(itemId, patch, options),
    async finish(output, plan) {
      patchUpscale(itemId, {
        status: "done",
        progress: null,
        url: output.url,
        thumbnailUrl: output.thumbnailUrl || "",
        outputName: output.filename,
        width: plan.estimatedWidth,
        height: plan.estimatedHeight,
        scale: plan.scale,
        completedAt: new Date().toISOString(),
        error: "",
      });
      updateGalleryJob(itemId, { upscaleActive: true });
    },
  };
}

/**
 * Listens from before the prompt is queued, so an idle ComfyUI's start is
 * heard and times the upscale. `run.promptId`, once known, guards against
 * strays; `run.clock` is the job's place on the queue's clock (jobs.js).
 */
function watchUpscaleProgress(clientId, target, run) {
  let socket;
  try {
    socket = new WebSocket(
      `${activeComfyUrl().replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`,
    );
  } catch {
    return null;
  }
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data);
      const data = message.data || {};
      if (data.prompt_id && run.promptId && data.prompt_id !== run.promptId) return;
      run.alive?.();
      if (
        message.type === "execution_start" ||
        message.type === "executing" ||
        message.type === "progress"
      )
        run.clock.start();
      if (message.type === "execution_success") run.endAt ??= Date.now();
      if (message.type === "progress") {
        run.progress = { value: Number(data.value || 0), max: Number(data.max || 0) };
        target.patch(
          { status: "running", progress: { ...run.progress, ...run.clock.eta() } },
          { persist: false },
        );
      }
      if (message.type === "execution_interrupted") {
        target.patch({ status: "canceled", progress: null });
      }
      if (message.type === "execution_error") {
        target.patch({
          status: "error",
          progress: null,
          error: normalizeComfyError(data.exception_message || "Upscale failed"),
        });
      }
    } catch {
      // Ignore malformed frames from Comfy extensions.
    }
  });
  return socket;
}

export async function runUpscaleJob(
  jobId,
  body,
  info,
  target = galleryTarget(body.galleryItemId),
  recorded = {},
) {
  let socket = null;
  let clock = null;
  let cancelSent = false;
  try {
    const { graph: built, plan } = recorded.promptId
      ? { graph: null, plan: recorded.plan }
      : upscaleGraph(body, info);
    // An account's upscale is saved beside its other outputs, in the owner's folder.
    const graph = built && body.ownerId ? saveIntoStudioFolder(built, body.ownerId) : built;
    target.patch({
      status: "running",
      jobId,
      quality: plan.quality,
      faceDetail: Boolean(body.faceDetail),
      scale: plan.scale,
      startedAt: new Date().toISOString(),
      error: "",
    });
    // How long it should take, from every SeedVR2 upscale here before (upscale-timing.js).
    const learn = {
      quality: plan.quality,
      model: plan.model || "",
      faceDetail: Boolean(body.faceDetail),
      work: upscaleWork({ width: plan.estimatedWidth, height: plan.estimatedHeight }),
    };
    const estimate = upscaleEstimate(learn);
    const run = { promptId: "", alive: null, progress: { value: 0, max: 0 }, endAt: null };
    clock = trackUpscale(jobId, estimate, (eta) => {
      if (jobs.get(jobId)?.terminalAt) return;
      target.patch(
        { status: "running", progress: { ...run.progress, ...eta } },
        { persist: false },
      );
    });
    run.clock = clock;
    socket = watchUpscaleProgress(jobId, target, run);
    await waitForOpen(socket);
    if (!recorded.promptId) recorded.onSubmitting?.();
    const queued = recorded.promptId
      ? { prompt_id: recorded.promptId }
      : await comfy("/prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: graph,
            client_id: jobId,
            extra_data: { preview_method: "none" },
          }),
        }).catch((error) => {
          if (error.status >= 400 && error.status < 500) error.providerRejected = true;
          throw error;
        });
    if (typeof queued?.prompt_id !== "string" || !queued.prompt_id)
      throw new Error(
        "The worker did not acknowledge the upscale with a prompt ID; checking before any retry.",
      );
    // SQLite records the acknowledged prompt before tracking it or acknowledging any further work.
    recorded.onAccepted?.(queued.prompt_id);
    const cancelling = ["canceling", "canceled"].includes(jobs.get(jobId)?.status);
    jobs.set(jobId, {
      ...jobs.get(jobId),
      status: cancelling ? "canceling" : "running",
      promptId: queued.prompt_id,
    });
    run.promptId = queued.prompt_id;
    const tracker = promptTracker(queued.prompt_id);
    run.alive = tracker.alive;
    while (true) {
      const state = jobs.get(jobId)?.status;
      if ((state === "canceling" || state === "canceled") && !cancelSent) {
        await cancelPrompt(queued.prompt_id);
        cancelSent = true;
      }
      // A blip in the connection is waited out; a minute of silence or a dropped run ends it.
      const checked = await tracker.check();
      if (checked.state === "reconnecting") {
        await new Promise((resolve) => setTimeout(resolve, checked.delayMs));
        continue;
      }
      if (checked.state === "done") {
        const outputs = outputsFrom({ outputs: { 9: checked.entry?.outputs?.["9"] || {} } });
        let output = outputs.find((item) => item.type === (body.mediaType || "image"));
        if (!output) {
          if (cancelSent) {
            target.patch({ status: "canceled", progress: null });
            setTerminalJob(jobId, { status: "canceled" });
            return;
          }
          throw Object.assign(new Error("The upscale ended without a saved result."), {
            providerFailed: true,
          });
        }
        // ComfyUI as a worker: the upscale moves into Studio media beside its source.
        let comfyCopies = [];
        if (mediaStorageEnabled) {
          const moved = await ingestRunResults([{ output }], body.ownerId || "", { strict: true });
          output = moved.results[0].output;
          comfyCopies = moved.comfyFiles;
        }
        // Learned from, unless its start was never heard.
        const startAt = clock.startAt();
        if (startAt)
          recordUpscale({ ...learn, ms: (run.endAt ?? Date.now()) - startAt, predicted: estimate });
        await target.finish(output, plan);
        setTerminalJob(jobId, { status: "done", outputs: [output] });
        if (comfyCopies.length) {
          await flushGalleryStrict();
          await removeComfyFiles(comfyCopies);
          await forgetComfyRun({ promptIds: [queued.prompt_id] }).catch(() => false);
        }
        socket?.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } finally {
    socket?.close();
    clock?.end();
  }
}

function waitForOpen(socket) {
  if (!socket || socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 1200);
  });
}

/**
 * Plans one image's upscale, already staged in ComfyUI as `imageName`: the
 * upscale arrow on a finished image. Smart upscale as part of a run is
 * run-upscale.js.
 */
export function prepareUpscale({
  item,
  imageName,
  quality,
  target = 0,
  faceDetail = false,
  info,
  customWorkflow = null,
}) {
  const body = {
    galleryItemId: item.id,
    mediaType: item.type,
    imageName,
    quality,
    target,
    faceDetail: item.type === "image" && faceDetail,
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    prompt: item.prompt || "",
    ...(item.ownerId ? { ownerId: item.ownerId } : {}),
    ...faceDetailSource(item, customWorkflow),
  };
  const plan = upscalePlan(body);
  return { body, plan };
}

export function toggleUpscaleView(itemId, active) {
  const item = findUpscaleTarget(itemId);
  if (!item) throw new Error("That image is no longer in the gallery.");
  if (!item.upscale?.url) throw new Error("This image has no upscale to switch to.");
  const next = typeof active === "boolean" ? active : !item.upscaleActive;
  updateGalleryJob(item.id, { upscaleActive: next });
  return { ...item, upscaleActive: next };
}
