import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { registerAiControlRoutes } from './ai-control-routes.js';

const key = 'fixture-control-key-never-shown';
const catalogue = {
  media: [{ id: 'off', label: 'Off' }],
  models: [{ id: 'off', label: 'Off' }, { id: 'radiance-flashnext', label: 'Radiance - Qwen Flash Next · 2 GPUs' }],
  rules: {
    profiles: { off: [], 'comfyui-image': ['0', '1'], 'radiance-flashnext': ['0,1'] },
    runtime_names: { text: 'Text', image: 'ComfyUI Image' },
    workloads: {
      'comfyui-image': { container: 'ai-image', kind: 'image', label: 'ComfyUI Image', placements: ['0', '1'], runtime: 'image' },
      'radiance-flashnext': { container: 'ai-text', kind: 'text', label: 'Text', model_label: 'Radiance - Qwen Flash Next · 2 GPUs', placements: ['0,1'], runtime: 'text' }
    }
  },
  services: [{ title: 'Radiance', url: 'https://control.invalid/radiance/' }]
};
const status = {
  runtimes: { image: { running: true, profile: 'comfyui-image', devices: ['1'], health: 'healthy' }, text: { running: false, profile: '', devices: [], health: 'stopped' } },
  gpu_metrics: { 0: { name: 'GPU Zero', busy_percent: 3 }, 1: { name: 'GPU One', vram_total_bytes: 32 } },
  host_metrics: { memory_total_bytes: 1 },
  gpu0: 'Available', gpu1: 'ComfyUI Image',
  updated: '2026-10-21T00:00:00+00:00',
  job: { id: 'abc123', state: 'running', stage: 'Starting', started_at: 1, output: `secret log ${key}` }
};

