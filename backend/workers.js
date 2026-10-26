import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { currentDataDir } from "./data-dir.js";

/**
 * Studio's ComfyUI workers: none, one or many, each with a stable id, a name,
 * an address and what it runs. A fork module (AGENTS.md): upstream code keeps
 * its one `comfyUrl`, which follows the default worker (comfy.js).
 *
 * Where workers come from, in order:
 * 1. The deployment: `STUDIO_WORKERS` (a JSON list). These are locked:
 *    Settings shows them and changes them nowhere.
 * 2. Studio's own list, `workers.json` in the data folder, which
 *    administrators edit in Settings › Workers. It is empty until first saved.
 */

/** What a worker can be asked to do. `models` receives model downloads (STUDIO_MODEL_STORAGE=worker). */
export const workerCapabilities = [
  { id: "image", label: "Image", description: "Image generation, and provider-backed cloud runs." },
  { id: "video", label: "Video", description: "Local video generation." },
  { id: "upscale", label: "Upscale", description: "Upscaling finished images and videos." },
  { id: "models", label: "Model Library", description: "Receives model and LoRA downloads." },
];
const capabilityIds = new Set(workerCapabilities.map((item) => item.id));

// Read on each call: tests and the first start may set the folder after this loads.
const dataDir = () => currentDataDir();
export const workersFile = () => path.join(dataDir(), "workers.json");

const maxWorkers = 32;

export class WorkerConfigError extends Error {}

/** A plain HTTP(S) origin (and path) for a worker: "pc.local:8188", a bare port or a full URL. */
export function normalizeWorkerUrl(value = "") {
  let text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{2,5}$/.test(text)) text = `127.0.0.1:${text}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.hostname
    )
      return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const validId = (id) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id);

/**
 * One worker as given (by the deployment or an administrator), checked and
 * tidied: `taken` holds ids already in use, so a new one gets its own.
 */
export function normalizeWorker(raw, { taken = new Set(), where = "Worker" } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new WorkerConfigError(`${where} must be an object with a name, url and capabilities.`);
  const url = normalizeWorkerUrl(raw.url);
  if (!url)
    throw new WorkerConfigError(
      `${where} needs a plain HTTP(S) address, such as http://127.0.0.1:8188.`,
    );
  const name = String(raw.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const list = Array.isArray(raw.capabilities)
    ? raw.capabilities
    : typeof raw.capabilities === "string"
      ? raw.capabilities.split(/[\s,]+/)
      : [];
  const capabilities = workerCapabilities
    .map((item) => item.id)
    .filter((id) => list.map((entry) => String(entry).trim().toLowerCase()).includes(id));
  const unknown = list
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry) => entry && !capabilityIds.has(entry));
  if (unknown.length)
    throw new WorkerConfigError(
      `${where} has an unknown capability: ${unknown.join(", ")}. Use ${[...capabilityIds].join(", ")}.`,
    );
  if (!capabilities.length)
    throw new WorkerConfigError(
      `${where} needs at least one capability (${[...capabilityIds].join(", ")}).`,
    );
  let id = String(raw.id || "")
    .trim()
    .toLowerCase();
  if (id && !validId(id))
    throw new WorkerConfigError(
      `${where} has an invalid id: use up to 40 lower-case letters, digits, - and _.`,
    );
  if (id && taken.has(id))
    throw new WorkerConfigError(`${where} reuses the id “${id}”. Each worker needs its own.`);
  if (!id) {
    const base = slug(name) || "worker";
    id = base;
    while (taken.has(id) || !validId(id))
      id = `${base.slice(0, 33)}-${crypto.randomBytes(3).toString("hex")}`;
  }
  taken.add(id);
  return { id, name: name || defaultName(capabilities), url, capabilities };
}

function defaultName(capabilities) {
  if (capabilities.includes("image") && capabilities.includes("video")) return "Worker";
  if (capabilities.includes("image")) return "Image Worker";
  if (capabilities.includes("video")) return "Video Worker";
  if (capabilities.includes("upscale")) return "Upscale Worker";
  return "Worker";
}

/** The deployment's workers, from `STUDIO_WORKERS`. */
export function deploymentWorkers(environment = process.env) {
  const text = String(environment.STUDIO_WORKERS || "").trim();
  if (text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new WorkerConfigError(
        'STUDIO_WORKERS must be a JSON list of workers, such as [{"name":"Images","url":"http://comfy:8188","capabilities":["image","upscale"]}].',
      );
    }
    if (!Array.isArray(parsed))
      throw new WorkerConfigError("STUDIO_WORKERS must be a JSON list of workers.");
    if (parsed.length > maxWorkers)
      throw new WorkerConfigError(`STUDIO_WORKERS lists more than ${maxWorkers} workers.`);
    const taken = new Set();
    return {
      variable: "STUDIO_WORKERS",
      workers: parsed.map((raw, index) =>
        normalizeWorker(raw, { taken, where: `STUDIO_WORKERS item ${index + 1}` }),
      ),
    };
  }
  return { variable: "", workers: [] };
}

let cache = null;
const listeners = new Set();

/** Studio's own saved list, or null before an administrator first saves one. */
function readSaved() {
  try {
    const raw = readJsonFile(workersFile());
    if (!raw || !Array.isArray(raw.workers)) return null;
    const taken = new Set();
    const workers = [];
    for (const [index, item] of raw.workers.entries()) {
      try {
        workers.push(normalizeWorker(item, { taken, where: `Saved worker ${index + 1}` }));
      } catch (error) {
        console.warn(`[Studio] Skipped a saved worker: ${error.message}`);
      }
    }
    return workers;
  } catch {
    return null;
  }
}

