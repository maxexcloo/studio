import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { comfyModelsDir } from './comfy.js';
import { civitaiJson, limitedBody } from './civitai-access.js';
import { civitaiLink, versionResource } from './civitai-import.js';
import { dataDir } from './gallery-store.js';
import { presetsEnabled } from './features.js';
import { hfFetch } from './hf-access.js';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { downloadState, existingCopy, startDownload } from './model-downloads.js';

const sourcesPath = path.join(dataDir, 'model-download-sources.json');
let sources;
try { sources = readJsonFile(sourcesPath); } catch { sources = {}; }
if (!sources || typeof sources !== 'object' || Array.isArray(sources)) sources = {};

export function libraryDownload(id) { return presetsEnabled() && Object.hasOwn(sources, id) ? sources[id] : null; }

function remember(spec) {
  sources[spec.id] = spec;
  writeJsonFile(sourcesPath, sources);
}

const directories = new Set(['checkpoints', 'clip_vision', 'diffusion_models', 'loras', 'text_encoders', 'vae']);

export async function resolveModelLink(value, directory = 'loras', { json = civitaiJson, request = hfFetch } = {}) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Paste a Civitai model or Hugging Face file link.'); }
  if (url.hostname === 'civitai.com') {
    const { id, versionId } = civitaiLink(value, 'models');
    let version;
    if (versionId) version = await json(`model-versions/${versionId}`);
    else {
      const model = await json(`models/${id}`);
      const first = model.modelVersions?.[0];
      if (first) version = { ...first, modelId: model.id, model: { name: model.name, type: model.type } };
    }
    if (!version) throw new Error('This model has no available versions.');
    if (Number(version.modelId) !== id) throw new Error('That version belongs to another model. Check the link.');
    const resource = versionResource(version);
    if (!resource.spec) throw new Error(resource.note);
    return resource.spec;
  }
  if (!directories.has(directory)) throw new Error('Choose a supported model folder.');
  if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.port || url.username || url.password || url.search || url.hash) throw new Error('Use a Civitai model or Hugging Face file link without credentials.');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [owner, repo, operation, revision, ...fileParts] = parts;
  if (!owner || !repo || !['blob', 'resolve'].includes(operation) || !revision || !fileParts.length || parts.some((part) => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) throw new Error('Choose a specific Hugging Face model file.');
  const filePath = fileParts.join('/');
  const file = fileParts.at(-1);
  if (!/\.(safetensors|gguf)$/i.test(file)) throw new Error('Choose a SafeTensors or GGUF file.');
  const response = await request(`https://huggingface.co/api/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/revision/${encodeURIComponent(revision)}?blobs=true`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Hugging Face metadata is unavailable (HTTP ${response.status}). Check the link and your token in Settings.`); }
  const metadata = JSON.parse((await limitedBody(response, 4 * 1024 * 1024)).toString());
  const entry = metadata.siblings?.find((item) => item.rfilename === filePath);
  const sha256 = entry?.lfs?.sha256;
  if (!/^[a-f0-9]{64}$/i.test(sha256 || '') || !/^[a-f0-9]{40}$/i.test(metadata.sha || '')) throw new Error('This file has no verifiable model checksum.');
  return {
    id: `hf:${owner}/${repo}:${metadata.sha}:${filePath}`, file, folder: directory, label: file,
    url: `https://huggingface.co/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${metadata.sha}/${fileParts.map(encodeURIComponent).join('/')}`,
    sha256: sha256.toLowerCase(), bytes: Number(entry.lfs.size || entry.size || 0)
  };
}

