import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { civitaiOffers, fileFits, hfOffers, publicOffers, variantWords } from './library-offers.js';

const { model } = JSON.parse(fs.readFileSync(new URL('./fixtures/civitai/model-offers.json', import.meta.url), 'utf8'));
const familiesOf = (base) => /flux/i.test(base) ? ['flux1'] : /sdxl/i.test(base) ? ['sdxl'] : [];
const version = (id) => ({ ...model.modelVersions.find((item) => item.id === id), modelId: model.id, model: { name: model.name, type: model.type } });
const now = Date.parse('2026-10-21T00:00:00Z');

test('Civitai offers: newer and older versions of the family, and the version’s other files', () => {
  const offers = civitaiOffers({ model, version: version(703), familiesOf, gguf: true, now });
  assert.deepEqual(offers.map(({ label, relation, file, variant }) => [label, relation, file, variant]), [
    ['v3', 'precision', 'nightfall-v3-bf16.safetensors', 'BF16'],
    ['v3', 'format', 'nightfall-v3-Q4_K_M.gguf', 'GGUF Q4_K_M'],
    ['v4 Early', 'newer', 'nightfall-v4-fp8.safetensors', 'FP8'],
    ['v1', 'older', 'nightfall-v1-fp8.safetensors', 'FP8']
  ], 'the SDXL version is another family; the VAE isn’t a model file');
  const gguf = offers.find((offer) => offer.relation === 'format');
  assert.equal(gguf.folder, 'diffusion_models');
  assert.equal(gguf.spec.url, 'https://civitai.com/api/download/models/703?type=Diffusion%20Model&format=GGUF&size=full');
  assert.equal(offers[0].spec.sha256, '34'.repeat(32));
  assert.equal(offers[0].bytes, 22_000_000 * 1024);
});

test('a paid or early-access offer stays refused, without a download', () => {
  const offers = civitaiOffers({ model, version: version(703), familiesOf, gguf: true, now });
  const paid = offers.find((offer) => offer.relation === 'newer');
  assert.deepEqual([paid.unavailable.reason, paid.unavailable.note, paid.spec], ['paid', 'Downloads cost 800 Buzz on Civitai.', undefined]);
  assert.equal(paid.unavailable.freeAlternative, undefined, 'no free newer version exists');
  // From v1, v3 is a free newer version to suggest instead of v4.
  const fromOld = civitaiOffers({ model, version: version(701), familiesOf, gguf: true, now });
  const refused = fromOld.find((offer) => offer.label === 'v4 Early');
  assert.deepEqual(refused.unavailable.freeAlternative, { versionId: 703, name: 'v3', url: 'https://civitai.com/models/70?modelVersionId=703', key: 'civitai:703:7031' });
  assert.deepEqual(publicOffers([refused])[0].downloadable, false);
  assert.equal(publicOffers(fromOld).find((offer) => offer.label === 'v3').spec, undefined, 'specs stay on the server');
});

test('without the GGUF loader, GGUF files aren’t offered', () => {
  const offers = civitaiOffers({ model, version: version(703), familiesOf, gguf: false, now });
  assert.equal(offers.some((offer) => offer.file.endsWith('.gguf')), false);
  assert.deepEqual(fileFits('model.gguf', 'diffusion_models', { gguf: false }), { fits: false, note: 'The worker has no GGUF loader' });
  assert.deepEqual(fileFits('model.gguf', 'loras', { gguf: true }).fits, false, 'LoRAs never come as GGUF');
  assert.deepEqual(fileFits('model.ckpt', 'checkpoints'), { fits: false, note: 'Not a SafeTensors or GGUF file' });
});

test('an unknown family keeps only versions on the same base model', () => {
  const offers = civitaiOffers({ model, version: version(703), familiesOf: () => [], gguf: true, now });
  assert.equal(offers.some((offer) => offer.label === 'v2 SDXL'), false);
});

test('Hugging Face offers: the same model’s other precisions and formats in the repository', () => {
  const sha = (digit) => digit.repeat(64);
  const siblings = [
    { rfilename: 'flux1-dev-fp8.safetensors', lfs: { sha256: sha('a'), size: 11 } },
    { rfilename: 'flux1-dev.safetensors', lfs: { sha256: sha('b'), size: 22 } },
    { rfilename: 'flux1-dev-Q8_0.gguf', lfs: { sha256: sha('c'), size: 12 } },
    { rfilename: 'flux1-schnell.safetensors', lfs: { sha256: sha('d'), size: 22 } },
    { rfilename: 'ae.safetensors', lfs: { sha256: sha('e'), size: 1 } },
    { rfilename: 'flux1-dev-bf16.safetensors' }
  ];
  const offers = hfOffers({ siblings, chosenPath: 'flux1-dev-fp8.safetensors', repo: 'org/flux', revision: 'f'.repeat(40), folder: 'diffusion_models', gguf: true });
  assert.deepEqual(offers.map(({ file, relation, variant, downloadable = Boolean(offers.find((o) => o.file === file).spec) }) => [file, relation, variant, downloadable]), [
    ['flux1-dev-bf16.safetensors', 'precision', 'BF16', false],
    ['flux1-dev-Q8_0.gguf', 'format', 'GGUF Q8_0', true],
    ['flux1-dev.safetensors', 'precision', 'SafeTensors', true]
  ]);
  assert.equal(offers[0].unavailable.reason, 'no-checksum');
  assert.equal(offers[1].spec.url, `https://huggingface.co/org/flux/resolve/${'f'.repeat(40)}/flux1-dev-Q8_0.gguf`);
  assert.equal(variantWords('x-fp8_e4m3fn.safetensors'), 'FP8');
});
