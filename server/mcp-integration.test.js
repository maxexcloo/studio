import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { registerMcpRoutes } from './mcp.js';

const mediaKey = 'fixture-media-credential';
const controlKey = 'fixture-control-credential';
const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#537c90' } }).png().toBuffer();
const imageProfile = {
  id: 'fixture-image', kind: 'image', family: 'flux', label: 'Fixture Image', model: 'fixture-image.safetensors', workflow: 'fixture-image', ready: true,
  description: 'Use natural language for subject, composition and lighting.',
  capabilities: { negativePrompt: true, cfg: true, denoise: true, sampler: true, scheduler: true },
  constraints: { cfg: { min: 0, max: 20 }, denoise: { min: 0, max: 1 } },
  defaults: { width: 768, height: 512, count: 8, steps: 8, cfg: 0 },
  options: { loras: ['fixture-effect.safetensors'], samplers: ['euler'], schedulers: ['simple'] },
  mediaInputs: [{ id: 'reference', kind: 'image', min: 0, max: 1, required: false }]
};
const videoProfile = { ...imageProfile, id: 'fixture-video', kind: 'video', label: 'Fixture Video', family: 'minimax_h3', model: 'fixture-video', workflow: 'fixture-video', defaults: { width: 1280, height: 720, count: 1, steps: 12 }, mediaInputs: [] };

