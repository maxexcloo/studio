import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichLocalLoraInfo, enrichLoraInfo, optionalLoraIssue } from './lora-catalogue.js';

const families = { krea2: { label: 'Krea 2' }, qwen_image: { label: 'Qwen-Image' }, qwen_image_21: { label: 'Qwen-Image 2.1' } };
const detect = ({ base_model }) => base_model === 'Qwen-Image 2.1' ? ['qwen_image_21'] : base_model === 'Krea 2' ? ['krea2'] : [];
const source = { id: 'civitai:3346363:3233286', file: 'slider.safetensors', folder: 'loras', label: 'Published Slider Name', version: 'V1', baseModel: 'Qwen 2.1', trainedWords: ['larger', 'smaller'] };
const info = { families: ['qwen_image'], base: 'Qwen-Image', triggers: [] };
const enrich = (metadata, name, sources) => enrichLoraInfo(metadata, name, sources, detect, families);

test('uses Civitai names, versions, triggers and the specific Qwen generation', () => {
  const result = enrich(info, source.file, { source });
  assert.equal(result.title, 'Published Slider Name · V1');
  assert.deepEqual(result.families, ['qwen_image_21']);
  assert.equal(result.base, 'Qwen-Image 2.1');
  assert.deepEqual(result.triggers, ['larger', 'smaller']);
  assert.equal(source.file, 'slider.safetensors');
});

test('does not override an incompatible tensor architecture', () => {
  const result = enrich({ ...info, families: ['krea2'] }, source.file, { source });
  assert.deepEqual(result.families, ['krea2']);
  assert.equal(result.base, 'Krea 2');
});

test('preserves unknown files, nested names and ambiguous provider records', () => {
  assert.equal(enrich(info, 'other.safetensors', { source }), info);
  assert.equal(enrich(info, 'subfolder/' + source.file, { source }), info);
  assert.equal(enrich(info, source.file, { source, duplicate: { ...source } }), info);
  assert.equal(enrich(info, source.file, { source: { ...source, folder: 'checkpoints' } }), info);
});

test('old saved download records improve titles without inventing a family', () => {
  const { baseModel, version, trainedWords, ...legacy } = source;
  const result = enrich(info, source.file, { legacy });
  assert.equal(result.title, source.label);
  assert.deepEqual(result.families, info.families);
});

test('uses pinned Hugging Face source metadata without changing download recovery fields', () => {
  const official = {
    id: `hf:publisher/Krea2:${'a'.repeat(40)}:loras/darkbrush.safetensors`,
    file: 'darkbrush.safetensors', folder: 'loras', label: 'Darkbrush',
    version: 'Style · FP32', baseModel: 'Krea 2', trainedWords: ['darkbrush'],
    sourceUrl: 'https://huggingface.co/publisher/Krea2',
  };
  const before = structuredClone(official);
  const result = enrich({ families: [], triggers: [] }, official.file, { official });
  assert.equal(result.title, 'Darkbrush · Style · FP32');
  assert.deepEqual(result.families, ['krea2']);
  assert.equal(result.base, 'Krea 2');
  assert.deepEqual(result.triggers, ['darkbrush']);
  assert.equal(result.sourceUrl, official.sourceUrl);
  assert.deepEqual(official, before);
  assert.equal(enrich(info, official.file, { official: { ...official, id: official.id.replace('a'.repeat(40), 'main') } }), info);
});


test('local converted adapter metadata has no fabricated provider or download identity', () => {
  const entry = { title: 'FastH3 · 4-Step · Preview V1 · BF16', baseModel: 'Krea 2', role: 'acceleration', note: 'Use the prepared recipe.' };
  const result = enrichLocalLoraInfo({ families: [], triggers: [] }, 'converted.safetensors', { 'converted.safetensors': entry }, detect, families);
  assert.equal(result.title, entry.title);
  assert.equal(result.role, 'acceleration');
  assert.equal(result.sourceUrl, undefined);
  assert.deepEqual(result.families, ['krea2']);
  assert.equal(enrichLocalLoraInfo(info, 'other.safetensors', { 'converted.safetensors': entry }, detect, families), info);
  const contradictory = enrichLocalLoraInfo({ ...info, families: ['qwen_image_21'] }, 'converted.safetensors', { 'converted.safetensors': entry }, detect, families);
  assert.deepEqual(contradictory.families, ['qwen_image_21']);
});


test('generation refuses infrastructure in optional stacks without modifying saved selections', () => {
  const stack = [{ name: 'turbo', enabled: true, strength: 1 }, { name: 'source', enabled: false, strength: 1 }];
  const before = structuredClone(stack);
  assert.match(optionalLoraIssue(stack, { turbo: { role: 'acceleration' } }), /prepared recipe/);
  assert.equal(optionalLoraIssue(stack, { source: { role: 'supporting' } }), '');
  assert.equal(optionalLoraIssue(stack, {}), '');
  assert.deepEqual(stack, before);
});


test('existing descriptions and safe source links survive local and provider enrichment', () => {
  const entry = { title: 'Effect', description: 'Use at 0.5 for subtle detail.', sourceUrl: 'https://example.com/model' };
  const local = enrichLocalLoraInfo(info, source.file, { [source.file]: entry }, detect, families);
  const provider = enrich(info, source.file, { source: { ...source, ...entry } });
  for (const result of [local, provider]) {
    assert.equal(result.description, entry.description);
    assert.equal(result.sourceUrl, entry.sourceUrl);
  }
  assert.equal(enrich(info, source.file, { source: { ...source, sourceUrl: 'javascript:alert(1)' } }).sourceUrl, undefined);
});