async function fixture(t, { environment = { CONTROL_URL: 'http://control.invalid/', CONTROL_API_KEY: key }, reply } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const route = new URL(url).pathname.replace(/^\/api\//, '');
    const custom = reply?.(route, init);
    if (custom) return custom;
    if (route === 'status') return Response.json(status);
    if (route === 'catalogue') return Response.json(catalogue);
    if (route === 'board/plan') return Response.json({ allocation: [], keep: [], start: [{ profile: 'radiance-flashnext', devices: ['0', '1'], runtime: 'text' }], stop: ['image'], signature: 'a'.repeat(64) });
    if (route === 'board') return Response.json({ id: 'job1', state: 'running', stage: 'Preparing', started_at: 2, output: '', allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'] }] }, { status: 202 });
    if (route === 'restart') return Response.json({ id: 'job2', state: 'running', stage: 'Preparing', started_at: 3, output: '', restart: { runtime: 'image', profile: 'comfyui-image', devices: ['1'] } }, { status: 202 });
    if (route.startsWith('jobs/')) return Response.json({ id: 'job1', state: 'completed', stage: 'Ready', started_at: 2, finished_at: 9, output: 'long log' });
    return new Response('Not Found', { status: 404 });
  };
  const app = express();
  app.use(express.json());
  // A request is an administrator when the test says so; nothing a browser sends decides it.
  registerAiControlRoutes(app, { environment, fetchImpl, isAdmin: (req) => req.get('x-test-role') === 'administrator' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, { body, role = 'administrator', headers = {} } = {}) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-test-role': role, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const raw = await response.text();
    return { status: response.status, raw, body: JSON.parse(raw) };
  };
  return { api, calls };
}

test('status reaches every signed-in account, with GPUs and labels but no logs, host metrics or links', async (t) => {
  const { api, calls } = await fixture(t);
  const result = await api('/api/ai-control/status', { role: 'user' });
  assert.equal(result.status, 200);
  assert.equal(result.body.admin, false);
  assert.deepEqual(result.body.status.gpus.map((gpu) => [gpu.device, gpu.name]), [['0', 'GPU Zero'], ['1', 'GPU One']]);
  assert.deepEqual(result.body.status.runtimes.image, { running: true, profile: 'comfyui-image', devices: ['1'], health: 'healthy' });
  assert.deepEqual(result.body.status.job, { id: 'abc123', state: 'running', stage: 'Starting', startedAt: 1, finishedAt: null });
  assert.deepEqual(result.body.catalogue.workloads.map((item) => [item.profile, item.label, item.placements]), [['comfyui-image', 'ComfyUI Image', ['0', '1']], ['radiance-flashnext', 'Radiance - Qwen Flash Next', ['0,1']]]);
  for (const hidden of ['secret log', 'host_metrics', 'control.invalid', 'container', key]) assert.ok(!result.raw.includes(hidden), hidden);
  assert.deepEqual(calls.map((call) => call.url), ['http://control.invalid/api/status', 'http://control.invalid/api/catalogue']);
  // The catalogue is kept for a while; status is asked each time.
  await api('/api/ai-control/status', { role: 'user' });
  assert.deepEqual(calls.slice(2).map((call) => call.url), ['http://control.invalid/api/status']);
});

test('Studio sends its own key and never a browser’s cookies or headers, and never shows the key', async (t) => {
  const { api, calls } = await fixture(t);
  await api('/api/ai-control/status', { headers: { cookie: 'studio_account=browser-session', authorization: 'Bearer browser-token', 'x-forwarded-for': '10.0.0.9' } });
  for (const call of calls) assert.deepEqual(call.headers, { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
  const plan = await api('/api/ai-control/plan', { body: { allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'], extra: 'dropped' }], replace: true } });
  assert.equal(plan.status, 200);
  assert.deepEqual(calls.at(-1).body, { allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'] }] });
  assert.deepEqual(plan.body.plan, { keep: [], stop: ['image'], start: [{ profile: 'radiance-flashnext', runtime: 'text', devices: ['0', '1'] }], signature: 'a'.repeat(64) });
  for (const result of [plan, await api('/api/ai-control'), await api('/api/ai-control/jobs/job1')]) {
    assert.ok(!result.raw.includes(key));
    assert.ok(!/authorization|bearer/i.test(result.raw));
  }
});

test('ordinary accounts get 403 on every change and AI Control is never asked', async (t) => {
  const { api, calls } = await fixture(t);
  for (const [path, body] of [
    ['/api/ai-control/plan', { allocation: [] }],
    ['/api/ai-control/apply', { allocation: [], signature: 'a'.repeat(64) }],
    ['/api/ai-control/restart', { runtime: 'image', profile: 'comfyui-image', devices: ['1'] }]
  ]) {
    const result = await api(path, { body, role: 'user' });
    assert.equal(result.status, 403, path);
    assert.equal(result.body.ok, false);
  }
  assert.equal((await api('/api/ai-control/jobs/job1', { role: 'user' })).status, 403);
  assert.equal(calls.length, 0);
});

test('apply sends the previewed board with its signature and replace, then the job is followed without its output', async (t) => {
  const { api, calls } = await fixture(t);
  assert.equal((await api('/api/ai-control/apply', { body: { allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'] }] } })).status, 400);
  assert.equal(calls.length, 0);
  const applied = await api('/api/ai-control/apply', { body: { allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'] }], signature: 'b'.repeat(64) } });
  assert.equal(applied.status, 202);
  assert.deepEqual(calls.at(-1), { url: 'http://control.invalid/api/board', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: { allocation: [{ profile: 'radiance-flashnext', devices: ['0', '1'] }], signature: 'b'.repeat(64), replace: true } });
  assert.equal(applied.body.job.id, 'job1');
  const job = await api('/api/ai-control/jobs/job1');
  assert.deepEqual(job.body.job, { id: 'job1', state: 'completed', stage: 'Ready', startedAt: 2, finishedAt: 9 });
  assert.equal((await api('/api/ai-control/jobs/..%2Fstatus')).status, 404);
  const restarted = await api('/api/ai-control/restart', { body: { runtime: 'image', profile: 'comfyui-image', devices: ['1'] } });
  assert.equal(restarted.status, 202);
  assert.deepEqual(calls.at(-1).body, { runtime: 'image', profile: 'comfyui-image', devices: ['1'] });
});

test('AI Control’s own refusals pass through; its failures and a refused key read calmly', async (t) => {
  let answer;
  const { api } = await fixture(t, { reply: (route) => route === 'board' ? answer() : null });
  answer = () => new Response('The live allocation changed. Review the refreshed preview before applying.', { status: 409 });
  let result = await api('/api/ai-control/apply', { body: { allocation: [], signature: 'c'.repeat(64) } });
  assert.deepEqual([result.status, result.body.error], [409, 'The live allocation changed. Review the refreshed preview before applying.']);
  answer = () => new Response(`Bad key ${key}`, { status: 401 });
  result = await api('/api/ai-control/apply', { body: { allocation: [], signature: 'c'.repeat(64) } });
  assert.deepEqual([result.status, result.body.error], [502, 'AI Control refused Studio’s key.']);
  answer = () => new Response(`echo ${key}`, { status: 409 });
  result = await api('/api/ai-control/apply', { body: { allocation: [], signature: 'c'.repeat(64) } });
  assert.ok(!result.raw.includes(key));
  answer = () => { throw new TypeError('connect ECONNREFUSED'); };
  result = await api('/api/ai-control/apply', { body: { allocation: [], signature: 'c'.repeat(64) } });
  assert.deepEqual([result.status, result.body.error], [502, 'AI Control is unavailable.']);
});

test('without CONTROL_URL and CONTROL_API_KEY nothing is asked and the page reads Not Connected', async (t) => {
  const { api, calls } = await fixture(t, { environment: { CONTROL_URL: 'http://control.invalid' } });
  assert.deepEqual((await api('/api/ai-control', { role: 'user' })).body, { ok: true, configured: false, admin: false });
  assert.deepEqual((await api('/api/ai-control/status', { role: 'user' })).body, { ok: true, configured: false });
  assert.equal((await api('/api/ai-control/plan', { body: { allocation: [] } })).status, 503);
  assert.equal(calls.length, 0);
});
