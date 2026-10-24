import crypto from "node:crypto";
import path from "node:path";
import { comfy } from "./comfy.js";
import { currentComfyBackend } from "./comfy-backends.js";
import { accountOutputSubfolder } from "./account-ownership.js";
import { dataDir, mediaPath, mediaStorageEnabled, mediaType, mediaUrls } from "./media-paths.js";
import { readJsonFile, writeBytesFileAsync, writeJsonFile } from "./json-store.js";
import { outputFolderName } from "./data-names.js";

/*
 * Runs already moved into Studio media, by job ID. Each stored copy gets a unique
 * name, so a run left in ComfyUI's history (a failed cleanup) can only be told
 * apart from a new one by its job; recovery skips these instead of importing twice.
 */
const ingestedPath = path.join(dataDir, "media-ingested.json");
const maxIngested = 20_000;
let ingested = null;
function ingestedJobs() {
  if (ingested) return ingested;
  try {
    ingested = new Map(Object.entries(readJsonFile(ingestedPath)?.jobs || {}));
  } catch {
    ingested = new Map();
  }
  return ingested;
}
export function noteIngested(jobIds) {
  const jobs = ingestedJobs();
  let changed = false;
  for (const id of jobIds)
    if (id && !jobs.has(id)) {
      jobs.set(String(id), Date.now());
      changed = true;
    }
  if (!changed) return;
  while (jobs.size > maxIngested) jobs.delete(jobs.keys().next().value);
  try {
    writeJsonFile(ingestedPath, { version: 1, jobs: Object.fromEntries(jobs) }, { mode: 0o600 });
  } catch (error) {
    console.warn(`[Studio] Could not record ingested runs: ${error.message}`);
  }
}
export function wasIngested(jobId) {
  return Boolean(jobId && ingestedJobs().has(String(jobId)));
}

/**
 * ComfyUI as a worker (media-paths.js): a finished output is copied over
 * ComfyUI's /view API into Studio media, and only once that copy is safely on
 * disk is ComfyUI asked to delete its own (comfyui/studio_worker). An output that
 * cannot be fetched keeps its ComfyUI address, so nothing is lost.
 */

const workerTokenHeader = () =>
  process.env.STUDIO_WORKER_TOKEN
    ? { "X-Studio-Worker-Token": process.env.STUDIO_WORKER_TOKEN }
    : {};
const missingWorker = new Set();

function comfyRef(url) {
  const value = String(url || "");
  if (!value.startsWith("/comfy/view?")) return null;
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  const type = params.get("type") || "output";
  if (!["output", "temp"].includes(type)) return null;
  const filename = params.get("filename") || "";
  return filename ? { filename, subfolder: params.get("subfolder") || "", type } : null;
}

/** The owner's media folder: the account's own subfolder, or the studio's. */
export function mediaSubfolder(ownerId = "") {
  return ownerId ? accountOutputSubfolder(ownerId) : outputFolderName;
}

/** ComfyUI reuses its numbering once its copies are deleted, so every stored name is made unique. */
function storedName(filename) {
  const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  return `${stamp}-${path.basename(filename)}`;
}

/** One output into Studio media: the rewritten output, and the ComfyUI file to remove, or null when it stays put. */
async function ingestOutput(output, ownerId = "") {
  const ref = comfyRef(output?.url);
  if (!ref) return null;
  const bytes = Buffer.from(await comfy(`/view?${new URLSearchParams(ref)}`, { timeout: 120_000 }));
  const subfolder = mediaSubfolder(ownerId);
  const filename = storedName(ref.filename);
  const file = mediaPath(filename, subfolder);
  if (!file) throw new Error("This output's name cannot be stored.");
  await writeBytesFileAsync(file, bytes, { mode: 0o600 });
  return {
    output: { ...output, ...mediaUrls(filename, subfolder), filename, comfyFilename: ref.filename },
    comfyFile: ref,
  };
}

/**
 * A run's results (each picture with its optional upscale) into Studio media.
 * The returned `comfyFiles` are removed from ComfyUI only after the gallery
 * has the new addresses (removeComfyFiles).
 */
