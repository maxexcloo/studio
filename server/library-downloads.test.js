import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-library-downloads-'));
process.env.STUDIO_DATA_DIR = path.join(dir, 'data');
process.env.STUDIO_COMFY_ROOT = dir;
process.env.STUDIO_ENABLE_PRESETS = '1';
fs.mkdirSync(path.join(dir, 'models', 'loras'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'data', 'model-download-sources.json'), JSON.stringify({ 'civitai:17:3': { id: 'civitai:17:3', file: 'style.safetensors', folder: 'loras', url: 'https://civitai.com/api/download/models/17' } }));
const { libraryDownload, libraryDownloadAccess, resolveModelLink, startLibraryDownload } = await import('./library-downloads.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('Hugging Face preview pins a revision and requires the published checksum', async () => {
  const result = await resolveModelLink('https://huggingface.co/owner/repo/blob/main/sub/style.safetensors', 'loras', { request: async () => Response.json({ sha: 'a'.repeat(40), siblings: [{ rfilename: 'sub/style.safetensors', lfs: { sha256: 'b'.repeat(64), size: 15 } }] }) });
  assert.equal(result.url, `https://huggingface.co/owner/repo/resolve/${'a'.repeat(40)}/sub/style.safetensors`);
  assert.equal(result.sha256, 'b'.repeat(64));
  for (const url of ['https://huggingface.co/a/b/blob/main/file.safetensors?token=private', 'http://huggingface.co/a/b/blob/main/file.safetensors', 'https://other.example/model.safetensors']) await assert.rejects(resolveModelLink(url), /without credentials/);
});

test('Civitai alternate-domain model pages resolve their latest version with model type intact', async () => {
  const result = await resolveModelLink('https://civitai.red/models/9', 'vae', { json: async () => ({ id: 9, name: 'Style', type: 'LORA', modelVersions: [{ id: 17, files: [{ id: 3, type: 'Model', name: 'style.safetensors', hashes: { SHA256: 'c'.repeat(64) } }] }] }) });
  assert.equal(result.folder, 'loras');
  assert.match(result.url, /models\/17\?/);
  await assert.rejects(resolveModelLink('https://civitai.com/models/9?modelVersionId=18', 'loras', { json: async () => ({ id: 18, modelId: 10 }) }), /another model/);
});

test('local imports never accept a different existing file as installed', async () => {
  fs.writeFileSync(path.join(dir, 'models', 'loras', 'existing.safetensors'), 'old model');
  assert.equal(libraryDownloadAccess().available, true);
  await assert.rejects(startLibraryDownload({ id: 'civitai:17:3', file: 'existing.safetensors', folder: 'loras', url: 'https://civitai.com/api/download/models/17', sha256: 'a'.repeat(64) }), /different model/);
  assert.equal(fs.readFileSync(path.join(dir, 'models', 'loras', 'existing.safetensors'), 'utf8'), 'old model');
});

test('disabled instances cannot resume previously resolved provider downloads', async () => {
  const spec = libraryDownload('civitai:17:3');
  assert.ok(spec);
  try {
    delete process.env.STUDIO_ENABLE_PRESETS;
    assert.equal(libraryDownload('civitai:17:3'), null);
    await assert.rejects(startLibraryDownload(spec), /disabled on this instance/);
  } finally { process.env.STUDIO_ENABLE_PRESETS = '1'; }
});
