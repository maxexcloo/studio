import { comfyUrl } from './comfy.js';

let cached = { files: [], paused: [], space: {}, writable: false };
let cacheUrl = '';
let refreshedAt = 0;

export function remoteModelsEnabled() {
  const mode = process.env.STUDIO_MODEL_STORAGE;
  if (mode && !['local', 'worker'].includes(mode)) throw new Error('STUDIO_MODEL_STORAGE must be local or worker.');
  return mode === 'worker';
}
export function workerInventory() { return cacheUrl === comfyUrl ? cached : { files: [], paused: [], space: {}, writable: false }; }
export function workerCopy(spec) { return (cacheUrl === (spec.workerUrl || comfyUrl) ? cached.files : []).find((item) => item.path === `${spec.folder}/${spec.file}`); }

async function request(endpoint, init = {}, workerUrl = comfyUrl) {
  if (!process.env.STUDIO_WORKER_TOKEN) throw new Error('STUDIO_WORKER_TOKEN is required when STUDIO_MODEL_STORAGE=worker.');
  const headers = new Headers(init.headers);
  headers.set('X-Studio-Worker-Token', process.env.STUDIO_WORKER_TOKEN || '');
  const response = await fetch(`${workerUrl}/studio/worker/models${endpoint}`, { ...init, headers, redirect: 'error', signal: init.signal || AbortSignal.timeout(endpoint === '/file' ? 2 * 60 * 60 * 1000 : 30000) });
  let result;
  try { result = await response.json(); } catch { throw new Error('The worker did not return a model-management response. Update its Studio node.'); }
  if (!response.ok || !result.ok) throw new Error(result.error || 'The worker model library is unavailable.');
  return result;
}

export async function refreshWorkerModels({ force = false, workerUrl = comfyUrl } = {}) {
  if (!remoteModelsEnabled()) return null;
  if (!force && cacheUrl === workerUrl && Date.now() - refreshedAt < 5000) return cached;
  const result = await request('', {}, workerUrl);
  cached = result;
  cacheUrl = workerUrl;
  refreshedAt = Date.now();
  return cached;
}

export async function workerModelFile(spec, action = 'stat') {
  return request('/file', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folder: spec.folder, file: spec.file, sha256: spec.sha256 || '', action }) }, spec.workerUrl || comfyUrl);
}

export async function uploadWorkerModel(spec, response, { offset, total, note, signal, progress }) {
  const query = new URLSearchParams({ folder: spec.folder, file: spec.file, offset: String(offset), size: String(total), sha256: spec.sha256 || '' });
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else { progress(value.byteLength); controller.enqueue(value); }
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  try {
    const metadata = JSON.stringify(note).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const result = await request(`/upload?${query}`, { method: 'PUT', headers: { 'X-Studio-Model-Metadata': metadata }, body, duplex: 'half', signal }, spec.workerUrl || comfyUrl);
    await refreshWorkerModels({ force: true, workerUrl: spec.workerUrl || comfyUrl });
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}