function build(environment = process.env) {
  const deployment = deploymentWorkers(environment);
  const saved = readSaved();
  const locked = new Set(deployment.workers.map((worker) => worker.id));
  const own = (saved || [])
    .filter((worker) => !locked.has(worker.id))
    .map((worker) => ({ ...worker, source: "studio" }));
  return {
    variable: deployment.variable,
    workers: [
      ...deployment.workers.map((worker) => ({ ...worker, source: "deployment", locked: true })),
      ...own.map((worker) => ({ ...worker, locked: false })),
    ],
  };
}

function state() {
  if (!cache) cache = build();
  return cache;
}

/** Every worker in list order, each with its source and whether the deployment locks it. */
export const listWorkers = () => state().workers;
export const workerById = (id) => state().workers.find((worker) => worker.id === id) || null;
export const workerHas = (id, capability) =>
  Boolean(workerById(id)?.capabilities.includes(capability));
const workersWith = (capability) =>
  state().workers.filter((worker) => worker.capabilities.includes(capability));
/** The variable the deployment defines workers with, if any. */
export const workersVariable = () => state().variable;

/**
 * The worker the single `comfyUrl` follows: the first that runs images,
 * else the first of any kind. Local conveniences (the output folder, Manager
 * restarts with their progress) belong to it.
 */
export function defaultWorker() {
  const workers = state().workers;
  return workers.find((worker) => worker.capabilities.includes("image")) || workers[0] || null;
}
export const defaultWorkerId = () => defaultWorker()?.id || "";

/** The worker model downloads go to (worker-models.js): the first with Model Library, else the default. */
export function modelLibraryWorker() {
  return workersWith("models")[0] || null;
}

/** Called with the new list whenever it changes (comfy.js keeps its address in step). */
export function onWorkersChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed() {
  cache = null;
  const workers = listWorkers();
  for (const listener of listeners) {
    try {
      listener(workers);
    } catch {
      /* one listener never blocks another */
    }
  }
}

/** Reads the configuration again (tests). */
export function reloadWorkers() {
  changed();
  return listWorkers();
}

/**
 * Saves Studio's own workers (the editable ones) in the order given. Locked
 * workers can't be changed or removed here; ids stay the same across edits.
 */
export function saveWorkers(list) {
  if (!Array.isArray(list)) throw new WorkerConfigError("Send the list of workers.");
  const locked = listWorkers().filter((worker) => worker.locked);
  const lockedIds = new Set(locked.map((worker) => worker.id));
  const editable = list.filter((item) => !lockedIds.has(String(item?.id || "").toLowerCase()));
  for (const item of list) {
    const lockedWorker = locked.find(
      (worker) => worker.id === String(item?.id || "").toLowerCase(),
    );
    if (
      lockedWorker &&
      (normalizeWorkerUrl(item.url) !== lockedWorker.url ||
        (item.name !== undefined && String(item.name).trim() !== lockedWorker.name))
    ) {
      throw new WorkerConfigError(
        `${lockedWorker.name} comes from the deployment configuration. Change it there.`,
      );
    }
  }
  if (locked.length + editable.length > maxWorkers)
    throw new WorkerConfigError(`Studio supports up to ${maxWorkers} workers.`);
  const taken = new Set(lockedIds);
  const workers = editable.map((raw, index) =>
    normalizeWorker(raw, { taken, where: `Worker ${index + 1}` }),
  );
  writeJsonFile(workersFile(), { version: 1, workers });
  changed();
  return listWorkers();
}

/** The capability a profile needs: local video runs on a video worker; images and provider-backed runs on an image worker. */
export function capabilityForProfile(profile) {
  return profile?.kind === "video" && profile.family !== "grok" ? "video" : "image";
}

/**
 * Which worker runs a job that needs `capability`. With several, an online one
 * that already has the model wins, then an online one with the `prefers`
 * capabilities (Smart upscale), then the first online one in list order; with
 * none online, the first capable one (its own error then says why). Never a
 * worker without the capability, never a cloud fallback, and no GPU changes.
 *
 * `online(id)` and `hasModel(id)` answer true, false or null (not known yet).
 */
export function pickWorker(
  capability,
  { workers = listWorkers(), prefers = [], online = () => null, hasModel = () => null } = {},
) {
  const capable = workers.filter((worker) => worker.capabilities.includes(capability));
  if (!capable.length) return null;
  const score = (worker) => {
    const up = online(worker.id);
    return [
      up === false ? 0 : up === true ? 2 : 1,
      hasModel(worker.id) === true ? 1 : 0,
      prefers.filter((item) => worker.capabilities.includes(item)).length,
    ];
  };
  let best = capable[0];
  let bestScore = score(best);
  for (const worker of capable.slice(1)) {
    const next = score(worker);
    const better = next.findIndex((value, index) => value !== bestScore[index]);
    if (better >= 0 && next[better] > bestScore[better]) {
      best = worker;
      bestScore = next;
    }
  }
  return best;
}

/** "No worker can run videos": what a refused job says, with where to add one. */
export function noWorkerMessage(capability) {
  const what =
    {
      image: "run images",
      video: "run videos",
      upscale: "upscale",
      models: "receive model downloads",
    }[capability] || "run this";
  return listWorkers().length
    ? `No worker can ${what}. An administrator can add the capability in Settings › Workers.`
    : "No workers are set up. An administrator can add one in Settings › Workers.";
}
