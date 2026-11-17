import { accountAccessForId } from "./account-store.js";
import { writeCivitaiParameters } from "./civitai/civitai.js";
import { getCustomWorkflow } from "./custom-workflows.js";
import { describeFailure } from "./failures.js";
import { replaceGalleryJob, updateGalleryJob } from "./gallery/store.js";
import { customWorkflowGraph } from "./graphs.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { writeBytesFileAsync } from "./json-store.js";
import { mediaPath, mediaSubfolder, mediaUrls } from "./media-paths.js";
import { noteIngested } from "./media-store.js";
import { warmNewOutputs } from "./media-warmup.js";
import {
  RadianceClient,
  imageRequest,
  radianceImageNode,
  radianceVideoNode,
  radianceWorkMs,
  videoFailure,
  videoRequest,
} from "./providers/radiance.ts";
import { preparedReference } from "./references.js";
import { loadSharp } from "./sharp-loader.js";
import { workerById } from "./workers.js";
import { markWorkflowUsed } from "./workflow-catalogue.js";
import { resolveImageMode } from "./workflow-modes.js";

const videoPollMs = 2000;
const modelPollMs = 1000;
const stopping = (id) => ["cancelling", "cancelled"].includes(jobs.get(id)?.status);
/** Ended outside the run, as when an administrator restarts Radiance: it saves nothing more. */
const ended = (id) => Boolean(jobs.get(id)?.terminalAt);

/** Slot identity owns conditioning order; reordering a draft never swaps first and last frames. */
export function orderedRadianceReferences(body) {
  const profile = resolveImageMode(
    getCustomWorkflow(body.workflow || body.profileId, body.profileBackend) || {},
    body,
  );
  const references = body.referenceAssets || [];
  const slots = profile?.mediaInputs || [];
  return slots.length
    ? slots.flatMap((slot) => references.filter((reference) => reference.slot === slot.id))
    : references;
}

/** The run's references as PNGs, in order, sized as ComfyUI's staging would size them. */
async function referenceImages(body) {
  const account = body.ownerId ? accountAccessForId(body.ownerId) : undefined;
  const sharp = await loadSharp();
  const images = [];
  for (const reference of orderedRadianceReferences(body)) {
    if (!reference?.assetId) continue;
    const prepared = await preparedReference(account, reference.assetId, body);
    images.push(sharp ? await sharp(prepared.buffer).rotate().png().toBuffer() : prepared.buffer);
  }
  return images;
}

/** One output into Studio media, as a ComfyUI output moved there would read. */
async function storeOutput(id, index, bytes, type, ownerId) {
  const subfolder = mediaSubfolder(ownerId);
  const filename = `radiance-${id}-${index}.${type === "video" ? "mp4" : "png"}`;
  const file = mediaPath(filename, subfolder);
  if (!file) throw new Error("This output's name cannot be stored.");
  await writeBytesFileAsync(file, bytes, { mode: 0o600 });
  const urls = mediaUrls(filename, subfolder);
  return {
    ...urls,
    thumbnailUrl: type === "video" ? undefined : urls.thumbnailUrl,
    filename,
    type,
  };
}

function showProgress(id, phase, value = 0, max = 0) {
  jobs.set(id, { ...jobs.get(id), progress: { value, max, node: "", phase, steps: max > 0 } });
}

function cancelledRun(id) {
  updateGalleryJob(id, { status: "cancelled" });
  setTerminalJob(id, { status: "cancelled" });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transient = (error) => !error.status || error.status >= 500 || error.status === 429;

/**
 * When Radiance first lists `model` as resident while `request` is open, or null when it never
 * does; a model already resident on the first look took no loading.
 */
async function residentAt(client, model, request, pollMs) {
  let settled = false;
  request.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let first = true; !settled; first = false) {
    const models = await Promise.resolve()
      .then(() => client.models())
      .catch(() => []);
    if (models.find((entry) => entry.id === model)?.state === "resident")
      return first ? null : Date.now();
    await Promise.race([pause(pollMs), request.catch(() => null)]);
  }
  return null;
}

/**
 * A DELETE forgets an active video before its GPU stops; retain it until its terminal status.
 * `marks` takes when Radiance accepted the video (its model loaded) and when it completed.
 */
async function runVideo(id, client, record, save, body, pollMs, marks = {}) {
  let video;
  if (record.videoId) video = await client.video(record.videoId);
  else {
    video = await client.createVideo(body);
    marks.created = Date.now();
    record.videoId = video.id;
    save();
  }
  jobs.set(id, { ...jobs.get(id), promptId: record.videoId });
  while (video.status !== "completed") {
    if (ended(id)) throw new Error("Ended outside the run.");
    const failure = videoFailure(video);
    if (failure) throw Object.assign(new Error(failure), { terminal: true });
    showProgress(
      id,
      stopping(id) ? "Finishing accepted work" : "Generating",
      Number(video.progress) || 0,
      100,
    );
    await pause(pollMs);
    try {
      video = await client.video(record.videoId);
    } catch (error) {
      if (!transient(error)) throw error;
      showProgress(id, "Reconnecting");
    }
  }
  marks.completed = Date.now();
  showProgress(id, "Saving");
  return [await client.videoContent(record.videoId)];
}

/** The stages Studio saw, for Details › Timing; each only when it was measured. */
function radianceTiming(body, marks) {
  const span = (from, to) => (from && to && to >= from ? Math.round(to - from) : undefined);
  const stages = {
    queueMs: span(body.queuedAt, body.startedAt),
    setupMs: span(marks.start, marks.sent),
    loadMs: span(marks.sent, marks.created || marks.resident),
    samplingMs: span(
      marks.created || marks.resident || marks.sent,
      marks.completed || marks.received,
    ),
    downloadMs: span(marks.completed, marks.received),
    saveMs: span(marks.received, marks.saved),
    runMs: span(marks.sent, marks.received),
  };
  return Object.fromEntries(Object.entries(stages).filter(([, ms]) => ms !== undefined));
}

