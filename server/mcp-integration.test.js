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
  options: { loras: ['fixture-effect.safetensors', 'fixture-unknown.safetensors', 'fixture-other.safetensors', 'fixture-turbo.safetensors'], samplers: ['euler', 'dpmpp_2m'], schedulers: ['simple'] },
  mediaInputs: [{ id: 'reference', kind: 'image', min: 0, max: 1, required: false }]
};
const loraInfo = {
  'fixture-effect.safetensors': { families: ['flux'], base: 'FLUX.1', triggers: ['glowfx'], title: 'Glow Effect', description: 'Adds a soft neon glow.', sourceUrl: 'https://civitai.example.test/models/1', strengthRange: { min: 0.2, max: 1.2, step: 0.1, default: 0.8 } },
  'fixture-unknown.safetensors': { families: [], base: '', triggers: [] },
  'fixture-other.safetensors': { families: ['sdxl'], base: 'SDXL', triggers: ['sdxlonly'] },
  'fixture-turbo.safetensors': { families: ['flux'], base: 'FLUX.1', triggers: [], role: 'acceleration' }
};
const videoProfile = { ...imageProfile, id: 'fixture-video', kind: 'video', label: 'Fixture Video', family: 'minimax_h3', model: 'fixture-video', workflow: 'fixture-video', defaults: { width: 1280, height: 720, count: 1, steps: 12 }, mediaInputs: [] };

