import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-preset-routes-'));
process.env.HEISS_DATA_DIR = dir;
process.env.HEISS_ENV_FILE = path.join(dir, '.env');
process.env.HEISS_LAN = '0';
process.env.HEISS_ENABLE_PRESETS = '1';
delete process.env.CIVITAI_API_TOKEN;
fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify([{ id: '43', name: 'Legacy Landscape', previewUrl: 'https://image.civitai.com/legacy.png', sourceUrl: 'https://civitai.com/images/43', prompt: 'an older saved landscape', negative: '', settings: { seed: '0' }, resources: [], warnings: [], savedAt: '2025-01-01T00:00:00Z' }]));
const { registerPresetRoutes } = await import('./preset-routes.js');
const bytes = Buffer.from('model');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
let online = true;
const image = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#527b8f' } }).png().toBuffer();
const queued = [];
const store = await import('./gallery-store.js');
const references = await import('./reference-assets.js');
let validImage = true;
const app = express();
app.use(express.json());
registerPresetRoutes(app, {
  models: async () => ({ profiles: [], loras: [] }),
  imageRequest: async () => new Response(validImage ? image : Buffer.from('not an image')),
  download: async (spec) => { queued.push(spec); return { status: 'queued' }; },
  json: async (url) => {
    if (!online) throw new Error('offline');
    if (url.startsWith('images?')) return { items: [{ id: 42, url: 'https://image.civitai.com/example.png', type: 'image', meta: { prompt: 'a landscape', seed: 0, civitaiResources: [{ modelVersionId: 17, weight: 0.6 }] } }] };
    return { id: 17, modelId: 9, name: 'V1', model: { name: 'Style', type: 'LORA' }, files: [{ id: 3, type: 'Model', name: 'style.safetensors', hashes: { SHA256: sha256 } }] };
  }
});
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (url, body, method = body ? 'POST' : 'GET', headers = {}) => {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
test.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });

test('the import, save, offline reuse and deletion routes retain the recipe', async () => {
  const imported = await api('/api/presets/import', { url: 'https://civitai.com/images/42' });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.preset.settings.seed, '0');
  assert.equal(imported.body.preset.galleryItemId, 'civitai:42');
  const item = store.gallery.find((item) => item.id === 'civitai:42');
  assert.equal(item.prompt, 'a landscape');
  assert.equal(item.settings.seed, '0');
  assert.equal(item.width, 128);
  assert.equal(item.height, 192);
  assert.deepEqual(item.settings.loras, [{ name: 'style.safetensors', strength: 0.6, enabled: true }]);
  assert.equal(item.civitai.resources[0].versionId, 17);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].file, 'style.safetensors');
  const media = await fetch(base + item.url);
  assert.equal(media.status, 200);
  const full = Buffer.from(await media.arrayBuffer());
  assert.equal((await sharp(full).metadata()).height, 192);
  const { readMediaInfo } = await import('./library.js');
  assert.match((await readMediaInfo(store.importedImageFile(item))).prompt, /a landscape/);
  const clean = Buffer.from(await (await fetch(base + item.url + '?clean=1')).arrayBuffer());
  assert.ok(clean.length < full.length);
  const asset = references.referenceAssetFromGallery({}, item.id);
  const reference = await references.bytesForReference({}, asset.id);
  assert.deepEqual(reference.buffer, full);

  assert.equal(imported.body.preset.resources[0].status, 'missing');
  assert.equal(imported.body.preset.resources[0].spec, undefined);
  const saved = await api('/api/presets', { id: '42', name: 'My Landscape' });
  assert.equal(saved.body.preset.name, 'My Landscape');
  online = false;
  const list = await api('/api/presets');
  assert.equal(list.body.presets.find((item) => item.id === '42').name, 'My Landscape');
  const resolved = await api('/api/presets/resolve', { id: '42' });
  assert.equal(resolved.body.preset.prompt, 'a landscape');
  assert.equal(resolved.body.preset.resources[0].weight, 0.6);
  const current = store.gallery.find((item) => item.id === 'civitai:42');
  store.removeGalleryItems([current]);
  assert.equal((await fetch(base + '/api/presets/42/media')).status, 404);
  assert.equal((await fetch(base + '/api/presets/42/thumbnail')).status, 404);
  assert.equal((await api('/api/presets/resolve', { id: '42' })).status, 400);
  store.addGalleryItems([current]);
  await api('/api/presets/42', null, 'DELETE');
  assert.equal(fs.existsSync(store.importedImageFile(current)), false);

  assert.equal((await api('/api/presets')).body.presets.some((item) => item.id === '42'), false);
});

