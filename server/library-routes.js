// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Library's routes (UI-PATTERNS › Library), administrators only:
 *
 *   GET  /api/library/imports                 import history, newest first
 *   POST /api/library/imports {url}           import a Civitai image or model link, or a Hugging Face link
 *   GET  /api/library/imports/:id             one import, its files checked in full
 *   POST /api/library/imports/:id/download    Download Missing ({indices} for chosen files)
 *   POST /api/library/imports/:id/folder      {index, folder}: where a Hugging Face file goes
 *   POST /api/library/imports/:id/draft-profile  {index?}: draft a checkpoint's profile and guide (again, after a failure)
 *   GET  /api/library/items                   installed and catalogued LoRAs and models, with provenance
 *
 * Imports follow the Presets & Civitai Imports deployment switch, as the saved images do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { modelFolders } from './comfy.js';
import { civitaiJson } from './civitai-access.js';
import { modelChecksum } from './civitai-import.js';
import { presetsEnabled } from './features.js';
import { hfFetch } from './hf-access.js';
import { catalogueKinds } from './library-catalogue.js';
import { startLibraryDownload } from './library-downloads.js';
import { createImportEngine, importStore, publicImport } from './library-imports.js';
import { detectLink, resolveCivitaiModel, resolveHuggingFace } from './library-sources.js';
import { downloadState } from './model-downloads.js';
import { requireLocal } from './route-access.js';
import { refreshWorkerModels, remoteModelsEnabled, workerInventory, workerModelFile } from './worker-models.js';

const subfolders = { diffusion_models: ['diffusion_models', 'unet'], text_encoders: ['text_encoders', 'clip'] };

/** Whether a wanted file is installed: by checksum when known (or `verify`), else by name and size. */
export async function inspectInstalled(want, { verify = false, foldersFor = modelFolders } = {}) {
  if (!want?.file || !Object.hasOwn(catalogueKinds, want.folder)) return { status: 'missing' };
  const names = subfolders[want.folder] || [want.folder];
  const sized = (size) => !want.bytes || Math.abs(size - want.bytes) <= 2048;
  if (remoteModelsEnabled()) {
    await refreshWorkerModels();
    const file = workerInventory().files.find((item) => names.some((folder) => item.path === `${folder}/${want.file}`));
    if (!file) return { status: 'missing' };
    if (!want.sha256) return { status: 'installed', unverified: true };
    if (verify) {
      const hash = (await workerModelFile({ folder: file.path.split('/')[0], file: want.file }, 'hash')).sha256;
      return hash === want.sha256 ? { status: 'installed' } : { status: 'conflict' };
    }
    return sized(file.size) ? { status: 'installed', unverified: true } : { status: 'conflict' };
  }
  for (const dir of foldersFor(want.folder, names)) {
    const file = path.join(dir, want.file);
    let stat;
    try { stat = await fs.promises.stat(file); } catch { continue; }
    if (!stat.isFile()) continue;
    if (!want.sha256) return { status: 'installed', unverified: true };
    const hash = await modelChecksum(file, { verify });
    if (hash) return hash === want.sha256 ? { status: 'installed' } : { status: 'conflict' };
    return sized(stat.size) ? { status: 'installed', unverified: true } : { status: 'conflict' };
  }
  return { status: 'missing' };
}

const itemFields = ['kind', 'title', 'version', 'baseModel', 'families', 'role', 'triggers', 'strength', 'note', 'nsfw', 'links', 'source', 'origin', 'sha256', 'bytes', 'aiDrafted'];

/**
 * Installed files (`installed`: {folder: names}) joined with the catalogue (`entries`), plus
 * catalogue entries that aren't installed. `loraInfo` fills a LoRA's role and base from its file.
 */
