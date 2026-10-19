import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfy } from "./comfy.js";
import { currentComfyBackend } from "./comfy-backends.js";
import { accountOutputSubfolder } from "./account-ownership.js";
import { dataDir, mediaPath, mediaStorageEnabled, mediaType, mediaUrls } from "./media-paths.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

/*
 * Runs already moved into HEISS media, by job ID. Each stored copy gets a unique
 * name, so a run left in ComfyUI's history (a failed cleanup) can only be told
 * apart from a new one by its job; recovery skips these instead of importing twice.
 */
const ingestedPath = path.join(dataDir, "media-ingested.json");
const maxIngested = 20_000;
let ingested = null;
function ingestedJobs() {
  if (ingested) return ingested;
  try { ingested = new Map(Object.entries(readJsonFile(ingestedPath)?.jobs || {})); } catch { ingested = new Map(); }
  return ingested;
}
export function noteIngested(jobIds) {
  const jobs = ingestedJobs();
  let changed = false;
  for (const id of jobIds) if (id && !jobs.has(id)) { jobs.set(String(id), Date.now()); changed = true; }
  if (!changed) return;
  while (jobs.size > maxIngested) jobs.delete(jobs.keys().next().value);
  try { writeJsonFile(ingestedPath, { version: 1, jobs: Object.fromEntries(jobs) }, { mode: 0o600 }); } catch (error) { console.warn(`[HEISS] Could not record ingested runs: ${error.message}`); }
}
export function wasIngested(jobId) {
  return Boolean(jobId && ingestedJobs().has(String(jobId)));
}

/**
 * ComfyUI as a worker (media-paths.js): a finished output is copied over
 * ComfyUI's /view API into HEISS media, and only once that copy is safely on
 * disk is ComfyUI asked to delete its own (comfyui/heiss_worker). An output that
 * cannot be fetched keeps its ComfyUI address, so nothing is lost.
 */

const workerTokenHeader = () => (process.env.HEISS_WORKER_TOKEN ? { "X-Heiss-Worker-Token": process.env.HEISS_WORKER_TOKEN } : {});
const missingWorker = new Set();

export function comfyFileRef(url) {
  return comfyRef(url);
}

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
  return ownerId ? accountOutputSubfolder(ownerId) : "heiss-ui";
}

/** ComfyUI reuses its numbering once its copies are deleted, so every stored name is made unique. */
function storedName(filename) {
  const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  return `${stamp}-${path.basename(filename)}`;
}

/** One output into HEISS media: the rewritten output, and the ComfyUI file to remove, or null when it stays put. */
export async function ingestOutput(output, ownerId = "") {
  const ref = comfyRef(output?.url);
  if (!ref) return null;
  const bytes = Buffer.from(await comfy(`/view?${new URLSearchParams(ref)}`, { timeout: 120_000 }));
  const subfolder = mediaSubfolder(ownerId);
  const filename = storedName(ref.filename);
  const file = mediaPath(filename, subfolder);
  if (!file) throw new Error("This output's name cannot be stored.");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.part`;
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: "wx" });
    await fs.promises.rename(temporary, file);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return { output: { ...output, ...mediaUrls(filename, subfolder), filename, comfyFilename: ref.filename }, comfyFile: ref };
}

/**
 * A run's results (each picture with its optional upscale) into HEISS media.
 * The returned `comfyFiles` are removed from ComfyUI only after the gallery
 * has the new addresses (removeComfyFiles).
 */
export async function ingestRunResults(results, ownerId = "") {
  const comfyFiles = [];
  const move = async (output) => {
    if (!output?.url) return output;
    try {
      const moved = await ingestOutput(output, ownerId);
      if (!moved) return output;
      comfyFiles.push(moved.comfyFile);
      return moved.output;
    } catch (error) {
      console.warn(`[HEISS] Keeping an output in ComfyUI: ${error.message}`);
      return output;
    }
  };
  const moved = [];
  for (const result of results) {
    moved.push({ ...result, output: await move(result.output), ...(result.upscale ? { upscale: await move(result.upscale) } : {}) });
  }
  return { results: moved, comfyFiles };
}

/**
 * Gallery records recovered from ComfyUI's history (a restart between a run
 * finishing and its delivery) into HEISS media, keeping each record's title.
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
      console.warn(`[HEISS] Keeping a recovered output in ComfyUI: ${error.message}`);
      return null;
    }
  };
  const result = [];
  for (const record of records) {
    const moved = record?.url ? await move(record, record.ownerId || "") : null;
    const next = moved ? { ...record, url: moved.url, thumbnailUrl: moved.thumbnailUrl, id: moved.url, outputName: moved.filename } : { ...record };
    if (record?.upscale?.url) {
      const upscale = await move(record.upscale, record.ownerId || "");
      if (upscale) next.upscale = { ...record.upscale, url: upscale.url, thumbnailUrl: upscale.thumbnailUrl, outputName: upscale.filename };
    }
    result.push(next);
  }
  return { records: result, comfyFiles };
}

/** Asks the HEISS worker node to delete files ComfyUI no longer needs. Never throws. */
export async function removeComfyFiles(files) {
  const all = (files || []).filter((file) => file?.filename);
  // The worker takes at most 256 names a call.
  if (all.length > 256) {
    let deleted = 0;
    for (let start = 0; start < all.length; start += 256) deleted += (await removeComfyFiles(all.slice(start, start + 256))).deleted;
    return { deleted, skipped: all.length - deleted };
  }
  const list = all;
  if (!list.length) return { deleted: 0, skipped: 0 };
  const backend = currentComfyBackend();
  try {
    const result = await comfy("/heiss/worker/delete", {
      method: "POST",
      headers: { "content-type": "application/json", ...workerTokenHeader() },
      body: JSON.stringify({ files: list }),
      timeout: 15_000
    });
    missingWorker.delete(backend);
    return { deleted: Number(result?.deleted || 0), skipped: list.length - Number(result?.deleted || 0) };
  } catch (error) {
    if (!missingWorker.has(backend)) {
      missingWorker.add(backend);
      console.warn(`[HEISS] ComfyUI (${backend}) kept its copies: install the HEISS worker node (comfyui/heiss_worker) to remove them. ${error.status === 404 ? "" : error.message}`.trim());
    }
    return { deleted: 0, skipped: list.length };
  }
}

/** Staged inputs a run made just for itself; shared content-named inputs stay for other runs. */
export function temporaryInputFiles(body) {
  return (body?.referenceAssets || [])
    .filter((item) => item?.temporary && item.comfyName)
    .map((item) => ({ type: "input", filename: path.basename(String(item.comfyName)), subfolder: path.dirname(String(item.comfyName)) === "." ? "" : path.dirname(String(item.comfyName)) }));
}

export { mediaStorageEnabled, mediaType };
