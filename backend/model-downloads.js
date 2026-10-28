import {
  workerInventory,
  workerCopy,
  workerModelFile,
  refreshWorkerModels,
  uploadWorkerModel,
} from "./worker-models.js";
import crypto from "node:crypto";
import path from "node:path";
import { comfyUrl } from "./comfy.js";
// Every catalog request goes through Hugging Face access: token, mirror and proxy (hf-access.js).
import { hfFetch as fetch } from "./hf-access.js";
import { civitaiFetch } from "./civitai-access.js";

/**
 * Streams catalogue files and verified provider files into the worker's model
 * library (worker-models.js). Callers resolve each file on the server and look
 * it up by ID, so a browser request can never point the server at an arbitrary
 * URL or path. One file downloads at a time; the rest wait in order. A stopped
 * download keeps its partial file on the worker, so it resumes where it left off.
 *
 * Resuming asks for the rest only if the file is still the one it started
 * (If-Range with the ETag or Last-Modified it saw), so a file changed on
 * Hugging Face in between starts over instead of being glued onto the old
 * half. The worker checks a finished file against its catalog SHA-256.
 */

const allowedFolders = new Set([
  "text_encoders",
  "vae",
  "diffusion_models",
  "checkpoints",
  "loras",
  "clip_vision",
]);
const allowedHosts = new Set(["civitai.com", "huggingface.co"]);

let queue = [];
let active = null;

// Native download tests inject their transport without fetching real model weights.
let transport = null;
export function setDownloadTransport(fn) {
  transport = fn;
}

function snapshot(entry) {
  if (!entry) return null;
  const { controller, alternatives, url, workerUrl, ...rest } = entry;
  return rest;
}

export function downloadState() {
  return {
    active: snapshot(active),
    queued: queue.map(snapshot),
    recent: recent.map(snapshot),
    paused: pausedDownloads(),
    space: workerInventory().space,
  };
}

/** Half-finished files on the worker that nothing is fetching right now. */
function pausedDownloads() {
  const busy = new Set(
    [active, ...queue].filter(Boolean).map((entry) => `${entry.folder}/${entry.file}`),
  );
  return workerInventory().paused.filter((entry) => !busy.has(`${entry.folder}/${entry.file}`));
}

const recent = [];
function remember(entry) {
  recent.unshift(entry);
  recent.splice(8);
}

/** Refuses anything but a model file from Civitai or Hugging Face for a model folder. */
function checkSpec(spec) {
  if (!allowedFolders.has(spec.folder))
    throw new Error("That file doesn’t belong in a ComfyUI model folder.");
  const name = path.basename(String(spec.file || ""));
  if (!name || name !== spec.file || !/\.(safetensors|gguf)$/i.test(name))
    throw new Error("That isn’t a downloadable model file.");
  const url = new URL(spec.url);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Only Civitai and Hugging Face downloads are supported.");
}

/** The worker's copy of the file, as its last inventory listed it. */
export function existingCopy(spec) {
  return workerCopy(spec)?.size > 0 ? `worker:${spec.folder}/${spec.file}` : "";
}

/**
 * An error that trying again will not fix (full disk, gated file). `browser`:
 * the file needs a Hugging Face login, so the way on is its page, not a retry.
 */
function finalError(message, { browser = false } = {}) {
  const error = new Error(message);
  error.final = true;
  error.browser = browser;
  return error;
}

/** A dropped or refused connection, as undici reports it, rather than an answer from the server. */
export function isNetworkError(error) {
  const code = error?.code || error?.cause?.code || "";
  return (
    error instanceof TypeError ||
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_\w+)$/.test(code) ||
    /terminated|fetch failed|socket|other side closed/i.test(error?.message || "")
  );
}

// A connection that drops mid-file is tried again by itself, waiting a little longer each time.
const retryDelaysMs = [2000, 5000, 12000];

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** The catalog's published SHA-256 for a file, lower case, or "" when it has none. */
function catalogSha256(spec) {
  return /^[0-9a-f]{64}$/i.test(String(spec?.sha256 || ""))
    ? String(spec.sha256).toLowerCase()
    : "";
}

