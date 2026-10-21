import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-worker-models-'));
process.env.STUDIO_ENV_FILE = path.join(scratch, '.env');
process.env.STUDIO_DATA_DIR = scratch;
process.env.STUDIO_COMFY_ROOT = path.join(scratch, 'mirror');
process.env.STUDIO_MODEL_STORAGE = 'worker';
process.env.STUDIO_WORKER_TOKEN = 'worker-test-fixture';
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key];
const { setComfyUrl } = await import('./comfy.js');
const worker = await import('./worker-models.js');
const downloads = await import('./model-downloads.js');

test('worker model transport pins the backend, streams Unicode-labelled weights and refuses redirects', async t => {
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const data = Buffer.from('weight bytes');
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const requests = [];
  let releaseInventory;
  let holdInventory = false;
  let redirect = false;
  let files = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ path: req.url, headers: req.headers });
    assert.equal(req.headers['x-studio-worker-token'], 'worker-test-fixture');
    assert.equal(req.headers.authorization, undefined);
    if (redirect) { res.writeHead(302, { location: '/elsewhere' }); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/studio/worker/models') {
      if (holdInventory) await new Promise(resolve => { releaseInventory = resolve; });
      res.end(JSON.stringify({ ok: true, files, paused: [], space: {}, writable: true }));
    } else if (req.url === '/studio/worker/models/file') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      res.end(JSON.stringify({ ok: true, size: files.length ? data.length : 0, partialBytes: 0, ...(body.action === 'hash' ? { sha256 } : {}) }));
    } else if (req.url.startsWith('/studio/worker/models/upload?')) {
      const received = [];
      for await (const chunk of req) received.push(chunk);
      assert.deepEqual(Buffer.concat(received), data);
      assert.equal(JSON.parse(req.headers['x-studio-model-metadata']).label, 'Model — 品質');
      files = [{ path: 'loras/model.safetensors', size: data.length, mtimeMs: 1 }];
      res.end(JSON.stringify({ ok: true, size: data.length }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  setComfyUrl(url);
  assert.equal(worker.remoteModelsEnabled(), true, 'A mirror mount must not defeat explicit worker mode.');
  await worker.refreshWorkerModels({ force: true });

  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://huggingface.co/')) return new Response(data, { headers: { 'content-length': String(data.length) } });
    return nativeFetch(input, init);
  };
  downloads.startDownload({ id: 'unicode-model', folder: 'loras', file: 'model.safetensors', label: 'Model — 品質', sha256, bytes: data.length, url: 'https://huggingface.co/example/resolve/main/model.safetensors' });
  let finished;
  for (let i = 0; i < 100; i++) {
    finished = downloads.downloadState().recent.find(item => item.id === 'unicode-model');
    if (finished) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(finished?.status, 'done', finished?.error);
  const upload = requests.find(item => item.path.includes('/upload?'));
  assert.equal(new URL(upload.path, url).searchParams.get('sha256'), sha256);
  assert.equal(JSON.parse(upload.headers['x-studio-model-metadata']).source, crypto.createHash('sha256').update('https://huggingface.co/example/resolve/main/model.safetensors').digest('hex'));
  assert.equal(fs.existsSync(path.join(scratch, 'mirror', 'models', 'loras', 'model.safetensors')), false);

  const { matchResources } = await import('./civitai-import.js');
  const matched = await matchResources({ resources: [{ folder: 'loras', file: 'model.safetensors', bytes: data.length, sha256, supported: true }] }, { loras: ['model.safetensors'] }, { foldersFor() { throw new Error('The mirror must never be inspected.'); } });
  assert.equal(matched.resources[0].status, 'installed');
  assert.equal(matched.resources[0].unverified, undefined);

  const express = (await import('express')).default;
  const { registerModelDownloadRoutes } = await import('./model-download-routes.js');
  const app = express(); app.use(express.json());
  registerModelDownloadRoutes(app, { loadComfyContext: async () => ({}) });
  const api = app.listen(0, '127.0.0.1');
  await new Promise(resolve => api.once('listening', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  for (const route of ['manifest', 'manifest/export', 'manifest/verify', 'manifest/restore']) {
    const response = await nativeFetch(`${apiUrl}/api/models/${route}`, { method: route.endsWith('verify') || route.endsWith('restore') ? 'POST' : 'GET' });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /local model storage/);
  }

  holdInventory = true;
  const pending = worker.refreshWorkerModels({ force: true });
  while (!releaseInventory) await new Promise(resolve => setTimeout(resolve, 1));
  setComfyUrl('http://127.0.0.1:1');
  releaseInventory(); await pending;
  assert.equal(worker.workerInventory().writable, false, 'An old response cannot become the new worker inventory.');
  assert.equal(worker.workerCopy({ folder: 'loras', file: 'model.safetensors', workerUrl: url }).size, data.length, 'Pinned operations retain the inventory of their own endpoint.');
  assert.equal(worker.workerCopy({ folder: 'loras', file: 'model.safetensors' }), undefined);
  holdInventory = false;
  redirect = true;
  await assert.rejects(worker.workerModelFile({ folder: 'loras', file: 'model.safetensors', workerUrl: url }));
  assert.equal(requests.some(item => item.path === '/elsewhere'), false);
  delete process.env.STUDIO_WORKER_TOKEN;
  await assert.rejects(worker.workerModelFile({ folder: 'loras', file: 'model.safetensors', workerUrl: url }), /STUDIO_WORKER_TOKEN/);
  delete process.env.STUDIO_MODEL_STORAGE;
  assert.equal(worker.remoteModelsEnabled(), false);
  process.env.STUDIO_MODEL_STORAGE = 'local';
  assert.equal(worker.remoteModelsEnabled(), false);
  process.env.STUDIO_MODEL_STORAGE = 'wroker';
  assert.throws(() => worker.remoteModelsEnabled(), /STUDIO_MODEL_STORAGE/);
  delete process.env.STUDIO_MODEL_STORAGE;
});