export function libraryItems({ installed = {}, entries = {}, loraInfo = {} }) {
  const items = new Map();
  const add = (folder, file, isInstalled) => {
    const key = `${folder}/${file}`;
    const entry = entries[key] || {};
    const info = folder === 'loras' ? loraInfo[file] || {} : {};
    const item = items.get(key) || { key, folder, file, kind: catalogueKinds[folder], installed: false };
    for (const field of itemFields) if (entry[field] !== undefined && entry[field] !== '') item[field] = entry[field];
    if (!item.title && info.title) item.title = info.title;
    if (!item.role && info.role) item.role = info.role;
    if (!item.baseModel && info.base) item.baseModel = info.base;
    if ((!item.families || !item.families.length) && info.families?.length) item.families = info.families;
    if ((!item.triggers || !item.triggers.length) && info.triggers?.length) item.triggers = info.triggers;
    if (!item.note && info.note) item.note = info.note;
    if (entry.description) item.description = String(entry.description).slice(0, 600);
    if (!item.links?.civitaiCom && !item.links?.hf && info.sourceUrl) item.links = { ...(item.links || {}), civitaiCom: info.sourceUrl };
    item.installed ||= isInstalled;
    items.set(key, item);
  };
  for (const [folder, names] of Object.entries(installed)) for (const name of names || []) if (typeof name === 'string' && name) add(folder, name, true);
  for (const key of Object.keys(entries)) {
    const [folder, ...rest] = key.split('/');
    if (!items.has(key)) add(folder, rest.join('/'), false);
  }
  return [...items.values()].sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
}

/**
 * `presets` is what registerPresetRoutes returns (importImage, resolvePreset); `installed()` the
 * files ComfyUI lists per folder; `loraInfo(names)` the LoRA metadata (lora-info.js);
 * `catalogue()` the catalogue store.
 */
export function registerLibraryRoutes(app, { presets, installed, loraInfo, catalogue, json = civitaiJson, hfRequest = hfFetch, inspect = inspectInstalled, downloads = downloadState, startDownload = startLibraryDownload, store = importStore(), draftProfile = null }) {
  const engine = createImportEngine({
    store, detect: detectLink, inspect, downloads, startDownload, catalogue: { edit: (...args) => catalogue().edit(...args) }, draftProfile,
    resolveCivitai: (url) => resolveCivitaiModel(url, { json }),
    resolveHf: (url) => resolveHuggingFace(url, { request: hfRequest }),
    importImage: (url) => presets.importImage(url),
    resolvePreset: (id, options) => presets.resolvePreset(id, options)
  });
  const by = (req) => String(req.studioAccount?.id || req.studioAccount?.username || '');
  const route = (handler, { imports = true } = {}) => async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (imports && !presetsEnabled()) { res.status(404).json({ ok: false, error: 'Imports are off for this deployment.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  };

  app.get('/api/library/imports', route(async (_req, res) => {
    res.json({ ok: true, imports: (await engine.list()).map(publicImport) });
  }));
  app.post('/api/library/imports', route(async (req, res) => {
    const record = await engine.create(String(req.body?.url || ''), { by: by(req), origin: 'ui' });
    // A failed resolve is still a record (with its reason), so it answers like any other.
    res.json({ ok: true, import: publicImport(record) });
  }));
  app.get('/api/library/imports/:id', route(async (req, res) => {
    const record = await engine.open(req.params.id);
    if (!record) { res.status(404).json({ ok: false, error: 'That import is gone.' }); return; }
    res.json({ ok: true, import: publicImport(record) });
  }));
  app.post('/api/library/imports/:id/download', route(async (req, res) => {
    const indices = Array.isArray(req.body?.indices) ? req.body.indices.filter((value) => Number.isSafeInteger(value) && value >= 0) : null;
    const result = await engine.downloadMissing(req.params.id, { indices, by: by(req) });
    res.json({ ok: true, import: publicImport(result.record), queued: result.queued, failures: result.failures });
  }));
  app.post('/api/library/imports/:id/folder', route(async (req, res) => {
    res.json({ ok: true, import: publicImport(await engine.setFolder(req.params.id, Number(req.body?.index), String(req.body?.folder || ''))) });
  }));
  app.post('/api/library/imports/:id/draft-profile', route(async (req, res) => {
    const index = Number.isSafeInteger(req.body?.index) && req.body.index >= 0 ? req.body.index : null;
    res.json({ ok: true, import: publicImport(await engine.draft(req.params.id, { by: by(req), index })) });
  }));
  app.get('/api/library/items', route(async (_req, res) => {
    const files = await installed().catch(() => ({}));
    const info = await loraInfo(files.loras || []).catch(() => ({}));
    res.json({ ok: true, items: libraryItems({ installed: files, entries: catalogue().entries({ throttleMs: 5000 }), loraInfo: info }) });
  }, { imports: false }));
  return engine;
}