async function fixture(t, { environment: extra = {}, dataDir: existingDir, enabled = true } = {}) {
  const dataDir = existingDir || fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-'));
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  const requests = [];
  const controlRequests = [];
  const jobs = new Map();
  const assets = new Map();
  const submitted = [];
  const downloads = [];
  let failAfter = Infinity;
  let dropAck = false;
  let completeOnSubmit = false;
  let jobLookupFails = false;
  let deduplicateUploads = false;
  let profiles = [structuredClone(imageProfile), structuredClone(videoProfile), { ...imageProfile, id: 'not-ready', ready: false }];
  let base;
  app.use('/api', (req, _res, next) => { requests.push({ path: req.path, method: req.method, body: req.body }); next(); });
  app.get('/api/access/status', (_req, res) => res.json({ signedIn: true }));
  app.get('/api/models', (_req, res) => res.json({ profiles, defaults: { imageModel: imageProfile.id, videoModel: videoProfile.id } }));
  app.post('/api/generate', (req, res) => {
    if (submitted.length >= failAfter) return res.status(503).json({ error: 'Fixture backend offline' });
    submitted.push(req.body);
    const id = req.body.clientJobId || `fixture-job-${submitted.length}`;
    jobs.set(id, { id, status: completeOnSubmit ? 'done' : 'running', kind: req.body.kind, outputs: completeOnSubmit ? [{ url: '/comfy/view?filename=immediate.png' }] : [], settings: req.body });
    res.json({ jobId: id, status: 'queued' });
  });
  app.get('/api/jobs/:id', (req, res) => jobLookupFails ? res.status(503).json({ error: 'Fixture result retrieval offline' }) : res.json(jobs.get(req.params.id) || { status: 'missing' }));
  app.post('/api/jobs/:id/cancel', (req, res) => { const job = jobs.get(req.params.id); if (job) job.status = 'cancelled'; res.json({ ok: true }); });
  app.get('/api/gallery', (_req, res) => res.json({ items: [...jobs.values()].flatMap(job => job.gallery ?? (job.status === 'done' && !job.privateVault ? job.outputs.map((output, index) => ({ id: `${job.id}:${index}`, jobId: job.id, index, status: 'done', type: job.kind, ...output })) : [])), hasMore: false, nextCursor: '' }));
  app.get('/api/gallery/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    res.json({ items: !job || job.privateVault ? [] : job.gallery ?? (job.status === 'done' ? job.outputs.map((output, index) => ({ jobId: job.id, index, status: 'done', type: job.kind, ...output })) : []) });
  });
  app.post('/api/reference-assets/upload', async (req, res) => {
    for await (const _chunk of req) { /* Consume the multipart body. */ }
    const asset = { id: deduplicateUploads ? 'fixture-shared-asset' : `fixture-asset-${assets.size + 1}`, name: 'reference.png', source: 'upload', mime: 'image/png', privacyDomain: 'gallery', url: '/fixture-reference.png' };
    assets.set(asset.id, asset);
    res.json({ asset });
  });
  app.get('/api/reference-assets', (_req, res) => res.json({ items: [...assets.values()], hasMore: false }));
  app.get('/api/reference-assets/:id', (req, res) => res.json({ asset: assets.get(req.params.id) }));
  app.get('/comfy/view', (req, res) => { downloads.push(req.originalUrl); res.type('png').send(png); });
  const environment = { ...(enabled ? { HEISS_MCP_API_KEY: mediaKey } : {}), MCP_PUBLIC_URL: 'https://studio.example.test', ...extra };
  await registerMcpRoutes(app, {
    baseUrl: () => base,
    dataDir,
    environment,
    fetchImpl: async (url, init) => {
      if (String(url).startsWith('http://fixture-control.invalid')) {
        controlRequests.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
        return Response.json({ runtimes: {}, signature: 'fixture-preview', id: 'fixture-operation', state: 'running' });
      }
      const response = await fetch(url, init);
      if (dropAck && new URL(url).pathname === '/api/generate') { dropAck = false; throw new Error('Fixture acknowledgement interrupted'); }
      return response;
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close()));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (!existingDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    assets, base, controlRequests, dataDir, downloads, environment, jobs, requests, submitted,
    failAfter: count => { failAfter = count; },
    dropAck: () => { dropAck = true; },
    completeOnSubmit: () => { completeOnSubmit = true; },
    jobLookupFails: value => { jobLookupFails = value; },
    deduplicateUploads: () => { deduplicateUploads = true; },
    profiles: value => { profiles = value; },
    client: async (user = 'alice', key = mediaKey) => {
      const client = new Client({ name: 'heiss-integration-fixture', version: '1.0.0' }, { capabilities: {} });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}`, ...(user ? { 'x-bento-user-id': user } : {}) } } }));
      return client;
    }
  };
}

function data(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content || []) if (item.type === 'text') { try { return JSON.parse(item.text); } catch { /* Result text can include a download link. */ } }
  return result;
}
async function call(client, name, args = {}) { return client.callTool({ name, arguments: args }); }
async function failure(client, name, args = {}) {
  let result;
  try { result = await call(client, name, args); } catch (error) { assert.ok(error instanceof Error); return; }
  assert.equal(result.isError, true, `Expected ${name} to refuse the request`);
}
async function generate(client, args = {}) {
  await call(client, 'Models', { profile_id: args.profile_id || imageProfile.id });
  return data(await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A landscape'], ...args }));
}
function jobId(result) { assert.ok(result.jobs?.length); return result.jobs[0].job_id; }
function links(result) { return (result.content || []).filter(item => item.type === 'resource_link').map(item => item.uri); }
function localLink(f, publicLink) { const url = new URL(publicLink); assert.equal(url.origin, 'https://studio.example.test'); assert.match(url.pathname, /^\/mcp\/results\//); return f.base + url.pathname; }

const adminEnvironment = { CONTROL_API_KEY: 'fixture-private-control', CONTROL_MCP_API_KEY: controlKey, CONTROL_URL: 'http://fixture-control.invalid' };

test('native MCP is absent without credentials and refuses missing or incorrect authentication', async t => {
  const disabled = await fixture(t, { enabled: false });
  assert.equal((await fetch(`${disabled.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  const f = await fixture(t);
  for (const authorization of ['', 'Bearer invalid-fixture-key']) {
    const response = await fetch(`${f.base}/mcp`, { method: 'POST', headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(f.requests.length, 0);
});

test('media and administrator credentials discover only their own friendly tools and cannot cross scopes', async t => {
  const f = await fixture(t, { environment: adminEnvironment });
  const media = await f.client();
  const tools = (await media.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['Cancel', 'Generate', 'Models', 'Result', 'Reuse', 'Status', 'Upload']);
  for (const tool of tools) assert.ok(tool.title || tool.annotations?.title, `${tool.name} needs a readable title`);
  await failure(media, 'GPUStatus');
  const admin = await f.client('administrator', controlKey);
  assert.deepEqual((await admin.listTools()).tools.map(tool => tool.name).sort(), ['Apply', 'GPUStatus', 'Operation', 'Preview', 'Workloads']);
  await failure(admin, 'Generate', { profile_id: imageProfile.id, prompts: ['A landscape'] });
  assert.equal(f.submitted.length, 0);
  await call(admin, 'GPUStatus');
  assert.equal(f.controlRequests.length, 1);
  await failure(admin, 'Apply', { allocation: [], signature: 'fixture-preview' });
  assert.equal(f.controlRequests.length, 1);
  await call(admin, 'Apply', { allocation: [], signature: 'fixture-preview', confirmed: true });
  assert.deepEqual(f.controlRequests.at(-1).body, { allocation: [], replace: true, signature: 'fixture-preview' });
});

test('Models uses only this studio, filters readiness and kind, and returns detailed capabilities on request', async t => {
  const f = await fixture(t);
  const client = await f.client('previously-unknown-user');
  const compact = data(await call(client, 'Models', { kind: 'image' }));
  assert.deepEqual(compact.profiles.map(profile => profile.id), [imageProfile.id]);
  assert.equal(compact.profiles[0].options, undefined);
  const detail = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  assert.deepEqual(detail.options.loras, imageProfile.options.loras);
  assert.deepEqual(detail.constraints, imageProfile.constraints);
  assert.equal(detail.defaults.count, 1);
  assert.equal(detail.prompting, null);
  await failure(client, 'Models', { profile_id: 'another-studio-profile' });
});

test('Generate requires this account to read the selected full guide, not discovery or another profile', async t => {
  const f = await fixture(t);
  const alice = await f.client('alice');
  const args = { profile_id: imageProfile.id, prompts: ['A landscape'] };
  await failure(alice, 'Generate', args);
  await call(alice, 'Models', { kind: 'image' });
  await failure(alice, 'Generate', args);
  await call(alice, 'Models', { profile_id: videoProfile.id });
  await failure(alice, 'Generate', args);
  assert.equal(f.submitted.length, 0);
  await call(alice, 'Models', { profile_id: imageProfile.id });
  assert.equal(data(await call(alice, 'Generate', args)).status, 'queued');
  await failure(await f.client('bob'), 'Generate', args);
  assert.equal(f.submitted.length, 1);
});

test('Generate returns immediately with one saved-size image and passes explicit controls without polling', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const queued = await generate(client, { negative_prompt: 'Blur', cfg: 0, sampler: 'euler', scheduler: 'simple', upscale_quality: 'balanced', face_detail: true });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.jobs.length, 1);
  assert.deepEqual(f.submitted.map(body => ({ kind: body.kind, profileId: body.profileId, count: body.count, width: body.width, height: body.height, steps: body.steps, cfg: body.cfg, negative: body.negative })), [{ kind: 'image', profileId: imageProfile.id, count: 1, width: 768, height: 512, steps: 8, cfg: 0, negative: 'Blur' }]);
  assert.deepEqual(f.submitted[0].autoUpscale, { quality: 'balanced', faceDetail: true });
  assert.equal(f.submitted[0].sampler, 'euler');
  assert.equal(f.submitted[0].scheduler, 'simple');
  assert.equal(f.requests.some(request => request.path.startsWith('/jobs/')), false);
});

test('image variants queue separately with incrementing seeds and video keeps the actual video profile', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const variants = await generate(client, { count: 3, seed: 20 });
  assert.equal(variants.jobs.length, 3);
  assert.deepEqual(f.submitted.map(body => body.count), [1, 1, 1]);
  assert.deepEqual(f.submitted.map(body => body.seed), ['20', '21', '22']);
  await generate(client, { profile_id: videoProfile.id });
  assert.equal(f.submitted.at(-1).kind, 'video');
  assert.equal(f.submitted.at(-1).workflow, videoProfile.workflow);
});

test('partial queue failures retain successful owned jobs without retrying the submission', async t => {
  const f = await fixture(t);
  f.failAfter(1);
  const client = await f.client();
  const result = await generate(client, { prompts: ['A tree', 'A flower'] });
  assert.equal(result.status, 'partially_queued');
  assert.equal(result.jobs.length, 1);
  assert.equal(f.submitted.length, 1);
  assert.equal(data(await call(client, 'Status', { job_id: jobId(result) })).status, 'running');
});

test('forwarded identities and native token fallback cannot read, cancel or reuse each other’s jobs', async t => {
  const f = await fixture(t);
  const alice = await f.client('alice');
  const bob = await f.client('bob');
  const native = await f.client('');
  const aliceJob = jobId(await generate(alice));
  const nativeJob = jobId(await generate(native));
  const before = f.requests.length;
  for (const [client, id] of [[bob, aliceJob], [native, aliceJob], [alice, nativeJob]]) for (const name of ['Status', 'Cancel', 'Result', 'Reuse']) await failure(client, name, { job_id: id });
  assert.equal(f.requests.length, before);
  await call(alice, 'Cancel', { job_id: aliceJob });
  assert.equal(f.jobs.get(aliceJob).status, 'cancelled');
  assert.equal(data(await call(native, 'Status', { job_id: nativeJob })).status, 'running');
});

test('ownership persists across route registration and is not stored as a forwarded user identifier', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = await fixture(t, { dataDir: dir });
  const owner = 'forwarded-private-owner-fixture';
  const id = jobId(await generate(await first.client(owner)));
  const second = await fixture(t, { dataDir: dir });
  second.jobs.set(id, first.jobs.get(id));
  assert.equal(data(await call(await second.client(owner), 'Status', { job_id: id })).status, 'running');
  await failure(await second.client('different-owner'), 'Status', { job_id: id });
  const files = fs.readdirSync(dir, { recursive: true }).filter(file => fs.statSync(path.join(dir, file)).isFile());
  assert.ok(files.length);
  for (const file of files) assert.equal(fs.readFileSync(path.join(dir, file)).includes(Buffer.from(owner)), false);
});