async function fixture(t, { foregroundWaitSeconds, imageWaitSeconds = 0, environment: extra = {}, dataDir: existingDir, enabled = true, accountMode = false, authenticateAccountToken = () => null, authenticateGatewayIdentity, noteGatewayIdentity, internalCredential, resolveSignedResult } = {}) {
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
  let defaults = { image: imageProfile.id, video: videoProfile.id };
  let visibleTo = null;
  app.use('/api', (req, _res, next) => { requests.push({ path: req.path, method: req.method, body: req.body, authorization: req.headers.authorization, internal: req.headers['x-heiss-mcp-internal'], account: req.headers['x-heiss-mcp-account'] }); next(); });
  app.get('/api/access/status', (_req, res) => res.json({ signedIn: true }));
  app.get('/api/loras/info', (_req, res) => res.json({ ok: true, loras: loraInfo }));
  app.post('/api/generate', (req, res) => {
    if (submitted.length >= failAfter) return res.status(503).json({ error: 'Fixture backend offline' });
    if (req.body.prompt === 'refuse with reason') return res.status(400).json({ ok: false, error: 'Fixture LoRA supports strength 0.2 to 1.2.' });
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
    // Like the studio's gallery record: the prompt and generation settings only on request.
    const body = job?.settings || {};
    const recorded = req.query.settings === '1' ? { prompt: body.prompt, negative: body.negative || '', width: body.width, height: body.height, settings: { profileId: body.profileId, steps: body.steps, cfg: body.cfg, sampler: body.sampler || '', scheduler: body.scheduler || '', seed: body.seed || 'Random', referenceAssets: body.referenceAssets || [], ...(body.loras?.length ? { loras: body.loras } : {}) } } : {};
    res.json({ items: !job || job.privateVault ? [] : job.gallery ?? (job.status === 'done' ? job.outputs.map((output, index) => ({ jobId: job.id, index, status: 'done', type: job.kind, ...recorded, ...output })) : []) });
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
  const environment = { ...(enabled ? { STUDIO_MCP_API_KEY: mediaKey } : {}), MCP_PUBLIC_URL: 'https://studio.example.test', ...extra };
  await registerMcpRoutes(app, {
    baseUrl: () => base,
    dataDir,
    environment,
    accountMode,
    authenticateAccountToken,
    // Most tests check the queued response; inline waits have their own tests.
    imageWaitSeconds,
    ...(foregroundWaitSeconds !== undefined ? { foregroundWaitSeconds } : {}),
    ...(authenticateGatewayIdentity ? { authenticateGatewayIdentity } : {}),
    ...(noteGatewayIdentity ? { noteGatewayIdentity } : {}),
    ...(internalCredential ? { internalCredential } : {}),
    resolveSignedResult,
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
  // Registered after MCP, as in the studio, so a rescan reaches MCP's cache invalidation.
  // The studio limits each account's catalogue to its access profile; the deployment defaults are not limited.
  app.get('/api/models', (req, res) => res.json({ profiles: visibleTo ? profiles.filter(profile => visibleTo(req.headers['x-ai-user-id'] || req.headers.authorization, profile)) : profiles, defaults: { imageModel: defaults.image, videoModel: defaults.video } }));
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
    // A model change reaches the studio as a rescan, which refreshes MCP's cached catalogues.
    profiles: async (value, { defaults: chosen, visibleTo: filter } = {}) => { profiles = value; if (chosen) defaults = chosen; if (filter) visibleTo = filter; await fetch(`${base}/api/models`); },
    client: async (user = 'alice', key = mediaKey) => {
      const client = new Client({ name: 'heiss-integration-fixture', version: '1.0.0' }, { capabilities: {} });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}`, ...(user ? { 'x-ai-user-id': user } : {}) } } }));
      return client;
    }
  };
}

test('account MCP tokens map requests and jobs to the stable account identity', async t => {
  const token = 'account-mcp-token-that-is-long-enough-for-the-fixture';
  const account = { userId: 'stable-account-a', role: 'user', authenticated: true, generationProfiles: [imageProfile.id], features: {} };
  const f = await fixture(t, { enabled: false, accountMode: true, authenticateAccountToken: value => value === token ? account : null });
  const client = await f.client('', token);
  const result = await generate(client);
  const id = jobId(result);
  assert.equal(f.requests.find(request => request.path === '/generate')?.authorization, `Bearer ${token}`);
  const saved = JSON.parse(fs.readFileSync(path.join(f.dataDir, 'mcp-ownership.json'), 'utf8'));
  assert.equal(saved.jobs[id], 'stable-account-a');
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=account-result.png' }] });
  const preview = await call(client, 'Result', { job_id: id });
  assert.ok(preview.content.some(item => item.type === 'image'));
  assert.ok(f.downloads.includes('/comfy/view?filename=account-result.png'));
  const rejected = await fetch(`${f.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${mediaKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  assert.equal(rejected.status, 401);
});

test('account mode trusts the gateway key only for linked forwarded users and keeps the control scope', async t => {
  const linked = { userId: 'stable-account-gateway', role: 'user', authenticated: true, generationProfiles: [imageProfile.id], features: {} };
  const noted = [];
  const f = await fixture(t, {
    accountMode: true,
    environment: adminEnvironment,
    authenticateGatewayIdentity: user => user === 'librechat-linked' ? linked : null,
    noteGatewayIdentity: user => noted.push(user),
    internalCredential: accountId => ({ 'X-Heiss-Mcp-Internal': 'fixture-internal', 'X-Heiss-Mcp-Account': accountId })
  });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const headers = (user) => ({ authorization: `Bearer ${mediaKey}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(user ? { 'x-ai-user-id': user } : {}) });
  assert.equal((await fetch(`${f.base}/mcp`, { method: 'POST', headers: headers(''), body })).status, 403);
  assert.equal((await fetch(`${f.base}/mcp`, { method: 'POST', headers: headers('librechat-unlinked'), body })).status, 403);
  assert.deepEqual(noted, ['librechat-unlinked']);

  const client = await f.client('librechat-linked');
  const id = jobId(await generate(client));
  const submission = f.requests.find(request => request.path === '/generate');
  // MCP's loopback call carries the internal credential for the linked account, never the gateway key.
  assert.equal(submission.authorization, undefined);
  assert.equal(submission.internal, 'fixture-internal');
  assert.equal(submission.account, linked.userId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'mcp-ownership.json'), 'utf8')).jobs[id], linked.userId);

  const control = await f.client('administrator', controlKey);
  assert.deepEqual((await control.listTools()).tools.map(tool => tool.name).sort(), ['Apply', 'GPUStatus', 'Operation', 'Preview', 'Workloads']);
});

test('account signed result links survive restart without persisting bearer tokens and recheck output availability', async t => {
  const token = 'account-mcp-token-for-restart-fixture';
  const account = { userId: 'stable-account-restart', role: 'user', authenticated: true, generationProfiles: [imageProfile.id], features: {} };
  const first = await fixture(t, { enabled: false, accountMode: true, authenticateAccountToken: value => value === token ? account : null });
  const client = await first.client('', token);
  const id = jobId(await generate(client));
  Object.assign(first.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=restart-result.png' }] });
  const result = await call(client, 'Result', { job_id: id });
  const [link] = links(result);
  assert.ok(link);

  let available = true;
  const restarted = await fixture(t, {
    dataDir: first.dataDir,
    enabled: false,
    accountMode: true,
    resolveSignedResult: async (owner, jobId, index) => available && owner === account.userId && jobId === id && index === 0 ? { content: png, mime: 'image/png' } : null
  });
  const response = await fetch(localLink(restarted, link));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  available = false;
  assert.equal((await fetch(localLink(restarted, link))).status, 404);
});

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
  return data(await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A landscape'], count: 1, ...args }));
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
  assert.equal(compact.profiles[0].loras, undefined);
  const detail = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  // Only adjustable controls are advertised; raw capability and constraint tables are not.
  assert.equal(detail.capabilities, undefined);
  assert.equal(detail.constraints, undefined);
  assert.deepEqual(detail.controls.cfg, { min: 0, max: 20, default: 0 });
  assert.deepEqual(detail.controls.sampler.options, ['euler', 'dpmpp_2m']);
  assert.equal(detail.controls.scheduler, undefined, 'a single scheduler is fixed');
  assert.equal(detail.defaults.count, 2);
  assert.equal(detail.prompting, null);
  await failure(client, 'Models', { profile_id: 'another-studio-profile' });
});

test('Generate shows the full guide unless this account read the selected profile, not discovery or another profile', async t => {
  const f = await fixture(t);
  await f.profiles([{ ...structuredClone(imageProfile), prompting: { id: 'fixture-guide', summary: 'Subject first', rules: ['Describe the subject first'] } }, structuredClone(videoProfile)]);
  const alice = await f.client('alice');
  const args = { profile_id: imageProfile.id, prompts: ['A landscape'], count: 1 };
  await call(alice, 'Models', { kind: 'image' });
  await call(alice, 'Models', { profile_id: videoProfile.id });
  const first = data(await call(alice, 'Generate', args));
  assert.equal(first.status, 'queued');
  assert.deepEqual(first.prompting.rules, ['Describe the subject first'], 'an unread guide accompanies the submission');
  assert.ok(first.guide_note);
  const second = data(await call(alice, 'Generate', args));
  assert.equal(second.prompting, undefined, 'the guide is shown once per account');
  const bob = await f.client('bob');
  await call(bob, 'Models', { profile_id: imageProfile.id });
  assert.equal(data(await call(bob, 'Generate', args)).prompting, undefined, 'a guide read through Models is not repeated');
  assert.ok(data(await call(await f.client('carol'), 'Generate', args)).prompting, 'another account has not read it');
  assert.equal(f.submitted.length, 4);
});

test('Models caches each owner’s catalogue for the TTL instead of rescanning per call', async t => {
  const f = await fixture(t);
  const scans = () => f.requests.filter(request => request.path === '/models').length;
  const alice = await f.client('alice');
  await call(alice, 'Models', { kind: 'image' });
  await call(alice, 'Models', { kind: 'video' });
  await call(alice, 'Models', { profile_id: imageProfile.id });
  assert.equal(scans(), 1, 'one upstream scan serves repeated Models calls within the TTL');
  data(await call(alice, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], count: 1 }));
  assert.equal(scans(), 1, 'Generate reuses the cached catalogue');
  const bob = await f.client('bob');
  assert.deepEqual(data(await call(bob, 'Models', { kind: 'video' })).profiles.map(profile => profile.id), [videoProfile.id]);
  assert.equal(scans(), 2, 'each owner has its own cache entry');
  await f.profiles([structuredClone(videoProfile)]);
  const rescans = scans();
  assert.deepEqual(data(await call(alice, 'Models', {})).profiles.map(profile => profile.id), [videoProfile.id], 'a studio rescan invalidates cached catalogues');
  assert.equal(scans(), rescans + 1);
});

test('foreground Status and Result waits are capped; background notification waits are not', async t => {
  const f = await fixture(t, { foregroundWaitSeconds: 0 });
  const client = await f.client();
  const id = jobId(await generate(client));
  let started = performance.now();
  const pending = data(await call(client, 'Result', { job_id: id, delivery: 'preview', wait_seconds: 1800 }));
  assert.equal(pending.status, 'running');
  assert.match(pending.message, /do not poll/);
  assert.equal(data(await call(client, 'Status', { job_id: id, wait_seconds: 20 })).status, 'running');
  assert.ok(performance.now() - started < 1500, 'foreground waits return at once under a zero cap');
  setTimeout(() => Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=later.png' }] }), 25);
  assert.equal(data(await call(client, 'Result', { job_id: id, delivery: 'notification', wait_seconds: 1800 })).status, 'done');
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

test('omitted counts queue two independent image or video jobs and explicit one remains one', async t => {
  const f = await fixture(t);
  const client = await f.client();
  for (const profile of [imageProfile, videoProfile]) {
    await call(client, 'Models', { profile_id: profile.id });
    const result = data(await call(client, 'Generate', { profile_id: profile.id, prompts: ['A landscape'] }));
    assert.equal(result.jobs.length, 2);
    assert.deepEqual(f.submitted.slice(-2).map(body => [body.kind, body.count]), [[profile.kind, 1], [profile.kind, 1]]);
    const single = await generate(client, { profile_id: profile.id, count: 1 });
    assert.equal(single.jobs.length, 1);
  }
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
    { wait_seconds: 61 },
    { cfg: 21 },
    { denoise: 1.1 },
    { sampler: 'unsupported' },
    { scheduler: 'unsupported' },
    { face_detail: true },
    { reference_asset_ids: ['unowned-asset'] },
    { loras: [{ name: 'unavailable-effect.safetensors', strength: 1 }] }
  ]) await failure(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], ...arguments_ });
  assert.equal(f.submitted.length, 0);
  await f.profiles([{ ...imageProfile, capabilities: {} }]);
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
  // Guides stay in the detail; the compact list carries only identity, tier and a one-line summary.
  const compact = data(await call(client, 'Models', { kind: 'image' })).profiles[0];
  assert.deepEqual(compact, { id: imageProfile.id, label: imageProfile.label, kind: 'image', tier: 'standard', summary: imageProfile.description });
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

test('Generate without a wait never fetches results, and unavailable retrieval falls back to queued', async t => {
  const f = await fixture(t);
  f.completeOnSubmit();
  f.jobLookupFails(true);
  const client = await f.client();
  await call(client, 'Models', { profile_id: imageProfile.id });
  const result = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], count: 1 });
  assert.notEqual(result.isError, true);
  assert.equal(result.content.some(item => item.type === 'image'), false);
  assert.equal(f.submitted.length, 1);
  assert.equal(f.requests.some(request => request.path.startsWith('/jobs/') || request.path.startsWith('/gallery')), false);
  assert.equal(f.downloads.length, 0);
  const waited = data(await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], count: 1, wait_seconds: 1 }));
  assert.equal(waited.status, 'queued');
  assert.equal(f.submitted.length, 2);
  assert.equal(f.downloads.length, 0);
});

test('background Result collects a later completion without another submission', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  setTimeout(() => Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=later.png' }] }), 25);
  const result = await call(client, 'Result', { job_id: id, delivery: 'notification', wait_seconds: 1500 });
  assert.notEqual(result.isError, true);
  assert.equal(data(result).status, 'done');
  assert.ok(result.content.every(item => item.type === 'text'));
  assert.equal(f.downloads.length, 0);
  // Self-sufficient: the woken agent renders this markdown without another Result call.
  const [message] = result.content;
  assert.match(message.text, /!\[Result 1\]\(https:\/\/studio\.example\.test\/mcp\/results\/v2\.[^)]+\)\n\[View Original\]\(https:\/\/studio\.example\.test\/mcp\/results\/v2\./);
  assert.match(message.text, /Do not call Result again/);
  const [, imageUrl] = /!\[[^\]]*\]\(([^)]+)\)/.exec(message.text);
  const original = await fetch(localLink(f, imageUrl));
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.equal(data(result).ref, 'result 1');
  const preview = await call(client, 'Result', { job_id: id, delivery: 'preview', wait_seconds: 0 });
  assert.ok(preview.content.some(item => item.type === 'image'));
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

test('signed links do not expire, preserve the configured public path and cannot cross studio audiences', async t => {
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
  // Still valid much later; hiding or deleting the output is what ends a link.
  const clock = t.mock.method(Date, 'now', () => now + 90 * 24 * 60 * 60 * 1000);
  try { assert.equal((await fetch(local)).status, 200); } finally { clock.mock.restore(); }
});

test('MCP rejects hostile browser origins, rebound hosts and oversized forwarded identities', async t => {
  const f = await fixture(t);
  const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const [headers, status] of [[{ Origin: 'https://hostile.example.test' }, 403], [{ Host: 'rebound.example.test' }, 403], [{ 'x-ai-user-id': 'x'.repeat(257) }, 400]]) {
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
  await f.profiles([{ ...imageProfile, imageModes: {
    generate: { capabilities: { ...imageProfile.capabilities, negativePrompt: false, denoise: false }, defaults: imageProfile.defaults },
    reference: { capabilities: imageProfile.capabilities, defaults: imageProfile.defaults }
  } }]);
  const client = await f.client();
  const details = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  assert.equal(details.controls.negative_prompt, undefined);
  assert.equal(details.controls.denoise, undefined);
  assert.deepEqual(details.imageModes.reference.controls.negative_prompt, {});
  assert.ok(details.imageModes.reference.controls.denoise);
  assert.ok(details.loras.some(lora => lora.name === 'fixture-effect.safetensors'));
  const refused = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], negative_prompt: 'Blur' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /negative_prompt cannot be adjusted.*Adjustable controls: .*cfg/);
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
    env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', HEISS_DATA_DIR: dir, HEISS_ENV_FILE: envFile, HEISS_DEMO: '1', HEISS_LAN: '0', HEISS_NO_BROWSER: '1', STUDIO_MCP_API_KEY: mediaKey, COMFY_URL: 'http://127.0.0.1:1' },
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
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { authorization: `Bearer ${mediaKey}`, 'x-ai-user-id': 'real-server-fixture' } } }));
  assert.equal((await client.listTools()).tools.length, 7);
  const profiles = data(await call(client, 'Models', { kind: 'image' })).profiles;
  assert.ok(profiles.length);
  await call(client, 'Models', { profile_id: profiles[0].id });
  const queued = data(await call(client, 'Generate', { profile_id: profiles[0].id, prompts: ['A simple demo landscape'], count: 1, wait_seconds: 0 }));
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
  await f.profiles([{ ...imageProfile, prompting: shared, imageModes: { generate: { prompting: generateGuide }, reference: { prompting: referenceGuide } } }]);
  const client = await f.client();
  const compact = data(await call(client, 'Models', { kind: 'image' })).profiles[0];
  assert.deepEqual(Object.keys(compact), ['id', 'label', 'kind', 'tier', 'summary']);
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
  await f.profiles([{ ...imageProfile, prompting: owned }]);
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
    env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', HEISS_DATA_DIR: dir, HEISS_ENV_FILE: path.join(dir, '.env'), STUDIO_ENABLE_BUILTIN_PROFILES: '0', HEISS_LAN: '0', HEISS_NO_BROWSER: '1', STUDIO_MCP_API_KEY: mediaKey, COMFY_URL: `http://127.0.0.1:${backend.address().port}` },
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

test('MCP advertises native sizing and submits tiled 2K with an explicit reference role', async t => {
  const f = await fixture(t);
  const client = await f.client('native-sizing');
  const profile = { ...imageProfile, aspectPolicy: 'reference', family: 'flux3', native: { '2k': 'yes' }, workflow: 'family:flux3' };
  await f.profiles([profile]);
  const detail = data(await call(client, 'Models', { profile_id: profile.id })).profiles[0];
  assert.deepEqual(detail.native, { '2k': 'yes' });
  const uploaded = data(await call(client, 'Upload', { content_base64: png.toString('base64'), filename: 'reference.png' }));
  const assetId = uploaded.asset?.id || uploaded.id;
  await generate(client, { height: 1152, reference_asset_ids: [assetId], reference_role: 'reference', width: 2048 });
  assert.equal(f.submitted[0].referenceRole, 'reference');
  assert.equal(f.submitted[0].tiledDecode, true);
  assert.equal(f.submitted[0].autoUpscale, undefined);
  assert.deepEqual([f.submitted[0].width, f.submitted[0].height], [2048, 1152]);
  await generate(client, { reference_asset_ids: [assetId], reference_role: 'edit' });
  assert.equal(f.submitted[1].referenceRole, 'edit');
  assert.equal(f.submitted[1].tiledDecode, undefined);
  await failure(client, 'Generate', { profile_id: profile.id, prompts: ['A scene'], reference_role: 'reference' });
  await f.profiles([imageProfile]);
  await failure(client, 'Generate', { profile_id: profile.id, prompts: ['A scene'], reference_asset_ids: [assetId], reference_role: 'reference' });
  assert.equal(f.submitted.length, 2);
});

test('Generate returns per-conversation refs with signed watch pages that tools accept in place of job IDs', async t => {
  const f = await fixture(t);
  const conversation = async (user, id) => {
    const client = new Client({ name: 'heiss-ref-fixture', version: '1.0.0' }, { capabilities: {} });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(`${f.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mediaKey}`, 'x-ai-user-id': user, ...(id ? { 'x-studio-conversation-id': id } : {}) } } }));
    return client;
  };
  const first = await conversation('alice', 'conversation-a');
  const queued = await generate(first, { count: 2 });
  assert.deepEqual(queued.jobs.map(job => job.ref), ['result 1', 'result 2']);
  for (const job of queued.jobs) assert.match(job.link, /^https:\/\/studio\.example\.test\/mcp\/results\/p2\./);
  assert.deepEqual((await generate(first)).jobs.map(job => job.ref), ['result 3']);
  // Another conversation numbers from one again; the same account without a conversation has its own sequence.
  const second = await conversation('alice', 'conversation-b');
  assert.deepEqual((await generate(second)).jobs.map(job => job.ref), ['result 1']);
  assert.equal(data(await call(second, 'Status', { job_id: 'result 1' })).job_id, f.submitted.at(-1).clientJobId);
  assert.deepEqual((await generate(await conversation('alice'))).jobs.map(job => job.ref), ['result 1']);

  const [, secondJob] = queued.jobs;
  for (const reference of ['result 2', 'r2', '#2', '2', 'Result #2']) {
    const status = data(await call(first, 'Status', { job_id: reference }));
    assert.equal(status.job_id, secondJob.job_id);
    assert.equal(status.ref, 'result 2');
  }
  await failure(first, 'Status', { job_id: 'result 9' });
  // Bob's conversation with the same identifier cannot reach Alice's numbers.
  await failure(await conversation('bob', 'conversation-a'), 'Status', { job_id: 'result 1' });

  // The watch page works without the chat: progress first, then the outputs through their own signed links.
  const page = localLink(f, secondJob.link);
  const pending = await fetch(page);
  assert.equal(pending.status, 200);
  assert.match(pending.headers.get('content-type'), /^text\/html/);
  assert.match(pending.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await pending.text(), /Still generating/);
  Object.assign(f.jobs.get(secondJob.job_id), { status: 'done', outputs: [{ url: '/comfy/view?filename=watched.png' }] });
  const html = await (await fetch(page)).text();
  const [, output] = /<img src="(v2\.[^"]+)"/.exec(html);
  assert.match(html, /View Original/);
  const image = await fetch(new URL(output, page));
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  // A page link is not an output link, and the reverse: prefixes cannot be swapped.
  const sealed = new URL(page).pathname.split('/').pop();
  assert.equal((await fetch(page.replace(sealed, sealed.replace(/^p2\./, 'v2.')))).status, 404);
  assert.equal((await fetch(page.replace(sealed, output.replace(/^v2\./, 'p2.')))).status, 404);
  f.jobs.get(secondJob.job_id).gallery = [];
  assert.equal((await fetch(page)).status, 404, 'hiding the output ends the watch page');
});

test('the Result wait ends promptly when the client cancels or disconnects, without cancelling the generation', async t => {
  const f = await fixture(t);
  const lookups = () => f.requests.filter(request => request.path.startsWith('/jobs/')).length;
  const settled = async () => {
    const before = lookups();
    await new Promise(resolve => setTimeout(resolve, 4500));
    return lookups() - before;
  };
  const client = await f.client();
  const id = jobId(await generate(client));
  const controller = new AbortController();
  const waiting = client.callTool({ name: 'Result', arguments: { job_id: id, delivery: 'notification', wait_seconds: 1500 } }, undefined, { signal: controller.signal, timeout: 60000 });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(lookups() >= 1);
  controller.abort();
  await assert.rejects(waiting);
  assert.equal(await settled(), 0, 'a cancelled wait stops polling');

  const disconnecting = await f.client();
  const second = disconnecting.callTool({ name: 'Result', arguments: { job_id: id, delivery: 'notification', wait_seconds: 1500 } }, undefined, { timeout: 60000 }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 300));
  await disconnecting.close();
  await second;
  assert.equal(await settled(), 0, 'a disconnect stops polling');
  assert.equal(f.jobs.get(id).status, 'running');
  assert.equal(f.requests.some(request => request.path.endsWith('/cancel')), false);
});

test('Models lists compatible LoRAs with picker metadata and fixed controls are refused by name', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const detail = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  assert.deepEqual(detail.loras.map(lora => lora.name), ['fixture-effect.safetensors', 'fixture-unknown.safetensors']);
  assert.deepEqual(detail.loras[0], { name: 'fixture-effect.safetensors', title: 'Glow Effect', description: 'Adds a soft neon glow.', trigger_words: ['glowfx'], strength: { recommended: 0.8, min: 0.2, max: 1.2 }, trained_for: 'FLUX.1', source_url: 'https://civitai.example.test/models/1' });
  assert.equal(detail.loras[1].compatibility, 'unverified');
  assert.equal(detail.loras_total, 2);
  assert.deepEqual(data(await call(client, 'Models', { profile_id: imageProfile.id, lora_query: 'glowfx' })).profiles[0].loras.map(lora => lora.name), ['fixture-effect.safetensors']);

  await f.profiles([{ ...imageProfile, capabilities: { ...imageProfile.capabilities, negativePrompt: false }, constraints: { ...imageProfile.constraints, steps: { min: 4, max: 4 }, cfg: { min: 1, max: 1 } }, defaults: { ...imageProfile.defaults, steps: 4, cfg: 1 } }]);
  const fixed = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0];
  for (const key of ['steps', 'cfg', 'negative_prompt']) assert.equal(fixed.controls[key], undefined, key);
  for (const key of ['steps', 'cfg']) assert.equal(fixed.defaults[key], undefined, key);
  for (const [field, value, pattern] of [['steps', 20, /steps cannot be adjusted.*fixed at 4.*Adjustable controls: width, height, count, seed/], ['cfg', 3, /cfg cannot be adjusted.*fixed at 1/], ['negative_prompt', 'Blur', /negative_prompt cannot be adjusted.*no negative prompt input/]]) {
    const result = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], [field]: value });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, pattern);
  }
  assert.equal(f.submitted.length, 0);
  await generate(client, { steps: 4 });
  assert.equal(f.submitted.length, 1, 'a value equal to the fixed one is accepted');
  const refused = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['refuse with reason'], count: 1 });
  assert.match(refused.content[0].text, /Studio refused the request: Fixture LoRA supports strength 0\.2 to 1\.2\./);
});

