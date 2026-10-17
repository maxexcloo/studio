import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichLoraInfo } from './lora-catalogue.js';

const families = { krea2: { label: 'Krea 2' }, qwen_image: { label: 'Qwen-Image' }, qwen_image_21: { label: 'Qwen-Image 2.1' } };
const detect = ({ base_model }) => base_model === 'Qwen-Image 2.1' ? ['qwen_image_21'] : [];
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
