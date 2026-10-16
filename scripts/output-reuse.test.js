import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseReusedSettings, outputProfile, reuseNumber } from '../src/app/outputReuse.js';

test('reuse associates saved identity and provider model aliases with ready profiles', () => {
  const profiles = [
    { id: 'local', kind: 'image', model: 'flux.safetensors', workflow: 'family:flux' },
    { id: 'custom:provider', kind: 'image', model: 'custom:provider', defaults: { model: 'provider-image-2' } },
    { id: 'missing', kind: 'image', model: 'absent.safetensors', ready: false }
  ];
  assert.equal(outputProfile(profiles, { type: 'image', settings: { profileId: 'local' } }), profiles[0]);
  assert.equal(outputProfile(profiles, { type: 'image', settings: { profileId: 'old-provider-id', modelName: 'provider-image-2' } }), profiles[1]);
  assert.equal(outputProfile(profiles, { type: 'image', model: 'missing', settings: { profileId: 'missing' } }), undefined);
});

test('reuse tolerates model folder and separator changes only when the filename identifies one installed model', () => {
  const profiles = [{ id: 'new', kind: 'image', model: 'new/Flux.SAFETENSORS' }];
  assert.equal(outputProfile(profiles, { type: 'image', model: 'old\\flux.safetensors' }), profiles[0]);
  assert.equal(outputProfile([...profiles, { id: 'other', kind: 'image', model: 'other/flux.safetensors' }], { type: 'image', model: 'old/flux.safetensors' }), undefined);
});

test('a shared family workflow cannot silently associate an absent model with different weights', () => {
  const profiles = [{ id: 'new', kind: 'image', family: 'flux', model: 'new.safetensors', workflow: 'family:flux' }];
  assert.equal(outputProfile(profiles, { type: 'image', model: 'removed.safetensors', settings: { workflow: 'family:flux' } }), undefined);
  assert.equal(outputProfile(profiles, { type: 'image', settings: { workflow: 'family:flux' } }), undefined);
  assert.equal(outputProfile(profiles, { type: 'image', model: 'flux' }), undefined);
  assert.equal(outputProfile(profiles, { type: 'video', model: 'new.safetensors' }), undefined);
});

test('reused dimensions snap to the selected profile grid even at unaligned range boundaries', () => {
  const profile = { defaults: { width: 1024, height: 1024 }, constraints: { width: { min: 257, max: 2047, step: 32 }, height: { min: 257, max: 2047, step: 32 } } };
  const settings = normaliseReusedSettings(profile, { width: 901, height: 3333 }, { fallback: true });
  assert.equal(settings.width, 896);
  assert.equal(settings.height, 2016);
  for (const value of [settings.width, settings.height]) { assert.equal(value % 32, 0); assert.ok(value >= 257 && value <= 2047); }
});

test('reuse prefers requested dimensions to resized or upscaled output dimensions', () => {
  const settings = normaliseReusedSettings({ defaults: {}, constraints: { width: { step: 32 }, height: { step: 32 } } }, { width: 4096, height: 4096, settings: { width: 1024, height: 768 } });
  assert.equal(settings.width, 1024);
  assert.equal(settings.height, 768);
});

test('foreign model settings use valid current defaults and discard foreign parts and LoRAs', () => {
  const profile = { defaults: { cfg: 4, sampler: 'euler', textEncoder: 'current-encoder', vae: 'current-vae' }, capabilities: { lora: true }, encoderSlots: [{ default: 'current-encoder', options: ['current-encoder'] }], constraints: { cfg: { min: 1, max: 10, step: 0.5 }, steps: { min: 1, max: 50 } }, options: { samplers: ['euler'] } };
  const settings = normaliseReusedSettings(profile, { settings: { cfg: 200, steps: 900, sampler: 'unknown', textEncoder: 'foreign', vae: 'foreign', loras: [{ name: 'foreign' }] } }, { fallback: true });
  assert.equal(settings.cfg, 10);
  assert.equal(settings.steps, 50);
  assert.equal(settings.sampler, 'euler');
  assert.equal(settings.vae, 'current-vae');
  assert.deepEqual(settings.textEncoders, ['current-encoder']);
  assert.deepEqual(settings.loras, []);
});

test('fixed canvas and video references follow the selected profile policy', () => {
  const settings = normaliseReusedSettings({ kind: 'video', aspectPolicy: 'fixed', defaults: { width: 832, height: 480 }, mediaInputs: [], capabilities: { startImage: true } }, { width: 1024, height: 2048 });
  assert.equal(settings.width, 832);
  assert.equal(settings.height, 480);
  assert.equal(settings.hasImageInput, false);
  const image = normaliseReusedSettings({ kind: 'image', defaults: {}, mediaInputs: [], capabilities: { startImage: true } }, {});
  assert.equal(image.hasImageInput, true);
});

test('reuse respects numeric step origins, fractional settings and invalid numbers', () => {
  assert.equal(reuseNumber(28, 29, { min: 5, max: 125, offset: 5, step: 8 }), 29);
  assert.equal(reuseNumber(3.78, 4, { min: 1, max: 10, step: 0.5 }), 4);
  assert.equal(reuseNumber(Infinity, 512, { min: 256, max: 1024, step: 32 }), 512);
  assert.equal(reuseNumber(5, 5, { min: 5, max: 6, step: 8 }), undefined);
});