test('saved recipes migrate into gallery images without a duplicate recipe store', async () => {
  for (let attempt = 0; attempt < 100 && !store.gallery.some((item) => item.id === 'civitai:43'); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  const item = store.gallery.find((item) => item.id === 'civitai:43');
  assert.ok(item);
  assert.equal(item.prompt, 'an older saved landscape');
  assert.equal(item.settings.seed, '0');
  assert.ok(fs.existsSync(store.importedImageFile(item)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')), []);
  await api('/api/presets/43', null, 'DELETE');
});

test('failed image downloads leave no gallery record or model download', async () => {
  online = true;
  validImage = false;
  const before = queued.length;
  try {
    const result = await api('/api/presets/import', { url: 'https://civitai.com/images/42' });
    assert.equal(result.status, 400);
    assert.equal(store.gallery.some((item) => item.id === 'civitai:42'), false);
    assert.equal(queued.length, before);
  } finally { validImage = true; }
});

test('write routes refuse unsigned remote devices', async () => {
  const response = await api('/api/presets', { id: '42', name: 'Denied' }, 'POST', { 'x-forwarded-for': '192.168.1.40' });
  assert.equal(response.status, 403);
});

test('tokens are stored server-side and the status response contains no token material', async () => {
  const token = 'test-only-token-123456789';
  const saved = await api('/api/settings/civitai-token', { token });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.set, true);
  assert.equal(JSON.stringify(saved.body).includes(token), false);
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8').includes(token), true);
  const cleared = await api('/api/settings/civitai-token', { token: '' });
  assert.equal(cleared.body.set, false);
});

test('browser-supplied downloads and paths cannot bypass preview resolution', async () => {
  const response = await api('/api/library/downloads', { id: 'unknown', url: 'http://127.0.0.1/secret', folder: '../' });
  assert.equal(response.status, 400);
  const thumbnail = await fetch(base + '/api/presets/not-an-id/thumbnail');
  assert.equal(thumbnail.status, 400);
});

test('disabled instances refuse every preset, provider download and token route', async () => {
  try {
    for (const enabled of [undefined, '0']) {
      if (enabled === undefined) delete process.env.HEISS_ENABLE_PRESETS;
      else process.env.HEISS_ENABLE_PRESETS = enabled;
      const { mockModelResult, offlineModelResult } = await import('./models.js');
      assert.equal(mockModelResult().features.presets, false);
      assert.equal(offlineModelResult().features.presets, false);
      for (const [method, url] of [
        ['GET', '/api/presets'], ['POST', '/api/presets'], ['POST', '/api/presets/import'],
        ['POST', '/api/presets/resolve'], ['DELETE', '/api/presets/42'], ['GET', '/api/presets/42/thumbnail'], ['GET', '/api/presets/42/media'],
        ['GET', '/api/library/downloads'], ['POST', '/api/library/downloads'], ['POST', '/api/library/downloads/preview'],
        ['GET', '/api/settings/civitai-token'], ['POST', '/api/settings/civitai-token']
      ]) {
        const response = await fetch(base + url, { method });
        assert.equal(response.status, 404, `${method} ${url} with flag ${enabled}`);
      }
    }
  } finally { process.env.HEISS_ENABLE_PRESETS = '1'; }
});