test('uploaded references belong to their uploader and map to declared profile slots', async t => {
  const f = await fixture(t);
  const alice = await f.client('alice');
  const bob = await f.client('bob');
  const uploaded = data(await call(alice, 'Upload', { content_base64: png.toString('base64'), filename: 'reference.png' }));
  const assetId = uploaded.asset?.id || uploaded.id || uploaded.asset_id;
  assert.ok(assetId);
  await failure(bob, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], reference_asset_ids: [assetId] });
  assert.equal(f.submitted.length, 0);
  await generate(alice, { reference_asset_ids: [assetId], denoise: 0.4, loras: [{ name: 'fixture-effect.safetensors', strength: -0.5 }] });
  assert.deepEqual(f.submitted[0].referenceAssets, [{ slot: 'reference', assetId }]);
  assert.equal(f.submitted[0].denoise, 0.4);
  assert.deepEqual(f.submitted[0].loras, [{ name: 'fixture-effect.safetensors', strength: -0.5, enabled: true }]);
});

test('image Result attaches a preview and a signed private download of the unchanged original', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=fixture.png' }] });
  const before = f.requests.length;
  const result = await call(client, 'Result', { job_id: id });
  assert.notEqual(result.isError, true);
  assert.deepEqual(f.requests.slice(before).map(request => request.path), [`/jobs/${id}`, `/gallery/jobs/${id}`]);
  assert.ok(result.content.some(item => item.type === 'image'));
  const [link] = links(result);
  assert.ok(link);
  const response = await fetch(localLink(f, link));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.ok(result.content.some(item => item.type === 'text' && item.text.startsWith('[View Original]')));
  assert.equal(JSON.stringify(result.content).includes('[Download'), false);
  const tampered = localLink(f, link).replace(/.$/, value => value === 'a' ? 'b' : 'a');
  assert.equal((await fetch(tampered)).status, 404);
  const status = data(await call(client, 'Status', { job_id: id }));
  assert.ok(status.outputs.length);
  for (const output of status.outputs) assert.match(output.url, /^https:\/\/studio\.example\.test\/mcp\/results\//);
});

