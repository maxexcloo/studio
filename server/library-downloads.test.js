import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-library-downloads-'));
process.env.HEISS_DATA_DIR = path.join(dir, 'data');
process.env.HEISS_COMFY_ROOT = dir;
process.env.HEISS_ENABLE_PRESETS = '1';
delete process.env.HEISS_MODEL_DOWNLOAD_URL;
fs.mkdirSync(path.join(dir, 'models', 'loras'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'data', 'model-download-sources.json'), JSON.stringify({ 'civitai:17:3': { id: 'civitai:17:3', file: 'style.safetensors', folder: 'loras', url: 'https://civitai.com/api/download/models/17' } }));
const { controlRequest, libraryDownload, libraryDownloadAccess, resolveModelLink, startLibraryDownload } = await import('./library-downloads.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('Hugging Face preview pins a revision and requires the published checksum', async () => {
  const result = await resolveModelLink('https://huggingface.co/owner/repo/blob/main/sub/style.safetensors', 'loras', { request: async () => Response.json({ sha: 'a'.repeat(40), siblings: [{ rfilename: 'sub/style.safetensors', lfs: { sha256: 'b'.repeat(64), size: 15 } }] }) });
  assert.equal(result.url, `https://huggingface.co/owner/repo/resolve/${'a'.repeat(40)}/sub/style.safetensors`);
  assert.equal(result.sha256, 'b'.repeat(64));
  for (const url of ['https://huggingface.co/a/b/blob/main/file.safetensors?token=private', 'http://huggingface.co/a/b/blob/main/file.safetensors', 'https://other.example/model.safetensors']) await assert.rejects(resolveModelLink(url), /without credentials/);
});

test('Civitai model pages resolve their latest version with model type intact', async () => {
  const result = await resolveModelLink('https://civitai.com/models/9', 'vae', { json: async () => ({ id: 9, name: 'Style', type: 'LORA', modelVersions: [{ id: 17, files: [{ id: 3, type: 'Model', name: 'style.safetensors', hashes: { SHA256: 'c'.repeat(64) } }] }] }) });
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

test('delegated requests use only the configured API path and never follow redirects', async () => {
  const env = { HEISS_MODEL_DOWNLOAD_URL: 'http://control.internal:9090/api', HEISS_MODEL_DOWNLOAD_TOKEN: 'test-only' };
  const response = await controlRequest('downloads', { directory: 'loras', filename: 'style.safetensors', url: 'https://civitai.com/api/download/models/17' }, { env, request: async (url, init) => {
    assert.equal(url.href, 'http://control.internal:9090/api/downloads');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer test-only');
    assert.equal(JSON.parse(init.body).directory, 'loras');
    return Response.json({ id: 'a'.repeat(24), state: 'running' });
  } });
  assert.equal(response.state, 'running');
  await assert.rejects(controlRequest('downloads', null, { env, request: async () => new Response(null, { status: 403 }) }), /HTTP 403/);
});

test('disabled instances cannot resume previously resolved provider downloads', async () => {
  const spec = libraryDownload('civitai:17:3');
  assert.ok(spec);
  try {
    delete process.env.HEISS_ENABLE_PRESETS;
    assert.equal(libraryDownload('civitai:17:3'), null);
    await assert.rejects(startLibraryDownload(spec), /disabled on this instance/);
  } finally { process.env.HEISS_ENABLE_PRESETS = '1'; }
});
