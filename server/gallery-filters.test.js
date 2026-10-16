import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesGalleryFilters } from './gallery-filters.js';

const item = { model: 'flux.safetensors', status: 'done', prompt: 'Qwen in the snow', settings: { modelName: 'Flux Fast', profileId: 'custom:landscape', workflow: 'Landscape Photo', loras: [{ name: 'film-grain.safetensors' }] } };

test('structured filters match their own metadata and combine across fields', () => {
  assert.equal(matchesGalleryFilters(item, { model: 'FLUX', workflow: 'landscape', lora: 'grain' }), true);
  assert.equal(matchesGalleryFilters(item, { model: 'landscape' }), false, 'workflow identifiers are not model names');
  assert.equal(matchesGalleryFilters(item, { model: 'qwen' }), false, 'a prompt mention is not a model match');
  assert.equal(matchesGalleryFilters(item, { model: 'flux', lora: 'portrait' }), false);
  assert.equal(matchesGalleryFilters({ status: 'error' }, { model: 'flux' }), false);
  assert.equal(matchesGalleryFilters(item, { workflow: '   ' }), true);
});

test('pending jobs remain visible while filtering completed media', () => {
  assert.equal(matchesGalleryFilters({ status: 'pending' }, { model: 'unrelated', workflow: 'missing' }), true);
});
