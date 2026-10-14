import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-preset-routes-'));
process.env.HEISS_DATA_DIR = dir;
process.env.HEISS_ENV_FILE = path.join(dir, '.env');
process.env.HEISS_LAN = '0';
process.env.HEISS_ENABLE_PRESETS = '1';
delete process.env.CIVITAI_API_TOKEN;
const { registerPresetRoutes } = await import('./preset-routes.js');
const bytes = Buffer.from('model');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
let online = true;
const app = express();
app.use(express.json());
registerPresetRoutes(app, {
  models: async () => ({ profiles: [], loras: [] }),
  json: async (url) => {
    if (!online) throw new Error('offline');
    if (url.startsWith('images?')) return { items: [{ id: 42, type: 'image', meta: { prompt: 'a landscape', seed: 0, civitaiResources: [{ modelVersionId: 17, weight: 0.6 }] } }] };
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
  assert.equal(imported.body.preset.resources[0].status, 'missing');
  assert.equal(imported.body.preset.resources[0].spec, undefined);
  const saved = await api('/api/presets', { id: '42', name: 'My Landscape' });
  assert.equal(saved.body.preset.name, 'My Landscape');
  online = false;
  const list = await api('/api/presets');
  assert.equal(list.body.presets[0].name, 'My Landscape');
  const resolved = await api('/api/presets/resolve', { id: '42' });
  assert.equal(resolved.body.preset.prompt, 'a landscape');
  assert.equal(resolved.body.preset.resources[0].weight, 0.6);
  await api('/api/presets/42', null, 'DELETE');
  assert.equal((await api('/api/presets')).body.presets.length, 0);
});

test('write routes enforce the existing admin boundary', async () => {
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
        ['POST', '/api/presets/resolve'], ['DELETE', '/api/presets/42'], ['GET', '/api/presets/42/thumbnail'],
        ['GET', '/api/library/downloads'], ['POST', '/api/library/downloads'], ['POST', '/api/library/downloads/preview'],
        ['GET', '/api/settings/civitai-token'], ['POST', '/api/settings/civitai-token']
      ]) {
        const response = await fetch(base + url, { method });
        assert.equal(response.status, 404, `${method} ${url} with flag ${enabled}`);
      }
    }
  } finally { process.env.HEISS_ENABLE_PRESETS = '1'; }
});