/**
 * Radiance images have no remote job record: keep the response connected even after Stop, then
 * save accepted results. Videos keep their provider ID and exact submitted body in the existing
 * provider journal, and are deleted only after their outputs and gallery records are durable.
 */
export async function runRadianceJob(
  id,
  body,
  worker,
  { store, client = new RadianceClient(worker.url), pollMs = videoPollMs, recovered = false } = {},
) {
  const ownerId = body.ownerId || "";
  let record = store?.providerRecord(ownerId, id);
  const save = () => store?.saveProviderRecord(ownerId, id, record);
  // A recovered run's earlier stages happened in another process, so only a fresh run is timed.
  const marks = recovered ? null : { start: Date.now() };
  try {
    if (!record) {
      if (stopping(id)) return cancelledRun(id);
      const graph = await customWorkflowGraph(body);
      const node = Object.values(graph).find((item) =>
        [radianceImageNode, radianceVideoNode].includes(item?.class_type),
      );
      if (!node) throw new Error("This profile's Radiance backend has no Radiance node.");
      record = {
        body,
        video: node.class_type === radianceVideoNode,
        values: node.inputs,
        outputs: [],
      };
      save();
    }
    if (recovered && !record.video && !record.outputs.length) {
      throw Object.assign(
        new Error(
          "Studio restarted during a synchronous Radiance image request. Its remote result cannot be recovered; retry explicitly.",
        ),
        { terminal: true },
      );
    }
    jobs.set(id, {
      ...jobs.get(id),
      status: stopping(id) ? "cancelling" : "running",
      promptId: record.videoId || `radiance-${id}`,
    });
    let outputs = record.outputs;
    if (!outputs.length) {
      let made;
      if (record.videoId) {
        made = await runVideo(id, client, record, save, undefined, pollMs);
      } else {
        const references = await referenceImages(record.body);
        const request = record.video
          ? videoRequest(record.values, references)
          : imageRequest(record.values, references);
        if (stopping(id)) return cancelledRun(id);
        showProgress(id, "Generating");
        if (marks) marks.sent = Date.now();
        if (record.video)
          made = await runVideo(id, client, record, save, request.body, pollMs, marks || {});
        else {
          const images = client.images(
            request.route,
            request.body,
            AbortSignal.timeout(radianceWorkMs),
          );
          const loaded = marks && residentAt(client, record.values.model, images, modelPollMs);
          made = await images;
          if (marks) marks.resident = await loaded;
        }
        if (marks) marks.received = Date.now();
        if (ended(id)) return;
      }
      // Keep accepted bytes in this process while local storage is unavailable.
      for (const [index, bytes] of made.entries()) {
        for (;;) {
          try {
            const output = await storeOutput(
              id,
              index,
              bytes,
              record.video ? "video" : "image",
              ownerId,
            );
            outputs[index] = output;
            save();
            break;
          } catch {
            showProgress(id, "Waiting to save");
            await pause(pollMs);
          }
        }
      }
    }
    showProgress(id, "Saving");
    await writeCivitaiParameters(outputs, record.body);
    warmNewOutputs(outputs);
    const delivered = record.body.autoUpscale
      ? outputs.map((output) => ({
          ...output,
          upscale: {
            status: "failed",
            quality: record.body.autoUpscale.quality,
            progress: null,
            error: "Smart upscale needs a separate ComfyUI run. Choose Upscale on this result.",
          },
        }))
      : outputs;
    if (marks?.received) {
      marks.saved = Date.now();
      jobs.set(id, { ...jobs.get(id), timing: radianceTiming(record.body, marks) });
    }
    const completed = await replaceGalleryJob(id, delivered, record.body, jobs);
    markWorkflowUsed(record.body.profileId || record.body.model || record.body.workflow || "");
    setTerminalJob(id, { status: "done", outputs: completed });
    noteIngested([id]);
    if (record.videoId) await client.deleteVideo(record.videoId).catch(() => null);
  } catch (error) {
    if (ended(id)) return;
    if (
      record &&
      !error.terminal &&
      error.status !== 404 &&
      (record.videoId || record.outputs?.length)
    ) {
      // Queue recovery retries this journal, never another provider submission.
      jobs.delete(id);
      return;
    }
    const failure = describeFailure({ message: error.message });
    setTerminalJob(id, { status: "failed", error: failure.summary, failure });
    updateGalleryJob(id, { status: "failed", filename: failure.title, failure });
  }
}

/** Recover an accepted video or locally saved outputs without submitting the job again. */
export function recoverRadianceJob(job, store) {
  const record = store.providerRecord(job.ownerId, job.id);
  const body = record?.body;
  jobs.set(job.id, {
    ownerId: job.ownerId || undefined,
    comfyBackend: job.backend,
    status: job.cancelRequested ? "cancelling" : "running",
    promptId: record?.videoId || job.providerJobId,
  });
  if (body && (record.videoId || record.outputs?.length)) {
    void runRadianceJob(
      job.id,
      body,
      { url: workerById(job.backend).url },
      { store, recovered: true },
    );
  } else {
    setTerminalJob(job.id, {
      status: "failed",
      error:
        "Studio restarted before Radiance recorded a recoverable result. Retry explicitly; this job was not resubmitted.",
    });
  }
}