test('negative prompts reach the submission only where they take effect', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const cfgOne = { ...imageProfile, defaults: { ...imageProfile.defaults, cfg: 1 } };
  await f.profiles([cfgOne]);
  const advertised = data(await call(client, 'Models', { profile_id: imageProfile.id })).profiles[0].controls.negative_prompt;
  assert.match(advertised.note, /cfg 1/);
  const refused = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], negative_prompt: 'Blur' });
  assert.match(refused.content[0].text, /negative_prompt has no effect at cfg 1.*Set cfg above 1/);
  await generate(client, { negative_prompt: 'Blur', cfg: 4 });
  assert.deepEqual([f.submitted[0].negative, f.submitted[0].cfg], ['Blur', 4]);
  // A guidance-distilled profile locked at cfg 1 explains why instead of dropping the negative.
  await f.profiles([{ ...cfgOne, constraints: { ...imageProfile.constraints, cfg: { min: 1, max: 1 } } }]);
  const distilled = await call(client, 'Generate', { profile_id: imageProfile.id, prompts: ['A tree'], negative_prompt: 'Blur' });
  assert.match(distilled.content[0].text, /runs at cfg 1 \(guidance-distilled\)/);
  assert.equal(f.submitted.length, 1);
});

test('account watch pages read as the signed owner through the loopback credential, not a stored bearer', async t => {
  const token = 'account-mcp-token-for-watch-page-fixture';
  const account = { userId: 'stable-account-watch', role: 'user', authenticated: true, generationProfiles: [imageProfile.id], features: {} };
  const f = await fixture(t, { enabled: false, accountMode: true, authenticateAccountToken: value => value === token ? account : null, internalCredential: accountId => ({ 'X-Heiss-Mcp-Internal': 'fixture-internal', 'X-Heiss-Mcp-Account': accountId }) });
  const client = await f.client('', token);
  const [queued] = (await generate(client)).jobs;
  assert.equal(f.requests.find(request => request.path === '/loras/info')?.authorization, `Bearer ${token}`, 'LoRA metadata is read with the account’s own credential');
  const before = f.requests.length;
  const response = await fetch(localLink(f, queued.link));
  assert.equal(response.status, 200);
  const lookup = f.requests.slice(before).find(request => request.path === `/jobs/${queued.job_id}`);
  assert.deepEqual([lookup.authorization, lookup.internal, lookup.account], [undefined, 'fixture-internal', account.userId]);
});