test('video results return signed links without eagerly downloading video bytes', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client, { profile_id: videoProfile.id }));
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=fixture.mp4' }] });
  const result = await call(client, 'Result', { job_id: id });
  assert.notEqual(result.isError, true);
  assert.equal(links(result).length, 1);
  assert.equal(result.content.some(item => item.type === 'image'), false);
  assert.equal(f.downloads.length, 0);
});

test('Hidden jobs and unsafe result URLs never produce previews, references or download links', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  const job = f.jobs.get(id);
  for (const value of [{ privateVault: true, outputs: [{ url: '/comfy/view?filename=private.png' }] }, { privateVault: false, outputs: [{ url: 'https://external.invalid/private.png' }] }, { privateVault: false, outputs: [{ url: '//external.invalid/private.png' }] }, { privateVault: false, outputs: [{ url: '/api/vault/secret' }] }]) {
    Object.assign(job, { status: 'done', ...value });
    const status = await call(client, 'Status', { job_id: id });
    if (!status.isError) assert.deepEqual(data(status).outputs, []);
    else assert.equal(links(status).length, 0);
    await failure(client, 'Result', { job_id: id });
    await failure(client, 'Reuse', { job_id: id });
    assert.equal(f.assets.size, 0);
  }
});

test('pending Result and Status return without polling, downloading or generating again', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  for (const name of ['Status', 'Result']) {
    const before = f.requests.filter(request => request.path.startsWith('/jobs/')).length;
    const result = await call(client, name, { job_id: id });
    assert.notEqual(result.isError, true);
    assert.equal(f.requests.filter(request => request.path.startsWith('/jobs/')).length, before + 1);
    assert.equal(links(result).length, 0);
  }
  assert.equal(f.submitted.length, 1);
});


