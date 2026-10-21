import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-warmup-'));
process.env.STUDIO_DATA_DIR = dataDir;
const media = path.join(dataDir, 'media', 'heiss-ui');
fs.mkdirSync(media, { recursive: true });
let encoder;
try { encoder = createRequire(import.meta.url)('ffmpeg-static'); } catch { encoder = 'ffmpeg'; }
let canEncode = true;
try { execFileSync(encoder, ['-version'], { stdio: 'ignore' }); } catch { canEncode = false; }

const picture = (name) => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3a7' } }).png().toFile(path.join(media, name));
await picture('a-newest.png');
await picture('b-private.png');
await picture('c-new-output.png');
if (canEncode) execFileSync(encoder, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, 'clip.mp4')]);
const urls = (filename) => {
  const query = new URLSearchParams({ filename, subfolder: 'heiss-ui', type: 'media' });
  return { url: `/comfy/view?${query}`, thumbnailUrl: `/comfy/thumb?${query}` };
};
const record = (filename, type, minutesAgo, extra = {}) => ({ ...urls(filename), id: urls(filename).url, filename, type, status: 'done', createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...extra });
fs.writeFileSync(path.join(dataDir, 'gallery.json'), JSON.stringify([
  record('a-newest.png', 'image', 1),
  ...(canEncode ? [record('clip.mp4', 'video', 3)] : [])
]));

const { warmGallery, warmNewOutputs } = await import('./media-warmup.js');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const files = (folder, pattern) => { try { return fs.readdirSync(path.join(dataDir, folder)).filter((name) => pattern.test(name)); } catch { return []; } };

test('a pass builds the gallery’s thumbnails, display copies, posters and previews', async () => {
  await warmGallery();
  assert.equal(files('.thumbnails', /\.webp$/).length, 2, 'the image’s thumbnail and display copy');
  if (canEncode) {
    assert.equal(files('.video-previews', /\.jpg$/).length, 1, 'the video’s poster');
    assert.equal(files('.video-previews', /\.mp4$/).length, 1, 'the video’s grid preview');
  }
  // A second pass finds everything done and builds nothing.
  const before = fs.readdirSync(path.join(dataDir, '.thumbnails')).length;
  const started = performance.now();
  await warmGallery();
  assert.ok(performance.now() - started < 1000);
  assert.equal(fs.readdirSync(path.join(dataDir, '.thumbnails')).length, before);
});

test('a delivered output’s thumbnail and display copy are built straight away, before any browser asks', async () => {
  warmNewOutputs([urls('c-new-output.png')]);
  for (let tries = 0; files('.thumbnails', /\.webp$/).length < 4 && tries < 100; tries += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(files('.thumbnails', /\.webp$/).length, 4);
});
