import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { civitaiFetch, civitaiJson, civitaiTokenStatus, limitedBody, saveCivitaiToken } from './civitai-access.js';
import { importCivitaiImage, matchResources, versionResource } from './civitai-import.js';
import { dataDir } from './gallery-store.js';
import { presetsEnabled } from './features.js';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { libraryDownload, libraryDownloadAccess, libraryDownloads, resolveModelLink, startLibraryDownload } from './library-downloads.js';
import { requireAdmin } from './route-access.js';

const presetsPath = path.join(dataDir, 'presets.json');
const previewsDir = path.join(dataDir, 'preset-previews');
let presets;
try { presets = readJsonFile(presetsPath); } catch { presets = []; }
if (!Array.isArray(presets)) presets = [];
const imported = new Map();

function summary(preset) {
  const { previewUrl, ...rest } = preset;
  return { ...rest, thumbnailUrl: previewUrl || fs.existsSync(path.join(previewsDir, `${preset.id}.webp`)) ? `/api/presets/${preset.id}/thumbnail` : '' };
}

export function registerPresetRoutes(app, { models, json = civitaiJson, imageRequest = civitaiFetch }) {
  const route = (handler, admin = false) => async (req, res) => {
    if (!presetsEnabled()) { res.status(404).json({ ok: false, error: 'Presets & Models is disabled on this instance.' }); return; }
    if (admin && !requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  };
  const matched = async (preset) => summary(await matchResources(preset, await models()));
  const lookup = (id) => /^[1-9]\d*$/.test(id) ? imported.get(id) || presets.find((item) => item.id === id) : null;

  app.get('/api/presets', route(async (_req, res) => {
    res.json({ ok: true, presets: presets.map(summary), downloads: libraryDownloadAccess() });
  }));
  app.post('/api/presets/import', route(async (req, res) => {
    const preset = await importCivitaiImage(req.body?.url, { json });
    imported.set(preset.id, preset);
    if (imported.size > 50) imported.delete(imported.keys().next().value);
    res.json({ ok: true, preset: await matched(preset) });
  }, true));
  app.post('/api/presets/resolve', route(async (req, res) => {
    const preset = lookup(String(req.body?.id || ''));
    if (!preset) throw new Error('Import or select a preset first.');
    res.json({ ok: true, preset: await matched(preset) });
  }));
  app.post('/api/presets', route(async (req, res) => {
    const id = String(req.body?.id || '');
    const preset = lookup(id);
    if (!preset) throw new Error('Import a preset before saving it.');
    const name = String(req.body?.name || preset.name).trim().slice(0, 120);
    if (!name) throw new Error('Give the preset a name.');
    if (presets.length >= 500 && !presets.some((item) => item.id === id)) throw new Error('Your preset library is full. Remove a preset first.');
    const saved = { ...preset, name, savedAt: new Date().toISOString() };
    // Keep a local thumbnail, stripped of source metadata, for saved presets.
    if (preset.previewUrl && !fs.existsSync(path.join(previewsDir, `${id}.webp`))) {
      try {
        const response = await imageRequest(preset.previewUrl, { signal: AbortSignal.timeout(30000) }, { media: true });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Preview unavailable'); }
        const buffer = await sharp(await limitedBody(response, 15 * 1024 * 1024), { limitInputPixels: 40000000 }).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        fs.mkdirSync(previewsDir, { recursive: true });
        fs.writeFileSync(path.join(previewsDir, `${id}.webp`), buffer);
      } catch { /* Saving settings remains useful when the image CDN is unavailable. */ }
    }
    const next = [saved, ...presets.filter((item) => item.id !== id)];
    writeJsonFile(presetsPath, next);
    presets = next;
    res.json({ ok: true, preset: await matched(saved) });
  }, true));
  app.delete('/api/presets/:id', route(async (req, res) => {
    const next = presets.filter((item) => item.id !== req.params.id);
    writeJsonFile(presetsPath, next);
    presets = next;
    // Keep the harmless cached thumbnail: an in-flight viewer may still be using it.
    res.json({ ok: true });
  }, true));
  app.get('/api/presets/:id/thumbnail', route(async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) throw new Error('Unknown preview.');
    const file = path.join(previewsDir, `${req.params.id}.webp`);
    if (fs.existsSync(file)) { res.type('webp').send(fs.readFileSync(file)); return; }
    const preset = lookup(req.params.id);
    if (!preset?.previewUrl) { res.sendStatus(404); return; }
    const response = await imageRequest(preset.previewUrl, { signal: AbortSignal.timeout(30000) }, { media: true });
    if (!response.ok) { await response.body?.cancel(); res.sendStatus(404); return; }
    const buffer = await sharp(await limitedBody(response, 15 * 1024 * 1024), { limitInputPixels: 40000000 }).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    res.type('webp').send(buffer);
  }));
  app.get('/api/library/downloads', route(async (_req, res) => {
    res.json({ ok: true, downloads: libraryDownloads(), access: libraryDownloadAccess() });
  }));
  app.post('/api/library/downloads/preview', route(async (req, res) => {
    const spec = await resolveModelLink(req.body?.url, req.body?.folder, { json });
    const { url, sha256, ...file } = spec;
    imported.set(`download:${spec.id}`, spec);
    if (imported.size > 50) imported.delete(imported.keys().next().value);
    res.json({ ok: true, file });
  }, true));
  app.post('/api/library/downloads', route(async (req, res) => {
    let spec;
    if (req.body?.versionId) {
      const versionId = Number(req.body.versionId);
      if (!Number.isSafeInteger(versionId) || versionId < 1) throw new Error('Choose a valid model version.');
      spec = versionResource(await json(`model-versions/${versionId}`)).spec;
    } else {
      const id = String(req.body?.id || '');
      spec = imported.get(`download:${id}`) || libraryDownload(id);
    }
    if (!spec) throw new Error('Preview a supported model before downloading it.');
    res.json({ ok: true, download: await startLibraryDownload(spec) });
  }, true));
  app.get('/api/settings/civitai-token', route(async (_req, res) => res.json({ ok: true, ...civitaiTokenStatus() })));
  app.post('/api/settings/civitai-token', route(async (req, res) => res.json({ ok: true, ...saveCivitaiToken(req.body?.token) }), true));
}