const tiered = (id, label, extra = {}) => ({ ...structuredClone(imageProfile), id, label, prompting: { id: `${id}-guide`, summary: 'Guide summary', rules: ['A long rule the compact outputs must not repeat'] }, ...extra });
const tieredCatalogue = () => [
  tiered('qwen-quality', 'Qwen-Image · Quality · 40 Steps', { family: 'qwen' }),
  tiered('qwen-fast', 'Qwen-Image Turbo · Fast · 8 Steps', { family: 'qwen' }),
  tiered('krea-fast', 'Krea 2 Turbo · Fast · 8 Steps', { family: 'krea' }),
  tiered('krea-turbo', 'Krea 2 Turbo · Super Fast · 2 Steps', { family: 'krea' }),
  tiered('edit-turbo', 'Edit · Super Fast · 4 Steps', { family: 'edit', mediaInputs: [{ id: 'reference', kind: 'image', min: 1, max: 1, required: true }] }),
  { ...structuredClone(videoProfile), label: 'Video · Quality · 20 Steps' }
];

test('Models filters by tier and lists only id, label, kind, tier and a one-line summary', async t => {
  const f = await fixture(t);
  await f.profiles(tieredCatalogue(), { defaults: { image: 'qwen-quality', video: videoProfile.id } });
  const client = await f.client();
  const turbo = data(await call(client, 'Models', { kind: 'image', tier: 'turbo' }));
  assert.deepEqual(turbo.profiles.map(profile => profile.id), ['krea-turbo', 'edit-turbo']);
  assert.deepEqual(turbo.profiles[0], { id: 'krea-turbo', label: 'Krea 2 Turbo · Super Fast · 2 Steps', kind: 'image', tier: 'turbo', summary: imageProfile.description });
  assert.deepEqual(data(await call(client, 'Models', { kind: 'image', tier: 'fast' })).profiles.map(profile => profile.id), ['qwen-fast', 'krea-fast']);
  // No profile is labelled Standard here, so standard falls back to Quality.
  assert.deepEqual(data(await call(client, 'Models', { kind: 'all', tier: 'standard' })).profiles.map(profile => profile.id), ['qwen-quality', videoProfile.id]);
  const all = await call(client, 'Models', { kind: 'image' });
  assert.equal(all.content[0].text.includes('A long rule'), false);
  assert.equal(data(await call(client, 'Models', { profile_id: 'krea-turbo' })).profiles[0].tier, 'turbo');
});