/** Queue one catalog file. Returns the queued entry, or the running one if it is already going. */
export function startDownload(spec) {
  checkSpec(spec);
  const same = (entry) => entry && entry.folder === spec.folder && entry.file === spec.file;
  if (same(active)) return snapshot(active);
  const waiting = queue.find(same);
  if (waiting) return snapshot(waiting);
  const entry = {
    workerUrl: spec.workerUrl || comfyUrl,
    id: spec.id,
    file: spec.file,
    folder: spec.folder,
    label: spec.label || spec.file,
    url: spec.url,
    sha256: catalogSha256(spec),
    status: "queued",
    receivedBytes: 0,
    totalBytes: Number(spec.bytes || 0),
    bytesPerSecond: 0,
    queuedAt: Date.now(),
    error: "",
    // Other builds of the same part, tried in order if this one is gone or gated.
    alternatives: Array.isArray(spec.alternatives) ? spec.alternatives : [],
  };
  queue.push(entry);
  pump();
  return snapshot(entry);
}

export function cancelDownload(id) {
  if (active && active.id === id) {
    active.controller?.abort();
    return snapshot(active);
  }
  const index = queue.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const [entry] = queue.splice(index, 1);
  entry.status = entry.receivedBytes ? "paused" : "canceled";
  remember(entry);
  return snapshot(entry);
}

async function pump() {
  if (active || !queue.length) return;
  active = queue.shift();
  active.controller = new AbortController();
  active.status = "downloading";
  active.startedAt = Date.now();
  const signal = active.controller.signal;
  const attempt = () =>
    transport ? transport(active, signal, { finalError }) : fetchIntoWorker(active, signal);
  try {
    for (let retry = 0; ; retry += 1) {
      try {
        await attempt();
        break;
      } catch (error) {
        if (signal.aborted || !isNetworkError(error) || retry >= retryDelaysMs.length) throw error;
        active.bytesPerSecond = 0;
        active.reconnecting = retry + 1;
        await wait(retryDelaysMs[retry], signal);
      }
    }
    active.status = "done";
  } catch (error) {
    const canceled = signal.aborted;
    active.status = canceled ? "paused" : "error";
    const percent = active.totalBytes
      ? Math.floor((active.receivedBytes / active.totalBytes) * 100)
      : 0;
    active.error = canceled
      ? ""
      : error?.code === "ENOSPC"
        ? "The disk is full. Free some space and try again. The download resumes where it stopped."
        : isNetworkError(error)
          ? `The connection to Hugging Face kept dropping${percent ? ` at ${percent}%` : ""}. Check the internet connection and try again. The download resumes where it stopped.`
          : error.message || "Download failed.";
    // Retrying only helps when the network was the problem.
    active.retryable = canceled || !error?.final;
    active.needsBrowser = Boolean(error?.browser);
    active.unavailable = !canceled && unavailable(error);
  }
  delete active.reconnecting;
  active.finishedAt = Date.now();
  const finished = active;
  active = null;
  delete finished.controller;
  finished.bytesPerSecond = 0;
  const next = fallbackFor(finished);
  if (next) {
    finished.fellBackTo = next.file;
    queue.unshift(next);
  }
  remember(finished);
  pump();
}

/** Gone from its address (404, 410) or gated (401, 403): another build of the part may still be there. */
function unavailable(error) {
  const status =
    Number(error?.status) ||
    Number(/\b(?:HTTP|answered) (\d{3})\b/.exec(error?.message || "")?.[1] || 0);
  return (
    Boolean(error?.browser) || status === 404 || status === 410 || status === 401 || status === 403
  );
}

/**
 * The next catalog build of a part whose download is gone or gated, queued in
 * its place so "Get" still ends with a working file. Builds already on disk
 * count as done; nothing is tried twice.
 */
function fallbackFor(failed) {
  if (failed.status !== "error" || !failed.unavailable) return null;
  const rest = [...(failed.alternatives || [])];
  while (rest.length) {
    const spec = rest.shift();
    const same = (entry) => entry && entry.folder === spec.folder && entry.file === spec.file;
    if (queue.some(same)) return null;
    try {
      checkSpec(spec);
    } catch {
      continue;
    }
    if (existingCopy(spec)) return null;
    return {
      workerUrl: failed.workerUrl,
      // Checked against its own published checksum, like the build it stands in for.
      id: spec.id,
      file: spec.file,
      folder: spec.folder,
      label: spec.label || spec.file,
      url: spec.url,
      sha256: catalogSha256(spec),
      status: "queued",
      receivedBytes: 0,
      totalBytes: Number(spec.bytes || 0),
      bytesPerSecond: 0,
      queuedAt: Date.now(),
      error: "",
      alternatives: rest,
      fallbackFrom: failed.file,
    };
  }
  return null;
}