test('hiding a completed output revokes existing signed links and prevents result reuse', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=visible.png' }] });
  const result = await call(client, 'Result', { job_id: id });
  const [link] = links(result);
  assert.ok(link);
  f.jobs.get(id).gallery = [];
  const before = f.downloads.length;
  assert.equal((await fetch(localLink(f, link))).status, 404);
  await failure(client, 'Result', { job_id: id });
  await failure(client, 'Reuse', { job_id: id });
  assert.equal(f.downloads.length, before);
});

test('owned completed results remain available after the transient job expires', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  Object.assign(f.jobs.get(id), { status: 'missing', outputs: [], gallery: [{ id: 'retained-gallery-output', jobId: id, index: 0, status: 'done', type: 'image', url: '/comfy/view?filename=retained.png' }] });
  const before = f.requests.length;
  const result = await call(client, 'Result', { job_id: id });
  assert.notEqual(result.isError, true);
  assert.deepEqual(f.requests.slice(before).map(request => request.path), [`/jobs/${id}`, `/gallery/jobs/${id}`]);
  assert.ok(result.content.some(item => item.type === 'image'));
  assert.equal(links(result).length, 1);
  const reused = data(await call(client, 'Reuse', { job_id: id }));
  assert.ok(reused.asset?.id || reused.id || reused.asset_id);
});

test('invalid generation controls, references and excessive batches fail before submission', async t => {
  const f = await fixture(t);
  const client = await f.client();
  for (const arguments_ of [
    { profile_id: 'unavailable-profile' },
    { prompts: [] },
    { prompts: [''] },
    { prompts: ['One', 'Two', 'Three', 'Four', 'Five'] },
    { count: 0 },
    { count: 5 },
    { count: 3, prompts: ['One', 'Two'] },
    { wait_seconds: -1 },
    { wait_seconds: 46 },
    { cfg: 21 },
    { denoise: 1.1 },
    { sampler: 'unsupported' },
    { scheduler: 'unsupported' },
    { face_detail: true },
    { reference_asset_ids: ['unowned-asset'] },
    { loras: [{ name: 'unavailable-effect.safetensors', strength: 1 }] }
  ]) await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], ...arguments_ });
  assert.equal(f.submitted.length, 0);
  f.profiles([{ ...imageProfile, capabilities: {} }]);
  await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], negative_prompt: 'Blur' });
  await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], cfg: 1 });
  assert.equal(f.submitted.length, 0);
});

test('invalid uploads and unsupported waits are refused without accessing another job', async t => {
  const f = await fixture(t);
  const client = await f.client();
  await failure(client, 'Upload', { content_base64: 'not-an-image', filename: 'reference.png' });
  assert.equal(f.assets.size, 0);
  const id = jobId(await generate(client));
  const before = f.requests.length;
  for (const [name, maximum] of [['Status', 20], ['Result', 1800]]) for (const wait_seconds of [-1, maximum + 1]) await failure(client, name, { job_id: id, wait_seconds });
  assert.equal(f.requests.length, before);
});


test('deployment prompting packs retain compact discovery, profile modes and reviewed variants', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-prompting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'prompting.json');
  fs.writeFileSync(file, JSON.stringify({
    families: { flux: { image: 'fixture-pack' } },
    packs: { 'fixture-pack': { default_mode: 'image', modes: { image: { example: 'A tree', rules: ['Describe the scene'] }, reference: { example: 'Move the camera', rules: ['Preserve the subject'] } }, sources: ['https://example.test/model'], summary: 'Fixture scene guidance' } },
    profiles: { [imageProfile.id]: { pack: 'fixture-pack', mode: 'reference', variant: 'quick' } },
    reviewed_on: '2026-10-18',
    variants: { quick: { rules: ['Keep the request concise'] } }
  }));
  const f = await fixture(t, { dataDir: dir, environment: { MCP_PROMPTING_PATH: file } });
  const client = await f.client();
  const compact = data(await call(client, 'Models', { kind: 'image' })).profiles[0].prompting;
  assert.deepEqual(compact, { id: 'fixture-pack', mode: 'reference', summary: 'Fixture scene guidance', variant: 'quick' });
  const detail = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0].prompting;
  assert.equal(detail.mode.id, 'reference');
  assert.deepEqual(detail.mode.rules, ['Preserve the subject']);
  assert.equal(detail.variant.id, 'quick');
  assert.equal(detail.reviewed_on, '2026-10-18');
});


