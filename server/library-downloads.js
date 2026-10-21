import { remoteModelsEnabled, workerInventory, workerModelFile, refreshWorkerModels } from './worker-models.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { comfyModelsDir } from './comfy.js';
import { civitaiJson, isCivitaiHost, limitedBody } from './civitai-access.js';
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
  if (isCivitaiHost(url.hostname)) {
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

export function libraryDownloadAccess() {
  if (remoteModelsEnabled()) return { available: workerInventory().writable, backend: "worker", note: workerInventory().writable ? "Downloads enter the worker’s model library." : "Connect a writable Studio worker model library before downloading." };
  try {
    const dir = comfyModelsDir();
    if (dir) {
      fs.accessSync(dir, fs.constants.W_OK);
      return { available: true, backend: 'local', note: 'Downloads enter your ComfyUI model folders.' };
    }
  } catch { /* A read-only mount needs setup. */ }
  return { available: false, backend: '', note: 'Downloads need a writable ComfyUI model folder.' };
}

export async function startLibraryDownload(spec) {
  if (!presetsEnabled()) throw new Error('Presets & Models is disabled on this instance.');
  await refreshWorkerModels({ force: true });
  if (!/^[a-f0-9]{64}$/i.test(spec.sha256 || '')) throw new Error('This model has no valid provider SHA-256 checksum. Preview its source again.');
  if (!libraryDownloadAccess().available) throw new Error(libraryDownloadAccess().note);
  {
    const file = existingCopy(spec);
    if (file) {
      let digest;
      if (remoteModelsEnabled()) digest = (await workerModelFile(spec, 'hash')).sha256;
      else {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        digest = hash.digest('hex');
      }
      if (digest !== spec.sha256) throw new Error('A different model already uses this filename. Keep it and choose another file.');
    }
    const state = downloadState();
    const running = [state.active, ...state.queued].find((item) => item?.folder === spec.folder && item.file === spec.file);
    if (running && running.id !== spec.id) throw new Error('A different download already uses this filename.');
  }
  remember(spec);
  return startDownload(spec);
}

export function libraryDownloads() {
  const state = downloadState();
  const local = [state.active, ...state.queued, ...state.recent, ...(state.paused || [])].filter((item) => item && libraryDownload(item.id));
  // Keep one current state per resource, including when a failed file is retried.
  const entries = new Map();
  for (const item of [...local].reverse()) entries.set(item.id, item);
  return [...entries.values()].slice(-64).map(({ url, sha256, ...item }) => item);
}
