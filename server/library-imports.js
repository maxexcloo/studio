// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Library imports as durable job records (design §2.3): one file per import,
 * `<data>/library/imports/<id>.json`, indexed when first read; the 500 newest are kept. A record
 * that was still resolving when Studio stopped is marked failed on the next start (the
 * job-recovery pattern), so nothing waits forever.
 *
 * The engine resolves a link (library-sources.js), matches its files against what is installed,
 * grades it (library-grade.js), writes catalogue entries for LoRAs and queues Download Missing
 * through the worker model API (library-downloads.js → model-downloads.js → worker-models.js).
 * Nothing downloads on its own. Checkpoint imports are recorded only; profile drafts come later.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { currentDataDir } from './data-dir.js';
import { readJsonFile, removeJsonFile, writeJsonFile } from './json-store.js';
import { gradeImport, presetGrade } from './library-grade.js';
import { catalogueKinds } from './library-catalogue.js';

export const importLimit = 500;
const idPattern = /^imp-[a-z0-9]{6,40}$/;
const states = new Set(['resolving', 'needs-files', 'downloading', 'ready', 'failed', 'cancelled']);
const folders = new Set(Object.keys(catalogueKinds));
const now = () => new Date().toISOString();

/** A new record id: time-ordered, never reused. */
export function importId(at = Date.now()) {
  return `imp-${at.toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/** The record store over one data folder; the only writer of library/imports. */
export function createImportStore({ dataDir = currentDataDir(), limit = importLimit, log = console } = {}) {
  const dir = path.join(dataDir, 'library', 'imports');
  let index = null;

  function load() {
    if (index) return index;
    index = new Map();
    let names = [];
    try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')); } catch { /* No imports yet. */ }
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!idPattern.test(id)) continue;
      try {
        const record = readJsonFile(path.join(dir, name));
        if (record?.id !== id || !states.has(record.state)) continue;
        // Interrupted while resolving: say so instead of resolving forever.
        if (record.state === 'resolving') {
          record.state = 'failed';
          record.error = 'Studio restarted before this import finished. Import the link again.';
          record.updatedAt = now();
          writeJsonFile(path.join(dir, name), record);
        }
        index.set(id, record);
      } catch (error) { log.warn?.(`[library] Skipped unreadable import ${name}: ${error.message}`); }
    }
    prune();
    return index;
  }

  /** Newest first. */
  const list = () => [...load().values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));

  function prune() {
    const sorted = [...index.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id));
    for (const record of sorted.slice(limit)) {
      index.delete(record.id);
      try { removeJsonFile(path.join(dir, `${record.id}.json`)); } catch { /* Gone already. */ }
    }
  }

  function put(record) {
    if (!idPattern.test(record?.id || '')) throw new Error('An import needs a valid id.');
    if (!states.has(record.state)) throw new Error(`Unknown import state ${record.state}.`);
    load();
    record.updatedAt = now();
    fs.mkdirSync(dir, { recursive: true });
    writeJsonFile(path.join(dir, `${record.id}.json`), record);
    index.set(record.id, record);
    prune();
    return record;
  }

  const get = (id) => idPattern.test(String(id || '')) ? load().get(String(id)) || null : null;
  return { dir, list, get, put, reload: () => { index = null; return load(); } };
}

const stores = new Map();
/** The shared store for a data folder. */
export function importStore(options = {}) {
  const dataDir = options.dataDir || currentDataDir();
  if (!stores.has(dataDir)) stores.set(dataDir, createImportStore({ ...options, dataDir }));
  return stores.get(dataDir);
}

/* ---------------------------------------------------------------- Views */

/** A record as the browser and MCP see it: no download specs. */
export function publicImport(record) {
  if (!record) return null;
  const { pendingEntries: _pending, ...rest } = record;
  return { ...rest, resources: (record.resources || []).map(({ spec, ...resource }) => resource) };
}

/** The import's state from its resources. */
export function importState(record) {
  if (record.state === 'failed' || record.state === 'cancelled' || record.state === 'resolving') return record.state;
  const resources = record.resources || [];
  if (resources.some((resource) => resource.status === 'downloading')) return 'downloading';
  const required = resources.filter((resource) => !resource.optional);
  const counted = required.length ? required : resources.filter((resource) => resource.status === 'installed');
  if (counted.length && counted.every((resource) => resource.status === 'installed')) return 'ready';
  return 'needs-files';
}

/** Grade a model-file import (no prompt to grade) or a saved image (its preset). */
export function gradeRecord(record, preset = null) {
  if (preset) return presetGrade(preset);
  return gradeImport({ resources: (record.resources || []).map((resource) => ({ ...resource, name: resource.name || resource.want?.file })) });
}

/* --------------------------------------------------------------- Engine */

/**
 * The import engine. Dependencies are injected so tests run without providers or workers:
 *   resolveCivitai(url), resolveHf(url)   library-sources.js resolvers
 *   inspect(want, {verify})               {status: installed|missing|conflict, unverified?}
 *   downloads()                           model-downloads.js downloadState()
 *   startDownload(spec)                   library-downloads.js startLibraryDownload
 *   catalogue                             library-catalogue.js store (edit)
 *   importImage(url)                      a saved image: the matched preset (preset-routes.js)
 *   resolvePreset(id, {verify})           a saved image again, matched
 */
export function createImportEngine({ store = importStore(), resolveCivitai, resolveHf, detect, inspect, downloads, startDownload, catalogue, importImage, resolvePreset }) {
  /** Each resource's status from the files and the download queue, then the grade and state. */
  async function refresh(record, { verify = false } = {}) {
    if (record.state === 'failed' || record.state === 'resolving') return record;
    if (record.input.kind === 'civitai-image') {
      const preset = record.input.presetId ? await resolvePreset(record.input.presetId, { verify }).catch(() => null) : null;
      if (preset) {
        record.grade = presetGrade(preset);
        record.title = preset.name || record.title;
        record.resources = (preset.resources || []).map((resource) => ({ role: ['checkpoints', 'diffusion_models'].includes(resource.folder) ? 'checkpoint' : catalogueKinds[resource.folder] || 'model', name: resource.name, version: resource.version || '', want: { file: resource.file || '', folder: resource.folder || '', sha256: resource.sha256 || '', bytes: resource.bytes || 0, source: { provider: 'civitai', url: resource.sourceUrl || '' } }, status: resource.status === 'installed' ? 'installed' : resource.status === 'conflict' ? 'conflict' : resource.unavailable ? 'unavailable' : resource.status === 'unsupported' ? 'unsupported' : 'missing', ...(resource.unavailable ? { unavailable: resource.unavailable } : {}), ...(resource.unverified ? { unverified: true } : {}), ...(resource.nameOnly ? { nameOnly: true } : {}), note: resource.note || '' }));
        record.state = importState(record);
      }
      return record;
    }
    const state = downloads();
    const running = new Map([state.active, ...(state.queued || [])].filter(Boolean).map((item) => [item.id, item]));
    const recent = new Map((state.recent || []).map((item) => [item.id, item]));
    for (const resource of record.resources) {
      const download = resource.downloadId ? running.get(resource.downloadId) : null;
      if (download) {
        resource.status = 'downloading';
        resource.progress = { receivedBytes: download.receivedBytes || 0, totalBytes: download.totalBytes || resource.want.bytes || 0 };
        continue;
      }
      delete resource.progress;
      if (resource.downloadId && recent.get(resource.downloadId)?.status === 'error') resource.downloadError = recent.get(resource.downloadId).error || 'The download stopped.';
      const found = await inspect(resource.want, { verify }).catch(() => ({ status: 'missing' }));
      if (found.status === 'installed') {
        resource.status = 'installed';
        delete resource.downloadError;
        if (found.unverified) resource.unverified = true; else delete resource.unverified;
      } else if (resource.unavailable) resource.status = 'unavailable';
      else if (!resource.spec) resource.status = 'unsupported';
      else resource.status = found.status === 'conflict' ? 'conflict' : 'missing';
    }
    record.grade = gradeRecord(record);
    record.state = importState(record);
    return record;
  }

  /** Catalogue entries for every LoRA in the import, with the previous values kept for Undo. */
  function writeCatalogue(record, entries, by) {
    const keys = [];
    for (const { resource, patch } of entries) {
      if (!patch || resource.want.folder !== 'loras' || !resource.want.file) continue;
      const key = `loras/${resource.want.file}`;
      try { catalogue.edit(key, patch, { by, origin: record.origin === 'chat' ? 'chat' : 'import', provenance: true }); keys.push(key); }
      catch (error) { record.warnings = [...(record.warnings || []), `Couldn’t write the catalogue entry for ${resource.want.file}: ${error.message}`]; }
    }
    return keys;
  }

  /** Resolve one link into a new record, written before and after resolving. */
  async function create(url, { by = '', origin = 'ui' } = {}) {
    const kind = detect(url);
    const record = store.put({ id: importId(), createdAt: now(), by: String(by || ''), origin, input: { kind, url: String(url).trim() }, state: 'resolving', title: '', resources: [], offers: [], grade: { value: 'partial', reasons: ['Resolving'], missingFields: [] }, results: { catalogueKeys: [] } });
    try {
      if (kind === 'civitai-image') {
        const preset = await importImage(record.input.url);
        Object.assign(record, { title: preset.name, input: { ...record.input, presetId: preset.id }, results: { ...record.results, galleryItemId: preset.galleryItemId || '' }, links: { civitaiCom: preset.sourceUrl, civitaiRed: String(preset.sourceUrl || '').replace('://civitai.com/', '://civitai.red/') }, baseModel: preset.baseModel || '', state: 'needs-files' });
        await refresh(record);
        return store.put(record);
      }
      const resolved = kind === 'civitai-model' ? await resolveCivitai(record.input.url) : await resolveHf(record.input.url);
      Object.assign(record, {
        title: resolved.title, version: resolved.version || '', baseModel: resolved.baseModel || '', modelType: resolved.type || '', nsfw: resolved.nsfw ?? null, links: resolved.links || {},
        resources: resolved.resources.map((resource) => ({ ...resource, status: 'missing' })), state: 'needs-files'
      });
      await refresh(record);
      const entries = kind === 'civitai-model' ? [{ resource: record.resources[0], patch: resolved.entry }]
        : record.resources.map((resource) => ({ resource, patch: resolved.entryFor?.(resource) }));
      // A repository's many optional files are catalogued when one is downloaded, not all up front.
      record.results.catalogueKeys = writeCatalogue(record, entries.filter(({ resource }) => !resource.optional), by);
      if (kind !== 'civitai-model') record.pendingEntries = Object.fromEntries(entries.filter(({ resource, patch }) => resource.optional && patch).map(({ resource, patch }) => [resource.want.file, patch]));
      return store.put(record);
    } catch (error) {
      record.state = 'failed';
      record.error = error.message || 'Couldn’t import that link.';
      record.grade = { value: 'partial', reasons: [record.error], missingFields: [] };
      return store.put(record);
    }
  }

  /** Queue the missing files (or the chosen ones by index); unavailable files are never queued. */
  async function downloadMissing(id, { indices = null, by = '' } = {}) {
    const record = store.get(id);
    if (!record) throw new Error('That import is gone. Import the link again.');
    if (record.input.kind === 'civitai-image') throw new Error('Saved images download their files from Images.');
    await refresh(record);
    const chosen = record.resources.filter((resource, index) => indices ? indices.includes(index) : !resource.optional);
    const queue = chosen.filter((resource) => ['missing'].includes(resource.status) && resource.spec && !resource.unavailable);
    if (!queue.length) throw new Error(chosen.some((resource) => resource.unavailable) ? 'Those files can’t be downloaded.' : 'Nothing is missing.');
    const failures = [];
    for (const resource of queue) {
      try {
        const download = await startDownload(resource.spec);
        resource.downloadId = download?.id || resource.spec.id;
        delete resource.downloadError;
        const pending = record.pendingEntries?.[resource.want.file];
        if (pending) {
          record.results.catalogueKeys = [...new Set([...(record.results.catalogueKeys || []), ...writeCatalogue(record, [{ resource, patch: pending }], by)])];
          delete record.pendingEntries[resource.want.file];
        }
      } catch (error) { resource.downloadError = error.message; failures.push(`${resource.want.file}: ${error.message}`); }
    }
    await refresh(record);
    store.put(record);
    if (failures.length === queue.length) throw new Error(failures[0]);
    return { record, queued: queue.length - failures.length, failures };
  }

  /** Change where a Hugging Face file goes before it downloads (its folder was only a guess). */
  async function setFolder(id, index, folder) {
    const record = store.get(id);
    const resource = record?.resources?.[index];
    if (!resource) throw new Error('That file isn’t in this import.');
    if (record.input.kind === 'civitai-model' || record.input.kind === 'civitai-image') throw new Error('Civitai files choose their folder on their own.');
    if (!folders.has(folder)) throw new Error('Choose a supported model folder.');
    if (resource.status === 'downloading' || resource.status === 'installed') throw new Error('That file is already on its way.');
    resource.want = { ...resource.want, folder };
    resource.role = catalogueKinds[folder];
    resource.folderGuessed = false;
    if (resource.spec) resource.spec = { ...resource.spec, folder };
    await refresh(record);
    return store.put(record);
  }

  /** Every record, newest first, each brought up to date cheaply (names and sizes only). */
  async function list({ limit = 100 } = {}) {
    const records = store.list().slice(0, limit);
    const changed = [];
    for (const record of records) {
      const before = JSON.stringify([record.state, record.grade, record.resources.map((resource) => resource.status)]);
      await refresh(record).catch(() => record);
      if (JSON.stringify([record.state, record.grade, record.resources.map((resource) => resource.status)]) !== before) changed.push(record);
    }
    for (const record of changed) store.put(record);
    return records;
  }

  /** One record, its files checked in full. */
  async function open(id) {
    const record = store.get(id);
    if (!record) return null;
    await refresh(record, { verify: true });
    return store.put(record);
  }

  return { create, list, open, refresh, downloadMissing, setFolder };
}