test('Generate with kind and tier needs no Models call, picks the default profile for the tier and stays lean', async t => {
  const f = await fixture(t);
  await f.profiles(tieredCatalogue(), { defaults: { image: 'qwen-quality', video: videoProfile.id } });
  const client = await f.client();
  const fast = await call(client, 'Generate', { kind: 'image', tier: 'fast', prompts: ['An egg'], count: 1 });
  const result = data(fast);
  // Same family as the deployment default wins; the guide is applied server-side, not echoed.
  assert.deepEqual(result.profile, { id: 'qwen-fast', label: 'Qwen-Image Turbo · Fast · 8 Steps', tier: 'fast' });
  assert.deepEqual(Object.keys(result.jobs[0]), ['job_id', 'ref', 'link']);
  assert.equal(result.prompting, undefined);
  assert.equal(fast.content[0].text.includes('A long rule'), false);
  assert.equal(f.submitted[0].profileId, 'qwen-fast');
  assert.equal(f.requests.some(request => request.path === '/loras/info'), false);
  // A reference-only profile is skipped without references.
  assert.equal(data(await call(client, 'Generate', { tier: 'turbo', prompts: ['An egg'], count: 1 })).profile.id, 'krea-turbo');
  assert.equal(data(await call(client, 'Generate', { kind: 'image', prompts: ['An egg'], count: 1 })).profile.id, 'qwen-quality', 'no tier uses the deployment default');
  assert.equal(data(await call(client, 'Generate', { kind: 'video', tier: 'quality', prompts: ['A wave'], count: 1 })).profile.id, videoProfile.id);
  // A follow-up with the chosen profile_id does not repeat its guide.
  assert.equal(data(await call(client, 'Generate', { profile_id: 'qwen-fast', prompts: ['Another egg'], count: 1 })).prompting, undefined);
  const missing = await call(client, 'Generate', { kind: 'video', tier: 'turbo', prompts: ['A wave'] });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /No ready video profile in the turbo tier.*Available video tiers: quality, standard\./);
  assert.equal(f.submitted.length, 5);
});