/** What If-Range needs: a strong ETag, else the Last-Modified date. Nothing for notes from before. */
export function resumeValidator(saved = {}) {
  const etag = String(saved.etag || "");
  if (etag && !/^W\//.test(etag)) return etag;
  return String(saved.lastModified || "");
}

/** Whether a response is for the same file the saved part came from, as far as the server says. */
function sameFile(saved, response) {
  const etag = response.headers.get("etag");
  if (saved.etag && etag) return saved.etag === etag;
  const lastModified = response.headers.get("last-modified");
  if (saved.lastModified && lastModified) return saved.lastModified === lastModified;
  return true;
}

/** Throws away a stopped download's partial file. */
export function discardDownload(spec) {
  const workerUrl =
    [active, ...queue].find((entry) => entry?.id === spec.id)?.workerUrl || comfyUrl;
  cancelDownload(spec.id);
  return workerModelFile({ ...spec, workerUrl }, "discard").then(() =>
    refreshWorkerModels({ force: true, workerUrl }),
  );
}

/** Studio keeps provider credentials; only streamed weights and resume metadata reach the worker. */
async function fetchIntoWorker(entry, signal) {
  await refreshWorkerModels({ force: true, workerUrl: entry.workerUrl });
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256 || ""))
    throw finalError("The worker requires a published SHA-256 checksum.");
  const source = crypto.createHash("sha256").update(entry.url).digest("hex");
  const saved = await workerModelFile(entry);
  if (saved.size > 0) {
    const existing = await workerModelFile(entry, "hash");
    if (existing.sha256 !== entry.sha256.toLowerCase())
      throw finalError(
        "A different model already uses this filename. Keep it or replace it explicitly.",
      );
    entry.receivedBytes = existing.size;
    entry.totalBytes = existing.size;
    entry.already = true;
    return;
  }
  const bound = saved.note?.source === source && saved.note?.sha256 === entry.sha256.toLowerCase();
  let offset = bound ? saved.partialBytes || 0 : 0;
  const note = saved.note || {};
  const request = new URL(entry.url).hostname === "civitai.com" ? civitaiFetch : fetch;
  const validator = resumeValidator(note);
  const headers = offset
    ? { range: `bytes=${offset}-`, ...(validator ? { "if-range": validator } : {}) }
    : {};
  let response = await request(entry.url, { redirect: "follow", signal, headers });
  if (
    offset &&
    (response.status === 416 || (response.status === 206 && !sameFile(note, response)))
  ) {
    await response.body?.cancel().catch(() => {});
    offset = 0;
    response = await request(entry.url, { redirect: "follow", signal });
  }
  if (response.status === 200) offset = 0;
  if (!response.ok || !response.body || (offset && response.status !== 206)) {
    await response.body?.cancel().catch(() => {});
    const error = new Error(`The model provider answered HTTP ${response.status}.`);
    error.status = response.status;
    error.final = [401, 403, 404, 410].includes(response.status);
    throw error;
  }
  const length = Number(response.headers.get("content-length") || 0);
  const total = length ? offset + length : Number(entry.totalBytes || 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > 256 * 1024 ** 3) {
    await response.body.cancel();
    throw finalError("The provider did not supply a model size for the worker transfer.");
  }
  if (offset) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== total) {
      await response.body.cancel();
      throw finalError("The provider returned an inconsistent resume range.");
    }
  }
  entry.totalBytes = total;
  entry.receivedBytes = offset;
  let started = Date.now();
  let bytes = 0;
  const result = await uploadWorkerModel(entry, response, {
    offset,
    total,
    signal,
    note: {
      source,
      id: entry.id,
      label: entry.label,
      etag: response.headers.get("etag") || note.etag || "",
      lastModified: response.headers.get("last-modified") || note.lastModified || "",
    },
    progress(size) {
      entry.receivedBytes += size;
      bytes += size;
      const elapsed = Date.now() - started;
      if (elapsed >= 1000) {
        entry.bytesPerSecond = (bytes * 1000) / elapsed;
        started = Date.now();
        bytes = 0;
      }
    },
  });
  entry.receivedBytes = result.size;
  entry.totalBytes = result.size;
}
