import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { imageFromUpload, inspectInstalled, libraryItems, matchImageResource, registerLibraryRoutes, removeInstalled } from './library-routes.js';
import { createImportStore } from './library-imports.js';
import { createCatalogueStore } from './library-catalogue.js';

test('installed files join the catalogue, and catalogued files that are not installed still list', () => {
  const items = libraryItems({
    installed: { loras: ['style.safetensors'], vae: ['ae.safetensors'] },
    entries: {
      'loras/style.safetensors': { kind: 'lora', title: 'Style', version: 'V2', origin: 'import', source: { provider: 'civitai', modelId: 9 }, links: { civitaiCom: 'https://civitai.com/models/9' }, triggers: [], description: 'x'.repeat(900) },
      'loras/later.safetensors': { kind: 'lora', title: 'Later', origin: 'seed' }
    },
    loraInfo: { 'style.safetensors': { role: 'effect', base: 'Krea 2', families: ['krea2'], triggers: ['wtrclr'] } }
  });
  assert.deepEqual(items.map((item) => [item.key, item.installed]), [['vae/ae.safetensors', true], ['loras/later.safetensors', false], ['loras/style.safetensors', true]]);
  const style = items.find((item) => item.key === 'loras/style.safetensors');
  assert.deepEqual([style.title, style.role, style.baseModel, style.families, style.triggers, style.origin, style.source.provider], ['Style', 'effect', 'Krea 2', ['krea2'], ['wtrclr'], 'import', 'civitai']);
  assert.equal(style.description.length, 600, 'descriptions are cut short for the list');
});

test('a wanted file is installed by checksum, unverified by name and size, or a conflict', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-inspect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('weights');
  fs.writeFileSync(path.join(dir, 'style.safetensors'), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const foldersFor = () => [dir];
  const want = { file: 'style.safetensors', folder: 'loras', sha256, bytes: bytes.length };
  assert.deepEqual(await inspectInstalled(want, { foldersFor }), { status: 'installed', unverified: true }, 'the list never reads a model');
  assert.deepEqual(await inspectInstalled(want, { foldersFor, verify: true }), { status: 'installed' });
  assert.deepEqual(await inspectInstalled({ ...want, sha256: 'f'.repeat(64) }, { foldersFor, verify: true }), { status: 'conflict' });
  assert.deepEqual(await inspectInstalled({ ...want, file: 'other.safetensors' }, { foldersFor }), { status: 'missing' });
  assert.deepEqual(await inspectInstalled({ ...want, folder: 'nowhere' }, { foldersFor }), { status: 'missing' });
});

test('an import from chat goes through the same pipeline, records chat as its origin and shows in the history; catalogue edits undo', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-library-chat-'));
  const presets = process.env.STUDIO_ENABLE_PRESETS;
  process.env.STUDIO_ENABLE_PRESETS = '1';
  t.after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); if (presets === undefined) delete process.env.STUDIO_ENABLE_PRESETS; else process.env.STUDIO_ENABLE_PRESETS = presets; });
  const { model, versions } = JSON.parse(fs.readFileSync(new URL('./fixtures/civitai/model-versions.json', import.meta.url), 'utf8'));
  const json = async (pathname) => pathname === 'models/9' ? model : Object.values(versions).find((item) => item.id === Number(pathname.split('/')[1]));
  const catalogue = createCatalogueStore({ dataDir, log: {} });
  const app = express();
  app.use(express.json());
  // MCP's admin tools arrive with the administrator's MCP credential (multi-user-auth.js).
  app.use((req, _res, next) => { if (req.headers['x-test-chat']) req.studioAccount = { id: 'admin-1', role: 'administrator', credential: 'mcp-admin' }; next(); });
  registerLibraryRoutes(app, {
    presets: {}, installed: async () => ({}), loraInfo: async () => ({}), catalogue: () => catalogue, json,
    inspect: async () => ({ status: 'missing' }), downloads: () => ({ active: null, queued: [], recent: [] }), startDownload: async () => ({}),
    store: createImportStore({ dataDir, log: {} }), schedule: false
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, chat = true) => (await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', ...(chat ? { 'x-test-chat': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

  const { import: record } = await call('POST', '/api/library/imports', { url: 'https://civitai.com/models/9?modelVersionId=20' });
  assert.deepEqual([record.origin, record.by, record.state, record.grade.value], ['chat', 'admin-1', 'needs-files', 'partial']);
  assert.deepEqual(record.resources.map((resource) => [resource.want.file, resource.status]), [['watercolour-v2.safetensors', 'missing']]);
  assert.equal(catalogue.entry('loras/watercolour-v2.safetensors').origin, 'chat', 'its catalogue entry is from chat too');
  const ui = await call('POST', '/api/library/imports', { url: 'https://civitai.com/models/9?modelVersionId=20' }, false);
  assert.equal(ui.import.origin, 'ui');
  const history = (await call('GET', '/api/library/imports', undefined, false)).imports;
  assert.deepEqual(history.map((item) => item.origin).sort(), ['chat', 'ui'], 'both show in Library › Import');

  const edited = await call('PATCH', '/api/library/catalogue', { key: 'loras/watercolour-v2.safetensors', patch: { title: 'Watercolour FX', notes: 'Soft edges.' } });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.deepEqual([edited.entry.title, edited.entry.origin], ['Watercolour FX', 'chat']);
  assert.ok(Object.hasOwn(edited.previous, 'title'), 'the previous values come back');
  const refused = await call('PATCH', '/api/library/catalogue', { key: 'loras/watercolour-v2.safetensors', patch: { bytes: 5 } });
  assert.equal(refused.ok, false, 'an edit changes no provenance');
  const undone = await call('POST', '/api/library/catalogue/undo', { key: 'loras/watercolour-v2.safetensors' });
  assert.notEqual(undone.entry.title, 'Watercolour FX');
});

