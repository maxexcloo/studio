import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { chatUrl, createHandoverStore, registerChatRoutes } from './chat-handover.js';

test('the chat address is a plain HTTP(S) base, or nothing', () => {
  assert.equal(chatUrl({ STUDIO_CHAT_URL: 'https://chat.example.test/' }), 'https://chat.example.test');
  assert.equal(chatUrl({ STUDIO_CHAT_URL: 'https://chat.example.test/librechat' }), 'https://chat.example.test/librechat');
  for (const value of ['', 'javascript:alert(1)', 'https://user:pass@chat.example.test', 'https://chat.example.test/?q=1', 'not a url']) assert.equal(chatUrl({ STUDIO_CHAT_URL: value }), '', value);
});

test('a handover is the owning account’s alone, kept on disk for a while', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-handover-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-21T00:00:00Z');
  const store = createHandoverStore({ dataDir, now: () => clock });
  store.record('job-1', 'account-a');
  const again = createHandoverStore({ dataDir, now: () => clock });
  assert.equal(again.claim('account-a', 'job-1', { accountMode: true }), true);
  assert.equal(again.claim('account-b', 'job-1', { accountMode: true }), false);
  assert.equal(again.claim('', 'job-1', { accountMode: true }), false);
  assert.equal(again.claim('account-a', 'job-2', { accountMode: true }), false);
  assert.equal(again.claim('hashed-owner', 'job-1'), false, 'an account’s handover is not single-user mode’s');
  store.record('job-3', '');
  assert.equal(createHandoverStore({ dataDir, now: () => clock }).claim('hashed-owner', 'job-3'), true, 'single-user mode: this studio’s chat');
  clock += 31 * 24 * 60 * 60 * 1000;
  assert.equal(createHandoverStore({ dataDir, now: () => clock }).claim('account-a', 'job-1', { accountMode: true }), false, 'old handovers lapse');
  assert.throws(() => store.record('../x', 'a'), /Choose a result/);
});

test('only a result the account owns can be handed over', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-handover-routes-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createHandoverStore({ dataDir });
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, { store, ownerId: () => 'account-a', owned: (_req, jobId) => jobId === 'mine', environment: { STUDIO_CHAT_URL: 'https://chat.example.test' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/chat`)).json(), { ok: true, url: 'https://chat.example.test' });
  const post = (jobId) => fetch(`${base}/api/chat/handover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
  assert.equal((await post('theirs')).status, 404);
  assert.equal((await post('mine')).status, 200);
  assert.equal(store.claim('account-a', 'mine', { accountMode: true }), true);
  assert.equal(store.claim('account-a', 'theirs', { accountMode: true }), false);
});