test('tier-based Generate chooses only profiles the account may use', async t => {
  const tokens = { 'restricted-account-token-long-enough-for-the-fixture': 'restricted', 'full-account-token-that-is-long-enough-for-fixture': 'full' };
  const accounts = Object.fromEntries(Object.entries(tokens).map(([token, userId]) => [token, { userId, role: 'user', authenticated: true, generationProfiles: [], features: {} }]));
  const f = await fixture(t, { enabled: false, accountMode: true, authenticateAccountToken: value => accounts[value] || null });
  const restricted = ['qwen-fast', 'krea-fast'];
  await f.profiles(tieredCatalogue(), { defaults: { image: 'qwen-quality', video: videoProfile.id }, visibleTo: (authorization, profile) => !String(authorization).includes('restricted') || restricted.includes(profile.id) });
  const limited = await f.client('', Object.keys(tokens)[0]);
  // The deployment default is not visible to this account, so another permitted profile is chosen.
  assert.equal(data(await call(limited, 'Generate', { kind: 'image', prompts: ['An egg'], count: 1 })).profile.id, 'qwen-fast');
  assert.deepEqual(data(await call(limited, 'Models', { kind: 'image', tier: 'turbo' })).profiles, []);
  const refused = await call(limited, 'Generate', { kind: 'image', tier: 'turbo', prompts: ['An egg'] });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Available image tiers: fast\./);
  await failure(limited, 'Generate', { profile_id: 'krea-turbo', prompts: ['An egg'] });
  const full = await f.client('', Object.keys(tokens)[1]);
  assert.equal(data(await call(full, 'Generate', { kind: 'image', tier: 'turbo', prompts: ['An egg'], count: 1 })).profile.id, 'krea-turbo');
  assert.deepEqual(f.submitted.map(body => body.profileId), ['qwen-fast', 'krea-turbo']);
});