test('an interrupted generation acknowledgement retains its client job ownership and never resubmits', async t => {
  const f = await fixture(t);
  f.dropAck();
  const client = await f.client();
  const result = await generate(client, { prompts: ['A tree', 'A flower'] });
  assert.equal(result.status, 'partially_queued');
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].status, 'unknown');
  const id = jobId(result);
  assert.equal(id, f.submitted[0].clientJobId);
  assert.equal(data(await call(client, 'Status', { job_id: id })).status, 'running');
  assert.equal(f.submitted.length, 1);
  await failure(await f.client('bob'), 'Status', { job_id: id });
});

test('Generate never waits or fetches completed results, including when retrieval is unavailable', async t => {
  const f = await fixture(t);
  f.completeOnSubmit();
  f.jobLookupFails(true);
  const client = await f.client();
  await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], wait_seconds: 1 });
  assert.equal(f.submitted.length, 0);
  await call(client, 'Models', { profile_id: imageProfile.id });
  const result = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'] });
  assert.notEqual(result.isError, true);
  assert.equal(result.content.some(item => item.type === 'image'), false);
  assert.equal(f.submitted.length, 1);
  assert.equal(f.requests.some(request => request.path.startsWith('/jobs/') || request.path.startsWith('/gallery')), false);
  assert.equal(f.downloads.length, 0);
});

test('background Result collects a later completion without another submission', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  setTimeout(() => Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=later.png' }] }), 25);
  const result = await call(client, 'Result', { job_id: id, wait_seconds: 1800 });
  assert.notEqual(result.isError, true);
  assert.ok(result.content.some(item => item.type === 'image'));
  assert.equal(f.submitted.length, 1);
});

test('explicit status waiting has a bounded deadline and terminal jobs return without waiting', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  const started = performance.now();
  assert.equal(data(await call(client, 'Status', { job_id: id, wait_seconds: 1 })).status, 'running');
  assert.ok(performance.now() - started < 3000);
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=terminal.png' }] });
  const terminal = performance.now();
  assert.equal(data(await call(client, 'Status', { job_id: id, wait_seconds: 20 })).status, 'done');
  assert.ok(performance.now() - terminal < 1000);
});

test('signed links expire, preserve the configured public path and cannot cross studio audiences', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-audience-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = await fixture(t, { dataDir: dir, environment: { MCP_PUBLIC_URL: 'https://studio.example.test/nested/studio' } });
  const client = await f.client();
  const id = jobId(await generate(client));
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=original.png' }] });
  const [url] = links(await call(client, 'Result', { job_id: id }));
  assert.match(url, /^https:\/\/studio\.example\.test\/nested\/studio\/mcp\/results\//);
  const local = f.base + new URL(url).pathname.replace('/nested/studio', '');
  assert.equal((await fetch(local)).status, 200);
  const second = await fixture(t, { dataDir: dir, environment: { MCP_PUBLIC_URL: 'https://another-studio.example.test' } });
  second.jobs.set(id, f.jobs.get(id));
  assert.equal((await fetch(second.base + new URL(local).pathname)).status, 404);
  const now = Date.now();
  const clock = t.mock.method(Date, 'now', () => now + 601000);
  try { assert.equal((await fetch(local)).status, 404); } finally { clock.mock.restore(); }
});

