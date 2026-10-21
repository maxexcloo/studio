import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectInstalled, libraryItems } from './library-routes.js';

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
