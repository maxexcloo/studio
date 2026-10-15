import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { civitaiFetch, civitaiJson, civitaiTokenStatus, limitedBody, saveCivitaiToken } from './civitai-access.js';
import { importCivitaiImage, matchResources, versionResource } from './civitai-import.js';
import { dataDir, deleteGalleryFiles, filterVisibleGallery, gallery, importedImageFile, setGallery } from './gallery-store.js';
import { downloadPresetImage, presetFromGallery, refreshImportedItem } from './civitai-library.js';
import { stripMetadata } from './metadata-strip.js';
import { presetsEnabled } from './features.js';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { libraryDownload, libraryDownloadAccess, libraryDownloads, resolveModelLink, startLibraryDownload } from './library-downloads.js';
import { getFileVideoPoster, getFileVideoPreview, sendVideoPreview } from './video-previews.js';
import { requireAdmin, requireLocal } from './route-access.js';

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

export function registerPresetRoutes(app, { models, json = civitaiJson, imageRequest = civitaiFetch, download = startLibraryDownload }) {
  const route = (handler, write = false) => async (req, res) => {
    if (!presetsEnabled()) { res.status(404).json({ ok: false, error: 'Image & Model Library is disabled on this instance.' }); return; }
    if (write && !requireLocal(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  };
  const matched = async (preset, catalogue) => {
    const resolved = await matchResources(preset, catalogue || await models());
    resolved.downloadWarnings = (resolved.downloadWarnings || []).filter((warning) => resolved.resources.some((resource) => resource.status === 'missing' && warning.startsWith(`${resource.name}:`)));
    refreshImportedItem(resolved);
    return summary(resolved);
  };
  const forgetLegacy = (id) => {
    if (!presets.some((item) => item.id === id)) return;
    presets = presets.filter((item) => item.id !== id);
    writeJsonFile(presetsPath, presets);
    writeJsonFile(presetsPath, presets);
    if (/^[1-9]\d*$/.test(id)) fs.rmSync(path.join(previewsDir, `${id}.webp`), { force: true });
  };
  const images = () => filterVisibleGallery(gallery).filter((item) => item.civitai && importedImageFile(item)).map(presetFromGallery);
  let migration;
  const migrate = () => {
    if (migration) return;
    migration = (async () => {
      for (const preset of [...presets].filter((item) => !item.galleryItemId && item.previewUrl)) {
        try { await downloadPresetImage(preset, { models, imageRequest, download }); forgetLegacy(preset.id); }
        catch { /* Keep an unavailable saved recipe so its image can be retried. */ }
      }
    })();
  };
  const lookup = (id) => /^[1-9]\d*$/.test(id) ? images().find((item) => item.id === id) || presets.find((item) => item.id === id) : null;

  app.get('/api/presets', route(async (_req, res) => {
    migrate();
    const catalogue = await models();
    res.json({ ok: true, presets: await Promise.all([...images(), ...presets.filter((item) => !images().some((image) => image.id === item.id))].map((item) => matched(item, catalogue))), downloads: libraryDownloadAccess() });
  }));
  app.post('/api/presets/import', route(async (req, res) => {
    const source = await importCivitaiImage(req.body?.url, { json });
    const preset = await downloadPresetImage({ ...source, savedAt: new Date().toISOString() }, { models, imageRequest, download });
    forgetLegacy(preset.id);
    if (imported.size > 50) imported.delete(imported.keys().next().value);
    res.json({ ok: true, preset: await matched(preset) });
  }, true));
  app.post('/api/presets/resolve', route(async (req, res) => {
    const preset = lookup(String(req.body?.id || ''));
    if (!preset) throw new Error('Import or select an image first.');
    res.json({ ok: true, preset: await matched(preset) });
  }));
  app.post('/api/presets', route(async (req, res) => {
    const id = String(req.body?.id || '');
    const preset = lookup(id);
    if (!preset) throw new Error('Import a preset before saving it.');
    const name = String(req.body?.name || preset.name).trim().slice(0, 120);
    if (!name) throw new Error('Give the preset a name.');
    const saved = await downloadPresetImage({ ...preset, name, savedAt: preset.savedAt || new Date().toISOString() }, { models, imageRequest, download });
    forgetLegacy(id);
    res.json({ ok: true, preset: await matched(saved) });
  }, true));
  app.delete('/api/presets/:id', route(async (req, res) => {
    const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
    if (item) { deleteGalleryFiles([item]); setGallery(gallery.filter((entry) => entry !== item)); }
    forgetLegacy(req.params.id);
    res.json({ ok: true });
  }, true));
  app.get('/api/presets/:id/media', route(async (req, res) => {
    const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
    const file = importedImageFile(item);
    if (!file || !fs.existsSync(file)) { res.sendStatus(404); return; }
    if (item.type === 'video') { res.type('mp4').sendFile(file); return; }
    res.type('png');
    const buffer = fs.readFileSync(file);
    res.send(req.query.clean === '1' ? stripMetadata(buffer).buffer : buffer);
  }));
  app.get('/api/presets/:id/video-preview', route(async (req, res) => {
    const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
    const file = importedImageFile(item);
    if (item?.type !== 'video' || !file || !fs.existsSync(file)) { res.sendStatus(404); return; }
    sendVideoPreview(req, res, await getFileVideoPreview(file));
  }));
  app.get('/api/presets/:id/thumbnail', route(async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) throw new Error('Unknown preview.');
    const file = path.join(previewsDir, `${req.params.id}.webp`);
    const item = gallery.find((item) => item.id === `civitai:${req.params.id}`);
    const local = importedImageFile(item);
    if (local && fs.existsSync(local)) {
      if (item.type === 'video') { res.type('jpeg').sendFile(await getFileVideoPoster(local), { dotfiles: 'allow' }); return; }
      const buffer = await sharp(local).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      res.type('webp').send(buffer); return;
    }
    if (presets.some((entry) => entry.id === req.params.id) && fs.existsSync(file) && !item) { res.type('webp').send(fs.readFileSync(file)); return; }
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
  app.post('/api/settings/civitai-token', route(async (req, res) => { if (!requireAdmin(req, res)) return; res.json({ ok: true, ...saveCivitaiToken(req.body?.token) }); }));
}