test('a background notification returns only its markdown unless detail is asked for', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const id = jobId(await generate(client));
  const pending = await call(client, 'Result', { job_id: id, delivery: 'notification', wait_seconds: 0 });
  assert.equal(pending.content.length, 1);
  assert.deepEqual(pending.structuredContent, { job_id: id, ref: 'result 1', status: 'running' });
  Object.assign(f.jobs.get(id), { status: 'done', outputs: [{ url: '/comfy/view?filename=lean.png' }] });
  const lean = await call(client, 'Result', { job_id: id, delivery: 'notification', wait_seconds: 0 });
  assert.equal(lean.content.length, 1);
  assert.match(lean.content[0].text, /^Result 1 is ready\. .+\n\n!\[Result 1\]\([^)]+\)\n\[View Original\]\([^)]+\)$/);
  assert.deepEqual(lean.structuredContent, { job_id: id, ref: 'result 1', status: 'done' });
  const detailed = await call(client, 'Result', { job_id: id, delivery: 'notification', wait_seconds: 0, detail: true });
  assert.equal(detailed.content.length, 2);
  assert.equal(detailed.structuredContent.outputs.length, 1);
  assert.ok(detailed.structuredContent.link && detailed.structuredContent.markdown);
});

test('Generate returns quick images inline as finished markdown, so no background Result is needed', async t => {
  const f = await fixture(t, { imageWaitSeconds: 30 });
  const client = await f.client();
  const started = performance.now();
  const pending = call(client, 'Generate', { kind: 'image', prompts: ['An egg'], count: 2 });
  setTimeout(() => { for (const job of f.jobs.values()) Object.assign(job, { status: 'done', outputs: [{ url: `/comfy/view?filename=${job.id}.png` }] }); }, 50);
  const result = await pending;
  assert.notEqual(result.isError, true);
  assert.ok(performance.now() - started < 5000, 'returns once the jobs finish, not at the deadline');
  assert.deepEqual(result.structuredContent, { status: 'done', profile: { id: imageProfile.id, label: imageProfile.label, tier: 'standard' }, jobs: [...f.jobs.keys()].map((job_id, index) => ({ job_id, ref: `result ${index + 1}` })) });
  assert.equal(result.content.length, 1);
  // The same markdown a background notification returns, one block per job.
  assert.match(result.content[0].text, /^Done\. Reply with the markdown below exactly.+\n\n!\[Result 1\]\(https:\/\/studio\.example\.test\/mcp\/results\/v2\.[^)]+\)\n\[View Original\]\([^)]+\)\n\n!\[Result 2\]\([^)]+\)\n\[View Original\]\([^)]+\)$/);
  const [, imageUrl] = /!\[[^\]]*\]\(([^)]+)\)/.exec(result.content[0].text);
  const original = await fetch(localLink(f, imageUrl));
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.equal(f.downloads.length, 1, 'only the link fetch downloads the output');
});

test('Generate falls back to the queued response when a job outlasts the wait or fails', async t => {
  const f = await fixture(t, { imageWaitSeconds: 30 });
  const client = await f.client();
  let started = performance.now();
  const slow = data(await call(client, 'Generate', { kind: 'image', prompts: ['An egg'], count: 1, wait_seconds: 1 }));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 4000, `waited ${Math.round(elapsed)} ms`);
  assert.equal(slow.status, 'queued');
  assert.deepEqual(Object.keys(slow.jobs[0]), ['job_id', 'ref', 'link']);
  assert.match(slow.message, /background|run_in_background/);
  started = performance.now();
  const pending = call(client, 'Generate', { kind: 'image', prompts: ['An egg', 'A nest'], count: 1 });
  setTimeout(() => { const [, failed] = [...f.jobs.values()].slice(-2); failed.status = 'failed'; }, 50);
  const mixed = data(await pending);
  assert.equal(mixed.status, 'queued');
  assert.equal(mixed.jobs.length, 2);
  assert.ok(performance.now() - started < 5000, 'a failed job ends the wait for the others');
});

test('the Generate wait ends promptly when the client cancels, without cancelling the generation', async t => {
  const f = await fixture(t, { imageWaitSeconds: 30 });
  const lookups = () => f.requests.filter(request => request.path.startsWith('/jobs/')).length;
  const client = await f.client();
  const controller = new AbortController();
  const waiting = client.callTool({ name: 'Generate', arguments: { kind: 'image', prompts: ['An egg'], count: 1 } }, undefined, { signal: controller.signal, timeout: 60000 });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(lookups() >= 1);
  controller.abort();
  await assert.rejects(waiting);
  const before = lookups();
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.equal(lookups() - before, 0, 'a cancelled wait stops polling');
  assert.equal(f.submitted.length, 1);
  assert.equal([...f.jobs.values()][0].status, 'running');
  assert.equal(f.requests.some(request => request.path.endsWith('/cancel')), false);
});

test('Generate does not wait for videos by default', async t => {
  const f = await fixture(t, { imageWaitSeconds: 30 });
  const client = await f.client();
  const started = performance.now();
  const queued = data(await call(client, 'Generate', { kind: 'video', prompts: ['A wave'], count: 1 }));
  assert.ok(performance.now() - started < 1500);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.profile.id, videoProfile.id);
  assert.equal(f.requests.some(request => request.path.startsWith('/jobs/')), false);
});

const finish = (f, extension = 'png') => { for (const job of f.jobs.values()) if (job.status !== 'done') Object.assign(job, { status: 'done', outputs: [{ url: `/comfy/view?filename=${job.id}.${extension}` }] }); };

