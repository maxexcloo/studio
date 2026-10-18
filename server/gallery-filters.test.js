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

test("size bands follow the long edge without overlap, and aspect ratios snap within 4%", async () => {
  const { aspectOf, matchesGalleryFilters, sizeBandOf } = await import("./gallery-filters.js");
  const item = (width, height, extra = {}) => ({ status: "done", width, height, ...extra });
  assert.deepEqual([1024, 1025, 1536, 1537, 2048, 2049].map((edge) => sizeBandOf(item(edge, 512))), ["up-to-1k", "1k-1.5k", "1k-1.5k", "1.5k-2k", "1.5k-2k", "over-2k"]);
  assert.equal(sizeBandOf(item(768, 2048)), "1.5k-2k");
  assert.deepEqual([[1024, 1024], [1344, 768], [768, 1344], [1216, 832], [2560, 1080], [1000, 300]].map(([w, h]) => aspectOf(item(w, h))), ["1:1", "16:9", "9:16", "3:2", "21:9", "other"]);

  // Unknown sizes stay unless a size or aspect filter is on; pending jobs always stay.
  const unknown = { status: "done" };
  assert.equal(matchesGalleryFilters(unknown, {}), true);
  assert.equal(matchesGalleryFilters(unknown, { size: "up-to-1k" }), false);
  assert.equal(matchesGalleryFilters({ status: "pending" }, { size: "over-2k", aspect: "1:1" }), true);
  assert.equal(matchesGalleryFilters(item(2048, 2048), { size: "1.5k-2k", aspect: "1:1" }), true);
  assert.equal(matchesGalleryFilters(item(2048, 2048), { size: "over-2k" }), false);
});