export async function ingestRunResults(results, ownerId = "", { strict = false } = {}) {
  const move = async (output) => {
    if (!output?.url) return { output, comfyFile: null };
    try {
      const moved = await ingestOutput(output, ownerId);
      return moved || { output, comfyFile: null };
    } catch (error) {
      if (strict) throw error;
      console.warn(`[Studio] Keeping an output in ComfyUI: ${error.message}`);
      return { output, comfyFile: null };
    }
  };
  // Every picture and upscale comes across at once; the order of what ComfyUI removes stays the run's order.
  const pairs = await Promise.all(
    results.map((result) =>
      Promise.all([move(result.output), result.upscale ? move(result.upscale) : null]),
    ),
  );
  const comfyFiles = pairs
    .flatMap(([output, upscale]) => [output.comfyFile, upscale?.comfyFile])
    .filter(Boolean);
  const moved = results.map((result, index) => ({
    ...result,
    output: pairs[index][0].output,
    ...(result.upscale ? { upscale: pairs[index][1].output } : {}),
  }));
  return { results: moved, comfyFiles };
}

/**
 * Gallery records recovered from ComfyUI's history (a restart between a run
 * finishing and its delivery) into Studio media, keeping each record's title.
 */
export async function ingestRecords(records) {
  const comfyFiles = [];
  const move = async (output, ownerId) => {
    try {
      const moved = await ingestOutput(output, ownerId);
      if (!moved) return null;
      comfyFiles.push(moved.comfyFile);
      return moved.output;
    } catch (error) {
      console.warn(`[Studio] Keeping a recovered output in ComfyUI: ${error.message}`);
      return null;
    }
  };
  const result = [];
  for (const record of records) {
    const moved = record?.url ? await move(record, record.ownerId || "") : null;
    const next = moved
      ? {
          ...record,
          url: moved.url,
          thumbnailUrl: moved.thumbnailUrl,
          id: moved.url,
          outputName: moved.filename,
        }
      : { ...record };
    if (record?.upscale?.url) {
      const upscale = await move(record.upscale, record.ownerId || "");
      if (upscale)
        next.upscale = {
          ...record.upscale,
          url: upscale.url,
          thumbnailUrl: upscale.thumbnailUrl,
          outputName: upscale.filename,
        };
    }
    result.push(next);
  }
  return { records: result, comfyFiles };
}

/** Asks the Studio worker node to delete files ComfyUI no longer needs. Never throws. */
export async function removeComfyFiles(files) {
  const all = (files || []).filter((file) => file?.filename);
  // The worker takes at most 256 names a call.
  if (all.length > 256) {
    let deleted = 0;
    for (let start = 0; start < all.length; start += 256)
      deleted += (await removeComfyFiles(all.slice(start, start + 256))).deleted;
    return { deleted, skipped: all.length - deleted };
  }
  const list = all;
  if (!list.length) return { deleted: 0, skipped: 0 };
  const backend = currentComfyBackend();
  try {
    const result = await comfy("/studio/worker/delete", {
      method: "POST",
      headers: { "content-type": "application/json", ...workerTokenHeader() },
      body: JSON.stringify({ files: list }),
      timeout: 15_000,
    });
    missingWorker.delete(backend);
    return {
      deleted: Number(result?.deleted || 0),
      skipped: list.length - Number(result?.deleted || 0),
    };
  } catch (error) {
    if (!missingWorker.has(backend)) {
      missingWorker.add(backend);
      console.warn(
        `[Studio] ComfyUI (${backend}) kept its copies: install the Studio worker node (comfyui/studio_worker) to remove them. ${error.status === 404 ? "" : error.message}`.trim(),
      );
    }
    return { deleted: 0, skipped: list.length };
  }
}

/** Staged inputs a run made just for itself; shared content-named inputs stay for other runs. */
export function temporaryInputFiles(body) {
  return (body?.referenceAssets || [])
    .filter((item) => item?.temporary && item.comfyName)
    .map((item) => ({
      type: "input",
      filename: path.basename(String(item.comfyName)),
      subfolder:
        path.dirname(String(item.comfyName)) === "." ? "" : path.dirname(String(item.comfyName)),
    }));
}

export { mediaStorageEnabled, mediaType };