test('an old model file is removed only while it is still the recorded file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-remove-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('old weights');
  fs.writeFileSync(path.join(dir, 'old.safetensors'), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const foldersFor = () => [dir];
  await assert.rejects(removeInstalled({ folder: 'loras', file: 'old.safetensors', sha256: 'f'.repeat(64) }, { foldersFor }), /has changed/);
  assert.ok(fs.existsSync(path.join(dir, 'old.safetensors')));
  assert.deepEqual(await removeInstalled({ folder: 'loras', file: 'old.safetensors', sha256 }, { foldersFor }), { removed: true });
  assert.equal(fs.existsSync(path.join(dir, 'old.safetensors')), false);
  assert.deepEqual(await removeInstalled({ folder: 'loras', file: 'old.safetensors', sha256 }, { foldersFor }), { removed: false });
  await assert.rejects(removeInstalled({ folder: 'nowhere', file: 'x.safetensors' }, { foldersFor }), /isn’t a model file/);
});

test('dropped images arrive as data URLs, PNG, WebP or JPEG only', () => {
  assert.deepEqual(imageFromUpload(`data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`), Buffer.from('png bytes'));
  assert.throws(() => imageFromUpload('data:image/gif;base64,R0lGOD'), /PNG, WebP or JPEG/);
  assert.throws(() => imageFromUpload('https://example.com/a.png'), /PNG, WebP or JPEG/);
});

test('a recorded file matches its catalogue checksum first, then the exact name, Civitai, then the stem', async () => {
  const entries = { 'loras/style-v2.safetensors': { title: 'Style', version: 'V2', sha256: `abcdef0123${'0'.repeat(54)}`, links: { civitaiCom: 'https://civitai.com/models/9' }, source: { provider: 'civitai', modelId: 9 } } };
  const installed = { loras: ['style-v2.safetensors', 'grain.safetensors'], checkpoints: ['base.safetensors'] };
  const calls = [];
  const json = async (url) => { calls.push(url); throw new Error('offline'); };
  const byHash = await matchImageResource({ role: 'lora', folder: 'loras', name: 'renamed', hash: 'abcdef0123' }, { installed, entries, json });
  assert.deepEqual([byHash.name, byHash.want.file, byHash.matchedBy, byHash.want.source.url], ['Style', 'style-v2.safetensors', 'hash', 'https://civitai.com/models/9']);
  const byName = await matchImageResource({ role: 'checkpoint', folder: 'checkpoints', file: 'base.safetensors' }, { installed, entries, json });
  assert.deepEqual([byName.want.file, byName.matchedBy, byName.nameOnly], ['base.safetensors', 'name', true]);
  const byStem = await matchImageResource({ role: 'lora', folder: 'loras', name: 'Grain', hash: '9999999999' }, { installed, entries, json });
  assert.deepEqual([byStem.want.file, byStem.matchedBy, calls], ['grain.safetensors', 'name', ['model-versions/by-hash/9999999999']], 'Civitai is asked before a name-only match');
  const none = await matchImageResource({ role: 'vae', folder: 'vae', name: 'mystery-vae' }, { installed, entries, json });
  assert.deepEqual([none.unsourced, none.want.folder, none.want.file], [true, 'vae', '']);
});
