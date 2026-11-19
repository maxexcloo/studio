import {
  modelLibraryWorker,
  noWorkerMessage,
  normalizeWorkerUrl,
  workerTokenHeader,
} from "./workers.js";

export const dedicatedModelLibrary = () => Boolean(process.env.STUDIO_MODEL_LIBRARY_URL);
export function modelLibraryUrl() {
  if (!dedicatedModelLibrary()) return modelLibraryWorker()?.url || "";
  const url = normalizeWorkerUrl(process.env.STUDIO_MODEL_LIBRARY_URL);
  if (!url) throw new Error("STUDIO_MODEL_LIBRARY_URL needs a plain HTTP(S) address.");
  return url;
}

let cached = { files: [], paused: [], space: {}, writable: false };
let cacheUrl = "";
let refreshedAt = 0;

export function workerInventory() {
  return cacheUrl && cacheUrl === modelLibraryUrl()
    ? cached
    : { files: [], paused: [], space: {}, writable: false };
}
export function installedWorkerFiles({ files }) {
  const result = {};
  for (const { path, size } of files) {
    const slash = path.indexOf("/");
    if (slash < 1 || size <= 0) continue;
    const folder = path.slice(0, slash);
    (result[folder] ||= new Set()).add(path.slice(slash + 1));
  }
  return Object.fromEntries(Object.entries(result).map(([folder, names]) => [folder, [...names]]));
}
export function workerCopy(spec) {
  return (cacheUrl === (spec.workerUrl || modelLibraryUrl()) ? cached.files : []).find(
    (item) => item.path === `${spec.folder}/${spec.file}`,
  );
}

async function request(endpoint, init = {}, workerUrl = modelLibraryUrl()) {
  if (!process.env.STUDIO_WORKER_TOKEN)
    throw new Error("STUDIO_WORKER_TOKEN is required for the worker model library.");
  if (!workerUrl) throw new Error(noWorkerMessage("models"));
  const response = await fetch(`${workerUrl}/studio/worker/models${endpoint}`, {
    ...init,
    headers: { ...init.headers, ...workerTokenHeader() },
    redirect: "error",
    signal: init.signal || AbortSignal.timeout(endpoint === "/file" ? 2 * 60 * 60 * 1000 : 30000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The worker did not return a model-management response. Update its Studio node.",
    );
  }
  if (!response.ok || !result.ok)
    throw new Error(result.error || "The worker model library is unavailable.");
  return result;
}

export async function refreshWorkerModels({
  force = false,
  workerUrl = modelLibraryUrl(),
  signal,
} = {}) {
  // Without a worker that takes models nothing is installed yet, and there is nothing to ask.
  if (!workerUrl) return workerInventory();
  if (!force && cacheUrl === workerUrl && Date.now() - refreshedAt < 5000) return cached;
  const result = await request("", { signal }, workerUrl);
  cached = result;
  cacheUrl = workerUrl;
  refreshedAt = Date.now();
  return cached;
}

export async function workerModelFile(spec, action = "stat", extra = {}) {
  return request(
    "/file",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        folder: spec.folder,
        file: spec.file,
        sha256: spec.sha256 || "",
        ...extra,
        action,
      }),
    },
    spec.workerUrl || modelLibraryUrl(),
  );
}

/** The model library worker's Radiance conversion (studio_worker/convert.py): start, status, cancel or clear. */
export async function workerRadiance(body) {
  return request(
    "/radiance",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    modelLibraryWorker()?.url || "",
  );
}

export async function uploadWorkerModel(spec, response, { offset, total, note, signal, progress }) {
  const query = new URLSearchParams({
    folder: spec.folder,
    file: spec.file,
    offset: String(offset),
    size: String(total),
    sha256: spec.sha256 || "",
  });
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else {
          progress(value.byteLength);
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  try {
    const metadata = JSON.stringify(note).replace(
      /[\u007f-\uffff]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    const result = await request(
      `/upload?${query}`,
      {
        method: "PUT",
        headers: { "X-Studio-Model-Metadata": metadata },
        body,
        duplex: "half",
        signal,
      },
      spec.workerUrl || modelLibraryUrl(),
    );
    await refreshWorkerModels({ force: true, workerUrl: spec.workerUrl || modelLibraryUrl() });
    return result;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