test('MCP rejects hostile browser origins, rebound hosts and oversized forwarded identities', async t => {
  const f = await fixture(t);
  const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const [headers, status] of [[{ Origin: 'https://hostile.example.test' }, 403], [{ Host: 'rebound.example.test' }, 403], [{ 'x-bento-user-id': 'x'.repeat(257) }, 400]]) {
    const requestHeaders = { authorization: `Bearer ${mediaKey}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers };
    // Fetch normalises Host, so use the native HTTP client for the rebinding case.
    const actual = headers.Host ? await new Promise((resolve, reject) => {
      const request = http.request(f.base + '/mcp', { method: 'POST', headers: requestHeaders }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      request.end(message);
    }) : (await fetch(f.base + '/mcp', { method: 'POST', headers: requestHeaders, body: message })).status;
    assert.equal(actual, status, JSON.stringify(headers));
  }
  assert.equal(f.requests.length, 0);
});


test('reference-mode capabilities override text controls without losing the profile LoRA options', async t => {
  const f = await fixture(t);
  f.profiles([{ ...imageProfile, imageModes: {
    generate: { capabilities: { ...imageProfile.capabilities, negativePrompt: false, denoise: false }, defaults: imageProfile.defaults },
    reference: { capabilities: imageProfile.capabilities, defaults: imageProfile.defaults }
  } }]);
  const client = await f.client();
  const details = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  assert.equal(details.capabilities.negativePrompt, false);
  assert.deepEqual(details.options.loras, imageProfile.options.loras);
  await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], negative_prompt: 'Blur' });
  assert.equal(f.submitted.length, 0);
  const uploaded = data(await call(client, 'Upload', { content_base64: png.toString('base64') }));
  await generate(client, { reference_asset_ids: [uploaded.asset.id], negative_prompt: 'Blur', denoise: 0.6, loras: [{ name: 'fixture-effect.safetensors', strength: 0.7 }] });
  assert.equal(f.submitted[0].negative, 'Blur');
  assert.equal(f.submitted[0].denoise, 0.6);
  assert.deepEqual(f.submitted[0].loras, [{ name: 'fixture-effect.safetensors', strength: 0.7, enabled: true }]);
});

test('identical uploads sharing an upstream asset id preserve access for both uploading owners', async t => {
  const f = await fixture(t);
  f.deduplicateUploads();
  const alice = await f.client('alice');
  const bob = await f.client('bob');
  const aliceAsset = data(await call(alice, 'Upload', { content_base64: png.toString('base64') })).asset;
  const bobAsset = data(await call(bob, 'Upload', { content_base64: png.toString('base64') })).asset;
  assert.equal(aliceAsset.id, bobAsset.id);
  for (const client of [alice, bob]) await generate(client, { reference_asset_ids: [aliceAsset.id] });
  assert.equal(f.submitted.length, 2);
  await failure(await f.client('charlie'), 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], reference_asset_ids: [aliceAsset.id] });
  assert.equal(f.submitted.length, 2);
});


test('the real demo server exposes native MCP on its existing port and accepts immediate generation', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-server-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, '');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const child = fork(path.join(here, 'index.js'), [], {
    cwd: path.dirname(here),
    env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', HEISS_DATA_DIR: dir, HEISS_ENV_FILE: envFile, HEISS_DEMO: '1', HEISS_LAN: '0', HEISS_NO_BROWSER: '1', HEISS_MCP_API_KEY: mediaKey, COMFY_URL: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  const client = new Client({ name: 'heiss-real-server-fixture', version: '1.0.0' }, { capabilities: {} });
  t.after(async () => {
    await client.close().catch(() => {});
    const exited = child.exitCode === null && child.signalCode === null ? new Promise(resolve => child.once('exit', resolve)) : null;
    child.kill('SIGTERM');
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const started = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', code => reject(new Error(`Fixture HEISS server exited before starting (${code}).`)));
    child.once('error', reject);
  });
  const base = started.url.replace('localhost', '127.0.0.1');
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { authorization: `Bearer ${mediaKey}`, 'x-bento-user-id': 'real-server-fixture' } } }));
  assert.equal((await client.listTools()).tools.length, 7);
  const profiles = data(await call(client, 'Models', { kind: 'image' })).profiles;
  assert.ok(profiles.length);
  await call(client, 'Models', { profile_id: profiles[0].id });
  const queued = data(await call(client, 'Generate', { profile_id: profiles[0].id, prompts: ['A simple demo landscape'] }));
  assert.equal(queued.status, 'queued');
  assert.equal(queued.jobs.length, 1);
  const id = jobId(queued);
  const status = data(await call(client, 'Status', { job_id: id }));
  assert.ok(['queued', 'running', 'done'].includes(status.status));
  assert.notEqual((await call(client, 'Cancel', { job_id: id })).isError, true);
});

test('Models consumes self-contained profile guidance without a runtime prompting inventory', async t => {
  const f = await fixture(t);
  const shared = { id: 'owned-guide', summary: 'Profile-owned research', rules: ['Preserve the subject'], patterns: { subject: 'Subject first', composition: 'Then composition' }, sources: ['https://example.test/research'], reviewed_on: '2026-10-16', variant: { id: 'distilled', rules: ['Keep the saved steps'] } };
  const generateGuide = { ...shared, mode: { id: 'generate', example: 'A tree in morning light' } };
  const referenceGuide = { ...shared, mode: { id: 'reference', example: 'Keep the tree and change its background' } };
  f.profiles([{ ...imageProfile, prompting: shared, imageModes: { generate: { prompting: generateGuide }, reference: { prompting: referenceGuide } } }]);
  const client = await f.client();
  const compact = data(await call(client, 'Models', { kind: 'image' })).profiles[0];
  assert.deepEqual(compact.prompting, { id: 'owned-guide', summary: 'Profile-owned research', mode: 'generate', variant: 'distilled' });
  assert.equal(compact.imageModes, undefined);
  assert.equal(JSON.stringify(compact).includes('Subject first'), false);
  const detailed = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  assert.deepEqual(detailed.prompting, generateGuide);
  assert.deepEqual(detailed.imageModes.reference.prompting, referenceGuide);
  assert.equal(detailed.prompting.modes, undefined);
});

test('profile-owned prompting overrides a stale compatibility inventory', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-native-mcp-owned-guide-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fallback.json');
  fs.writeFileSync(file, JSON.stringify({ families: { flux: { image: 'stale-pack' } }, packs: { 'stale-pack': { summary: 'Stale fallback guidance', rules: ['Old guidance'] } } }));
  const f = await fixture(t, { dataDir: dir, environment: { MCP_PROMPTING_PATH: file } });
  const owned = { id: 'profile-guide', summary: 'Reviewed profile guidance', rules: ['Use the reviewed profile'], sources: ['https://example.test/reviewed'], reviewed_on: '2026-10-16' };
  f.profiles([{ ...imageProfile, prompting: owned }]);
  const client = await f.client();
  assert.deepEqual(data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0].prompting, owned);
});

test('maintained profile guidance reaches the real model API and native MCP without a pack file', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-profile-mcp-'));
  const guide = { id: 'owned-api-guide', summary: 'Describe the subject before its motion', rules: ['Preserve the subject identity'], patterns: ['Subject, setting, motion'], example: 'A bird turns its head', sources: ['https://example.test/research'], reviewed_on: '2026-10-16' };
  fs.mkdirSync(path.join(dir, 'workflows'));
  fs.writeFileSync(path.join(dir, '.env'), '');
  fs.writeFileSync(path.join(dir, 'workflows', 'owned-guide.json'), JSON.stringify({
    graph: { 1: { class_type: 'FixtureImage', inputs: { prompt: '' } }, 2: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'fixture' } } },
    heissUi: { id: 'owned-api-guide', name: 'Owned API Guide', kind: 'image', controls: { prompt: { node: '1', input: 'prompt' } }, prompting: guide }
  }));
  const info = { FixtureImage: { input: { required: { prompt: ['STRING'] } }, output: ['IMAGE'] }, SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } }, output: [] } };
  for (const name of ['KSampler', 'CLIPTextEncode', 'VAEDecode']) info[name] = { input: { required: {} } };
  let catalogueReads = 0;
  const backend = http.createServer((req, res) => {
    if (req.url === '/object_info') catalogueReads++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/object_info' ? info : req.url === '/system_stats' ? { devices: [] } : req.url === '/queue' ? { queue_running: [], queue_pending: [] } : {}));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const child = fork(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'), [], {
    env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', HEISS_DATA_DIR: dir, HEISS_ENV_FILE: path.join(dir, '.env'), HEISS_ENABLE_BUILTIN_PROFILES: '0', HEISS_LAN: '0', HEISS_NO_BROWSER: '1', HEISS_MCP_API_KEY: mediaKey, COMFY_URL: `http://127.0.0.1:${backend.address().port}` },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  const client = new Client({ name: 'owned-profile-fixture', version: '1.0.0' }, { capabilities: {} });
  t.after(async () => {
    await client.close().catch(() => {});
    const exited = child.exitCode === null && child.signalCode === null ? new Promise(resolve => child.once('exit', resolve)) : null;
    child.kill('SIGTERM');
    await exited;
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const started = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', code => reject(new Error(`Profile fixture server exited (${code}).`)));
    child.once('error', reject);
  });
  const base = started.url.replace('localhost', '127.0.0.1');
  const models = await (await fetch(new URL('/api/models', base))).json();
  assert.deepEqual(models.profiles.find(profile => profile.id === 'custom:owned-api-guide')?.prompting, guide);
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { Authorization: `Bearer ${mediaKey}` } } }));
  const profile = data(await call(client, 'Models', { profile_id: 'custom:owned-api-guide' })).profiles[0];
  assert.deepEqual(profile.prompting, guide);
  const cachedReads = catalogueReads;
  await call(client, 'Models', { profile_id: 'custom:owned-api-guide' });
  await call(client, 'Models', { profile_id: 'custom:owned-api-guide' });
  assert.equal(catalogueReads, cachedReads, 'MCP reads reuse backend metadata');
  await fetch(new URL('/api/models', base));
  assert.equal(catalogueReads, cachedReads + 1, 'an explicit studio rescan still refreshes metadata');
});
