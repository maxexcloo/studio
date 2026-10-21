import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { imageFromUpload, inspectInstalled, libraryItems, matchImageResource, removeInstalled } from './library-routes.js';

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
