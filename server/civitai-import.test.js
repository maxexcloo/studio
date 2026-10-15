import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { civitaiFetch } from './civitai-access.js';
import { civitaiLink, imagePreset, importCivitaiImage, matchResources, versionResource } from './civitai-import.js';

const bytes = Buffer.from('test model weights');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const version = { id: 17, modelId: 9, name: 'V1', baseModel: 'SDXL 1.0', model: { name: 'Watercolour', type: 'LORA' }, files: [{ id: 3, name: 'style.safetensors', type: 'Model', primary: true, sizeKB: bytes.length / 1024, hashes: { SHA256: sha256 } }] };
const image = { id: 42, type: 'image', width: 832, height: 1216, url: 'https://image.civitai.com/example/image.jpeg', meta: { prompt: 'a landscape <lora:style:0>', negativePrompt: 'blur', steps: 28, cfgScale: 0, seed: 0, sampler: 'DPM++ 2M Karras', civitaiResources: [{ modelVersionId: 17, type: 'lora', weight: 0 }] } };

test('image links reject credentials, foreign hosts and unexpected query parameters', () => {
  assert.equal(civitaiLink('https://civitai.com/images/42').id, 42);
  for (const url of ['https://evil.example/images/42', 'http://civitai.com/images/42', 'https://civitai.com/images/42?token=secret', 'https://user@civitai.com/images/42', 'https://civitai.com/api/v1/images', 'https://civitai.com/images/0']) assert.throws(() => civitaiLink(url));
});

test('image metadata maps samplers and preserves zero seed, CFG and LoRA weight', () => {
  const preset = imagePreset(image);
  assert.equal(preset.prompt, 'a landscape');
  assert.equal(preset.negative, 'blur');
  assert.equal(preset.settings.seed, '0');
  assert.equal(preset.settings.cfg, 0);
  assert.equal(preset.settings.sampler, 'dpmpp_2m');
  assert.equal(preset.settings.scheduler, 'karras');
  assert.equal(preset.resources[0].weight, 0);
  assert.equal(preset.settings.height, 1216);
});

test('absent and unsupported metadata produce explicit partial imports', () => {
  const preset = imagePreset({ id: 42, modelVersionIds: [17] });
  assert.equal(preset.resources[0].weight, null);
  assert.match(preset.warnings.join(' '), /no generation metadata/);
  assert.throws(() => imagePreset({ ...image, type: 'video' }), /still image/);
  assert.equal(imagePreset({ ...image, url: 'http://127.0.0.1/private' }).previewUrl, '');
  const unknown = imagePreset({ ...image, meta: { ...image.meta, sampler: 'Invented Sampler' } });
  assert.equal(unknown.settings.sampler, undefined);
  assert.match(unknown.warnings.join(' '), /manual choice/);
});

test('exact versions are resolved independently; inaccessible resources remain visible', async () => {
  const calls = [];
  const preset = await importCivitaiImage('https://civitai.com/images/42', { json: async (url) => { calls.push(url); return url.startsWith('images?') ? { items: [image] } : version; } });
  assert.deepEqual(calls, ['images?imageId=42&withMeta=true', 'model-versions/17']);
  assert.equal(preset.resources[0].spec.sha256, sha256);
  const partial = await importCivitaiImage('https://civitai.com/images/42', { json: async (url) => { if (url.startsWith('images?')) return { items: [image] }; throw new Error('gone'); } });
  assert.equal(partial.resources[0].supported, false);
});

test('model downloads require safe formats, supported resource types and full checksums', () => {
  assert.equal(versionResource(version).spec.folder, 'loras');
  assert.equal(versionResource({ ...version, model: { type: 'TextualInversion' } }).spec, null);
  assert.equal(versionResource({ ...version, files: [{ ...version.files[0], name: '../model.safetensors' }] }).spec, null);
  assert.equal(versionResource({ ...version, files: [{ ...version.files[0], hashes: {} }] }).spec, null);
});

test('installed resources are identified by checksum, including renamed weights', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-preset-hashes-'));
  try {
    fs.writeFileSync(path.join(dir, 'renamed.safetensors'), bytes);
    fs.writeFileSync(path.join(dir, 'style.safetensors'), 'wrong');
    const preset = { resources: [versionResource(version)] };
    const match = await matchResources(preset, { loras: ['style.safetensors', 'renamed.safetensors'] }, { foldersFor: () => [dir] });
    assert.equal(match.resources[0].status, 'installed');
    assert.equal(match.resources[0].localName, 'renamed.safetensors');
    assert.equal(match.resources[0].spec, undefined);
    const conflict = await matchResources(preset, { loras: ['style.safetensors'] }, { foldersFor: () => [dir] });
    assert.equal(conflict.resources[0].status, 'conflict');
    fs.writeFileSync(path.join(dir, 'renamed.safetensors'), 'changed weights');
    const changed = await matchResources(preset, { loras: ['renamed.safetensors'] }, { foldersFor: () => [dir] });
    assert.equal(changed.resources[0].status, 'missing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Civitai authentication stays on its API origin through CDN redirects', async () => {
  const calls = [];
  const response = await civitaiFetch('https://civitai.com/api/download/models/17', {}, { token: 'test-token', transport: async (url, options) => {
    calls.push({ host: url.hostname, token: options.headers.get('authorization') });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://files.civitai.com/model?signature=private' } }) : new Response('weights');
  } });
  assert.equal(await response.text(), 'weights');
  assert.deepEqual(calls, [{ host: 'civitai.com', token: 'Bearer test-token' }, { host: 'files.civitai.com', token: null }]);
  await assert.rejects(civitaiFetch('https://civitai.com/api/download/models/17', {}, { transport: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) }), /Unsupported/);
  await assert.rejects(civitaiFetch('https://image.civitai.com/image', {}, { media: true, transport: async () => new Response(null, { status: 302, headers: { location: 'https://civitai.com/api/private' } }) }), /Unsupported/);
});
