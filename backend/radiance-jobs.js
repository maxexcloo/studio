import crypto from "node:crypto";

import { accountAccessForId } from "./account-store.js";
import { writeCivitaiParameters } from "./civitai/civitai.js";
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
  videoFailure,
  videoRequest,
} from "./providers/radiance.ts";
import { preparedReference } from "./references.js";
import { loadSharp } from "./sharp-loader.js";
import { markWorkflowUsed } from "./workflow-catalogue.js";

const videoPollMs = 2000;
const stopping = (id) => ["cancelling", "cancelled"].includes(jobs.get(id)?.status);

/** The run's references as PNGs, in order, sized as ComfyUI's staging would size them. */
async function referenceImages(body) {
  const account = body.ownerId ? accountAccessForId(body.ownerId) : undefined;
  const sharp = await loadSharp();
  const images = [];
  for (const reference of body.referenceAssets || []) {
    if (!reference?.assetId) continue;
    const prepared = await preparedReference(account, reference.assetId, body);
    images.push(sharp ? await sharp(prepared.buffer).rotate().png().toBuffer() : prepared.buffer);
  }
  return images;
}

/** One output into Studio media, as a ComfyUI output moved there would read. */
async function storeOutput(id, index, bytes, type, ownerId) {
  const subfolder = mediaSubfolder(ownerId);
  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}-radiance-${id.slice(0, 8)}-${index}.${type === "video" ? "mp4" : "png"}`;
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

/** Follows a video job to its MP4; a stop deletes the job, as every ending does. */
async function runVideo(id, client, body, signal) {
  const created = await client.createVideo(body, signal);
  jobs.set(id, { ...jobs.get(id), promptId: created.id });
  try {
    let video = created;
    while (video.status !== "completed") {
      const failure = videoFailure(video);
      if (failure) throw new Error(failure);
      if (stopping(id)) return null;
      if (video.status === "in_progress")
        showProgress(
          id,
          "Generating",
          Math.max(0, Math.min(100, Number(video.progress) || 0)),
          100,
        );
      await new Promise((resolve) => setTimeout(resolve, videoPollMs));
      video = await client.video(created.id);
    }
    showProgress(id, "Saving");
    return [await client.videoContent(created.id)];
  } finally {
    await client.deleteVideo(created.id);
  }
}

/**
 * Runs a generation on a Radiance worker (providers/radiance.ts): the profile's Radiance node,
 * filled like any graph, becomes the request. Its outputs go straight into Studio media and the
 * gallery. A stop ends an image request (Radiance may still finish the pictures it started) and
 * deletes a video job.
 */
export async function runRadianceJob(id, body, worker) {
  const client = new RadianceClient(worker.url);
  const abort = new AbortController();
  const watch = setInterval(() => stopping(id) && abort.abort(), 500);
  try {
    const graph = await customWorkflowGraph(body);
    const node = Object.values(graph).find((item) =>
      [radianceImageNode, radianceVideoNode].includes(item?.class_type),
    );
    if (!node) throw new Error("This profile's Radiance backend has no Radiance node.");
    const video = node.class_type === radianceVideoNode;
    const references = await referenceImages(body);
    const request = video
      ? videoRequest(node.inputs, references)
      : imageRequest(node.inputs, references);
    if (stopping(id)) return cancelledRun(id);
    const model = String(node.inputs.model);
    const state = (await client.models().catch(() => [])).find((item) => item.id === model)?.state;
    jobs.set(id, { ...jobs.get(id), status: "running", promptId: `radiance-${id}` });
    showProgress(id, state === "resident" ? "Generating" : `Warming up ${model}`);
    const made = video
      ? await runVideo(id, client, request.body, abort.signal)
      : await client.images(request.route, request.body, abort.signal);
    if (!made) return cancelledRun(id);
    const outputs = [];
    for (const [index, bytes] of made.entries())
      outputs.push(
        await storeOutput(id, index, bytes, video ? "video" : "image", body.ownerId || ""),
      );
    // Before the gallery shows them, so no browser reads a file mid-write.
    await writeCivitaiParameters(outputs, body);
    warmNewOutputs(outputs);
    const completed = await replaceGalleryJob(id, outputs, body, jobs);
    markWorkflowUsed(body.profileId || body.model || body.workflow || "");
    setTerminalJob(id, { status: "done", outputs: completed });
    noteIngested([id]);
  } catch (error) {
    if (stopping(id)) return cancelledRun(id);
    const failure = describeFailure({ message: error.message });
    setTerminalJob(id, { status: "failed", error: failure.summary, failure });
    updateGalleryJob(id, { status: "failed", filename: failure.title, failure });
  } finally {
    clearInterval(watch);
  }
}
