import assert from 'node:assert/strict';
import test from 'node:test';
import { canRestoreLoras, composerSettings, modePrompts, modeSettings, modeReferences, savedModeReferences, reusedNegative } from '../src/app/composerSettings.js';

test('provider duration and resolution are independently saved for image and video modes', () => {
  const image = composerSettings({ model: 'custom:image2', resolution: '2k', duration: 6 });
  const video = composerSettings({ model: 'custom:video15', resolution: '1080p', duration: 12 });
  const saved = JSON.parse(JSON.stringify({ ...image, mode: 'image', modeSettings: { image, video } }));
  assert.deepEqual(modeSettings(saved), { image, video });
  assert.equal(modeSettings(saved).image.resolution, '2k');
  assert.equal(modeSettings(saved).video.resolution, '1080p');
  assert.equal(modeSettings(saved).video.duration, 12);
});

test('image and video settings survive saving and reloading independently', () => {
  const image = { model: 'flux', count: 4, width: 768, height: 1024, steps: 25, loras: [{ name: 'portrait', strength: 0.8 }] };
  const video = { model: 'h3', count: 1, frames: 241, fps: 24, steps: 50, loras: [] };
  const draft = { ...video, mode: 'video', modeSettings: { image, video } };
  assert.deepEqual(modeSettings(JSON.parse(JSON.stringify(draft))), { image, video });
  assert.deepEqual(modeSettings({ ...image, mode: 'image' }), { image }, 'older single-mode drafts retain their settings');
});

test('per-mode settings do not store Hidden prompt or reference details', () => {
  const privateDetails = { prompt: 'private prompt', negative: 'private negative', referenceAssets: [{ name: 'private reference' }], startImage: 'private pixels', startImageName: 'private name' };
  assert.deepEqual(composerSettings({ model: 'flux', ...privateDetails }), { model: 'flux' });
  assert.deepEqual(modeSettings({ mode: 'image', model: 'flux', modeSettings: { video: { model: 'h3', ...privateDetails } } }), { image: { model: 'flux' }, video: { model: 'h3' } });
});

test('reusing outputs without a negative prompt preserves the current negative', () => {
  for (const empty of [undefined, null, '', '   ']) assert.equal(reusedNegative(empty, 'avoid blur'), 'avoid blur');
  assert.equal(reusedNegative('avoid noise', 'avoid blur'), 'avoid noise');
});

test('late workflow hydration cannot replace newer LoRA edits', () => {
  assert.equal(canRestoreLoras(0, 0, true), true);
  assert.equal(canRestoreLoras(0, 1, true), false, 'selecting or editing a LoRA while the request runs wins');
  assert.equal(canRestoreLoras(0, 0, false), false);
});

test('image and video prompts and negatives remain independent across reloads', () => {
  const image = { prompt: 'an image', negative: 'image exclusions' };
  const video = { prompt: 'a video', negative: 'video exclusions' };
  const draft = { mode: 'video', ...video, modePrompts: { image, video } };
  assert.deepEqual(modePrompts(JSON.parse(JSON.stringify(draft))), { image, video });
  assert.equal(reusedNegative(undefined, modePrompts(draft).image.negative), image.negative, 'missing image negatives retain the image draft');
});

test('legacy prompts migrate only to the active mode and Hidden starts empty', () => {
  assert.deepEqual(modePrompts({ mode: 'video', prompt: 'legacy video', negative: 'avoid blur' }), {
    image: { prompt: '', negative: '' }, video: { prompt: 'legacy video', negative: 'avoid blur' }
  });
  const gallery = modePrompts({ mode: 'image', prompt: 'public prompt' });
  let hidden = modePrompts();
  hidden.image = { prompt: 'private image', negative: 'private exclusions' };
  hidden.video = { prompt: 'private video', negative: '' };
  const draft = { mode: 'image', ...gallery.image, modePrompts: gallery };
  assert.doesNotMatch(JSON.stringify(draft), /private/);
  hidden = modePrompts();
  assert.deepEqual(hidden, { image: { prompt: '', negative: '' }, video: { prompt: '', negative: '' } }, 'locking clears both private modes');
});

test('photo and video reference selections survive reloads without sharing private previews', () => {
  const references = modeReferences({ mode: 'image', referenceAssets: [{ slot: 'reference', asset: { id: 'photo-reference' } }], modeReferences: { video: { id: 'video-reference', name: 'First Frame', assets: [] } } });
  assert.equal(references.image.assets[0].asset.id, 'photo-reference');
  assert.equal(references.video.id, 'video-reference');
  references.image = { id: 'vault:private-id', image: 'private-pixels', name: 'private-name', assets: [{ slot: 'reference', asset: { id: 'vault:private-id', source: 'vault', name: 'private-name', thumbnailUrl: 'private-preview' } }] };
  const saved = savedModeReferences(references);
  assert.doesNotMatch(JSON.stringify(saved), /private-pixels|private-name|private-preview/);
  assert.equal(saved.image.assets[0].asset.id, 'vault:private-id');
  assert.equal(saved.video.id, 'video-reference');
});