function backendConfig(env = process.env) {
  if (!env.HEISS_MODEL_DOWNLOAD_URL) return null;
  const url = new URL(env.HEISS_MODEL_DOWNLOAD_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('The configured model download service address is invalid.');
  if (!env.HEISS_MODEL_DOWNLOAD_TOKEN) throw new Error('The model download service needs its configured token.');
  return { url, token: env.HEISS_MODEL_DOWNLOAD_TOKEN };
}

export function libraryDownloadAccess() {
  try {
    if (backendConfig()) return { available: true, backend: 'control', note: 'Downloads enter the shared library. Normal access is selected in AI Control.' };
    const dir = comfyModelsDir();
    if (dir) {
      fs.accessSync(dir, fs.constants.W_OK);
      return { available: true, backend: 'local', note: 'Downloads enter your ComfyUI model folders.' };
    }
  } catch { /* Read-only mounts and incomplete service configuration need setup. */ }
  return { available: false, backend: '', note: 'Downloads need a writable ComfyUI model folder or a configured AI Control download service.' };
}

/** The endpoint is administrator configuration, never a browser-supplied URL. */
export async function controlRequest(pathname, body, { env = process.env, request = fetch } = {}) {
  const config = backendConfig(env);
  if (!config) throw new Error('The model download service is not configured.');
  const url = new URL(`${config.url.href.replace(/\/$/, '')}/${pathname}`);
  let response;
  try {
    response = await request(url, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch { throw new Error('Couldn’t reach the configured model download service.'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`The model download service answered HTTP ${response.status}. Check its availability and access.`); }
  try { return JSON.parse((await limitedBody(response, 1024 * 1024)).toString()); }
  catch { throw new Error('The model download service returned an unreadable response.'); }
}

const delegated = [];
let pumping = false;
let pendingTimer;

async function pumpControl() {
  if (pumping) return;
  pumping = true;
  const entry = delegated.find((item) => ['queued', 'downloading'].includes(item.status));
  try {
    if (!entry) return;
    if (!entry.jobId) {
      const job = await controlRequest('downloads', { directory: entry.folder, filename: entry.file, url: entry.url });
      if (!/^[a-f0-9]{24}$/.test(job.id || '')) throw new Error('The download service did not return a job.');
      entry.jobId = job.id;
      entry.status = 'downloading';
    }
    const job = await controlRequest(`jobs/${entry.jobId}`);
    entry.stage = String(job.stage || 'Downloading').slice(0, 160);
    if (job.state === 'completed') { entry.status = 'done'; entry.finishedAt = Date.now(); }
    if (job.state === 'failed') { entry.status = 'error'; entry.error = 'The download failed. Check model access and provider credentials in AI Control, then retry.'; entry.finishedAt = Date.now(); }
  } catch (error) {
    if (entry) { entry.status = 'error'; entry.error = error.message; entry.finishedAt = Date.now(); }
  } finally {
    pumping = false;
    if (delegated.some((item) => ['queued', 'downloading'].includes(item.status))) {
      pendingTimer = setTimeout(pumpControl, 1500);
      pendingTimer.unref();
    }
  }
}

export async function startLibraryDownload(spec) {
  if (!presetsEnabled()) throw new Error('Presets & Models is disabled on this instance.');
  if (!libraryDownloadAccess().available) throw new Error(libraryDownloadAccess().note);
  if (!backendConfig()) {
    const file = existingCopy(spec);
    if (file) {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== spec.sha256) throw new Error('A different model already uses this filename. Keep it and choose another file.');
    }
    const state = downloadState();
    const running = [state.active, ...state.queued].find((item) => item?.folder === spec.folder && item.file === spec.file);
    if (running && running.id !== spec.id) throw new Error('A different download already uses this filename.');
  }
  remember(spec);
  if (!backendConfig()) return startDownload(spec);
  const existing = delegated.find((item) => item.id === spec.id && ['queued', 'downloading'].includes(item.status));
  if (existing) return { id: existing.id, status: existing.status };
  if (delegated.filter((item) => ['queued', 'downloading'].includes(item.status)).length >= 32) throw new Error('The download queue is full. Wait for a download to finish.');
  delegated.push({ ...spec, status: 'queued', receivedBytes: 0, totalBytes: 0, error: '', queuedAt: Date.now() });
  void pumpControl();
  return { id: spec.id, status: 'queued' };
}

export function libraryDownloads() {
  const state = downloadState();
  const local = [state.active, ...state.queued, ...state.recent, ...(state.paused || [])].filter((item) => item && libraryDownload(item.id));
  // Keep one current state per resource, including when a failed file is retried.
  const entries = new Map();
  for (const item of [...local].reverse().concat(delegated)) entries.set(item.id, item);
  return [...entries.values()].slice(-64).map(({ url, sha256, jobId, ...item }) => item);
}