test('Reuse runs a result again with its profile and settings, a new seed and an optional prompt, without Models', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const first = data(await call(client, 'Generate', { kind: 'image', prompts: ['A heron'], count: 1, width: 1024, height: 1024, cfg: 4, sampler: 'dpmpp_2m', seed: 7, negative_prompt: 'blur', loras: [{ name: 'fixture-effect.safetensors', strength: 0.6 }] }));
  finish(f);
  const models = () => f.requests.filter(request => request.path === '/models').length;
  const before = models();
  const again = data(await call(client, 'Reuse', { job_id: 'result 1', kind: 'image' }));
  assert.equal(again.status, 'queued');
  assert.deepEqual(again.profile, first.profile);
  assert.deepEqual(again.jobs.map(job => job.ref), ['result 2']);
  const [original, rerun] = f.submitted;
  for (const key of ['profileId', 'prompt', 'width', 'height', 'cfg', 'sampler', 'negative', 'loras']) assert.deepEqual(rerun[key], original[key], key);
  assert.equal(original.seed, '7');
  assert.equal(rerun.seed, '', 'a new seed');
  const tweaked = data(await call(client, 'Reuse', { job_id: 'result 1', kind: 'image', prompt: 'A heron at dusk', count: 2 }));
  assert.equal(tweaked.jobs.length, 2);
  assert.deepEqual(f.submitted.slice(2).map(body => [body.prompt, body.cfg]), [['A heron at dusk', 4], ['A heron at dusk', 4]]);
  assert.ok(models() - before <= 1, 'reads the cached catalogue at most once and needs no Models call');
  // A follow-up still waits like Generate, so a quick rerun returns finished markdown.
  f.completeOnSubmit();
  const quick = await call(client, 'Reuse', { job_id: 'result 1', kind: 'image', wait_seconds: 5 });
  assert.equal(quick.structuredContent?.status, 'done', JSON.stringify(quick.content));
  assert.match(quick.content[0].text, /^Done\. .+\n\n!\[Result 5\]\(https:\/\/studio\.example\.test\/mcp\/results\/v2\./);
  // Without kind, Reuse still returns a reference asset for Generate, and a rerun keeps a result's references.
  const { asset } = data(await call(client, 'Reuse', { job_id: 'result 1' }));
  assert.match(asset.id, /^fixture-asset-/);
  const edit = data(await call(client, 'Generate', { kind: 'image', prompts: ['Make it blue'], count: 1, reference_asset_ids: [asset.id] }));
  finish(f);
  data(await call(client, 'Reuse', { job_id: edit.jobs[0].ref, kind: 'image' }));
  assert.deepEqual(f.submitted.at(-1).referenceAssets, [{ slot: 'reference', assetId: asset.id }]);
});

test('Reuse animates an image from its first frame with the default first-frame video profile', async t => {
  const f = await fixture(t);
  const frame = [{ id: 'reference', kind: 'image', label: 'Optional First Frame', min: 0, max: 1, required: false }];
  const video = (id, label, extra = {}) => ({ ...structuredClone(videoProfile), id, label, mediaInputs: frame, aspectPolicy: 'reference', constraints: { width: { min: 256, max: 2048, step: 32 }, height: { min: 256, max: 2048, step: 32 } }, defaults: { width: 1344, height: 768, count: 1, steps: 8 }, ...extra });
  await f.profiles([
    structuredClone(imageProfile),
    { ...structuredClone(videoProfile), id: 'text-video', label: 'Text Video · Quality' },
    video('ref-fast', 'H3 Ref · Fast · 8 Steps', { mediaInputs: [{ ...frame[0], label: 'Reference Image' }] }),
    video('fl-quality', 'H3 FL · Quality · 20 Steps'),
    video('fl-fast', 'H3 FL · Fast · 8 Steps')
  ], { defaults: { image: imageProfile.id, video: 'text-video' } });
  const client = await f.client();
  data(await call(client, 'Generate', { kind: 'image', prompts: ['A heron'], count: 1 }));
  finish(f);
  const animated = data(await call(client, 'Reuse', { job_id: 'result 1', kind: 'video', prompt: 'The heron takes flight' }));
  assert.equal(animated.status, 'queued', 'videos do not wait by default');
  assert.deepEqual(animated.profile, { id: 'fl-fast', label: 'H3 FL · Fast · 8 Steps', tier: 'fast' });
  const body = f.submitted.at(-1);
  assert.equal(body.kind, 'video');
  assert.equal(body.prompt, 'The heron takes flight');
  assert.equal(body.referenceAssets.length, 1);
  assert.equal(body.referenceAssets[0].slot, 'reference');
  assert.ok(f.assets.has(body.referenceAssets[0].assetId), 'the image was uploaded as the first frame');
  // The 64×48 fixture image sets a 4:3 frame at the profile's 1344×768 pixel count, on its 32-pixel grid.
  assert.deepEqual([body.width, body.height], [1184, 864]);
  data(await call(client, 'Reuse', { job_id: 'result 1', kind: 'video', tier: 'quality' }));
  assert.equal(f.submitted.at(-1).profileId, 'fl-quality');
  assert.equal(f.submitted.at(-1).prompt, 'A heron', 'the image prompt by default');
  // A video cannot become an image, tiers are only for animation, and tier or prompt need a kind.
  finish(f, 'mp4');
  await failure(client, 'Reuse', { job_id: 'result 2', kind: 'image' });
  await failure(client, 'Reuse', { job_id: 'result 1', kind: 'image', tier: 'fast' });
  await failure(client, 'Reuse', { job_id: 'result 1', prompt: 'A heron at dusk' });
});

test('Reuse follow-ups respect ownership and Hidden results', async t => {
  const f = await fixture(t);
  const alice = await f.client('alice');
  const bob = await f.client('bob');
  const id = jobId(data(await call(alice, 'Generate', { kind: 'image', prompts: ['A heron'], count: 1 })));
  finish(f);
  const submitted = f.submitted.length;
  for (const kind of ['image', 'video']) await failure(bob, 'Reuse', { job_id: id, kind });
  f.jobs.get(id).privateVault = true;
  for (const kind of ['image', 'video']) await failure(alice, 'Reuse', { job_id: id, kind });
  assert.equal(f.submitted.length, submitted);
});
