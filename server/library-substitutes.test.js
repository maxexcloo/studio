import assert from 'node:assert/strict';
import test from 'node:test';
import { findSubstitute, nameParts } from './library-substitutes.js';

const installed = [
  { folder: 'diffusion_models', file: 'flux1-dev.safetensors' },
  { folder: 'checkpoints', file: 'dreamshaper_6.safetensors' },
  { folder: 'checkpoints', file: 'dreamshaper_7.safetensors' },
  { folder: 'checkpoints', file: 'dreamshaper_9.safetensors' },
  { folder: 'loras', file: 'watercolour-v1.safetensors' },
  { folder: 'loras', file: 'oil-paint.safetensors' },
  { folder: 'text_encoders', file: 't5xxl_fp16.safetensors' }
];
const profiles = [{ id: 'sdxl-base', label: 'SDXL Base', family: 'sdxl', model: 'sd_xl_base_1.0.safetensors' }];

test('names split into the model line, its version and its precision', () => {
  assert.deepEqual(nameParts('flux1-dev-fp8.safetensors'), { stem: 'flux1-dev-fp8', model: 'flux1-dev', line: 'flux1-dev', version: '', precision: 'fp8', gguf: false });
  assert.deepEqual(nameParts('flux1-dev-Q4_K_M.gguf'), { stem: 'flux1-dev-q4_k_m', model: 'flux1-dev', line: 'flux1-dev', version: '', precision: 'q4_k_m', gguf: true });
  assert.deepEqual(nameParts('t5xxl_fp8_e4m3fn.safetensors').precision, 'fp8_e4m3fn');
  assert.deepEqual([nameParts('dreamshaper_8').line, nameParts('dreamshaper_8').version], ['dreamshaper', '8']);
});

test('another precision of the same model comes first', () => {
  assert.deepEqual(findSubstitute({ file: 'flux1-dev-fp8.safetensors', folder: 'diffusion_models' }, installed, { role: 'diffusion_model' }),
    { file: 'flux1-dev.safetensors', folder: 'diffusion_models', kind: 'precision', reason: 'The same model in full precision instead of FP8' });
  assert.equal(findSubstitute({ file: 't5xxl_fp8_e4m3fn.safetensors', folder: 'text_encoders' }, installed, { role: 'text_encoder' }).file, 't5xxl_fp16.safetensors');
});

test('then the nearest other version, newer before older at the same distance', () => {
  assert.deepEqual(findSubstitute({ name: 'dreamshaper_8', folder: 'checkpoints' }, installed, { role: 'checkpoint' }),
    { file: 'dreamshaper_9.safetensors', folder: 'checkpoints', kind: 'version', reason: 'Version 9 instead of 8' });
  assert.equal(findSubstitute({ name: 'dreamshaper_6.5', folder: 'checkpoints' }, installed, { role: 'checkpoint' }).file, 'dreamshaper_6.safetensors');
  assert.deepEqual(findSubstitute({ name: 'watercolour-v2', folder: 'loras' }, installed, { role: 'lora' }),
    { file: 'watercolour-v1.safetensors', folder: 'loras', kind: 'version', reason: 'Version 1 instead of 2' });
});

test('a base model of the same family stands in through its profile; a LoRA never does', () => {
  assert.deepEqual(findSubstitute({ name: 'juggernautXL', folder: 'checkpoints' }, installed, { role: 'checkpoint', family: 'sdxl', familyName: 'SDXL', profiles }),
    { file: 'sd_xl_base_1.0.safetensors', folder: '', kind: 'family', profileId: 'sdxl-base', reason: 'Another SDXL model: SDXL Base' });
  assert.equal(findSubstitute({ name: 'film-grain', folder: 'loras' }, installed, { role: 'lora', family: 'sdxl', profiles }), null, 'a different LoRA is no substitute');
  assert.equal(findSubstitute({ name: 'juggernautXL', folder: 'checkpoints' }, installed, { role: 'checkpoint', family: 'flux1', profiles }), null, 'no profile of that family');
  assert.equal(findSubstitute({ file: '', name: '' }, installed), null);
  assert.equal(findSubstitute({ file: 'dreamshaper_7.safetensors', folder: 'checkpoints' }, installed, { role: 'checkpoint' }).file, 'dreamshaper_6.safetensors', 'the exact file itself is never its own substitute');
});
