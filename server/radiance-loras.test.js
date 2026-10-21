import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-radiance-loras-'));
process.env.STUDIO_DATA_DIR = scratch;
process.env.STUDIO_ENABLE_BUILTIN_PROFILES = '0';
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { metadataFromJson, saveCustomWorkflow } = await import('./custom-workflows.js');
const { customWorkflowGraph } = await import('./graphs.js');

const prompt = 'A lighthouse at dusk';
const raw = (loraStack, id = 'radiance-loras') => ({
  graph: {
    1: { class_type: 'RadianceImageGenerate', inputs: { model: 'krea-2-turbo-fp8.rad', prompt: '', seed: 0, width: 1024, height: 1024, loras: '[]' } }
  },
  heissUi: { id, capabilities: { lora: true }, controls: { prompt: { node: '1', input: 'prompt' }, seed: { node: '1', input: 'seed' } }, loraStack }
});
saveCustomWorkflow(raw({ adapter: 'radiance-tags-v1', node: '1' }));
const build = (loras) => customWorkflowGraph({ workflow: 'custom:radiance-loras', prompt, seed: 7, width: 1024, height: 1024, loras });

test('the Radiance adapter takes a stack of up to four by default, clamped to 1–8', () => {
  assert.deepEqual(metadataFromJson(raw({ adapter: 'radiance-tags-v1', node: 1 })).loraStack, { adapter: 'radiance-tags-v1', node: '1', max: 4 });
  assert.equal(metadataFromJson(raw({ adapter: 'radiance-tags-v1', node: '1', max: 20 })).loraStack.max, 8);
  assert.equal(metadataFromJson(raw({ adapter: 'radiance-tags-v1', node: '1', max: -3 })).loraStack.max, 1);
  assert.equal(metadataFromJson(raw({ adapter: 'radiance-tags-v1', node: '1' })).capabilities.lora, true);
  // The rgthree defaults are unchanged, and unknown adapters still connect nothing.
  assert.equal(metadataFromJson(raw({ adapter: 'rgthree-power-v1', node: '1' })).loraStack.max, 8);
  assert.equal(metadataFromJson(raw({ adapter: 'rgthree-stack-v1', node: '1' })).loraStack.max, 4);
  assert.equal(metadataFromJson(raw({ adapter: 'radiance-tags-v2', node: '1' })).loraStack, null);
  assert.equal(metadataFromJson(raw({ adapter: 'radiance-tags-v1' })).loraStack, null);
});

test('the Radiance node gets the enabled LoRAs as one JSON string, and the prompt stays as written', async () => {
  const none = await build([]);
  assert.equal(none[1].inputs.loras, '[]');
  assert.equal(none[1].inputs.prompt, prompt);
  assert.equal((await build(undefined))[1].inputs.loras, '[]');

  const one = await build([{ name: 'styles/film.safetensors', enabled: true, strength: '0.8' }]);
  assert.equal(one[1].inputs.loras, '[{"name":"styles/film.safetensors","strength":0.8}]');
  assert.equal(one[1].inputs.prompt, prompt);
  assert.doesNotMatch(one[1].inputs.prompt, /<lora:/);

  const two = await build([
    { name: 'b.safetensors', enabled: true, strength: 1.2 },
    { name: 'off.safetensors', enabled: false, strength: 1 },
    { name: 'a.safetensors', strength: -0.5 }
  ]);
  assert.deepEqual(JSON.parse(two[1].inputs.loras), [{ name: 'b.safetensors', strength: 1.2 }, { name: 'a.safetensors', strength: -0.5 }]);
});

test('the Radiance stack stops at its max', async () => {
  saveCustomWorkflow(raw({ adapter: 'radiance-tags-v1', node: '1', max: 2 }, 'radiance-two'));
  const graph = await customWorkflowGraph({ workflow: 'custom:radiance-two', prompt, seed: 1, width: 1024, height: 1024, loras: ['a', 'b', 'c'].map((name) => ({ name: `${name}.safetensors`, strength: 1 })) });
  assert.deepEqual(JSON.parse(graph[1].inputs.loras).map((lora) => lora.name), ['a.safetensors', 'b.safetensors']);
});
