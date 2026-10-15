import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-workflow-modes-'));
process.env.HEISS_DATA_DIR = scratch;
process.env.HEISS_ENABLE_BUILTIN_PROFILES = '0';
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { metadataFromJson, saveCustomWorkflow, validateGraph } = await import('./custom-workflows.js');
const { customWorkflowGraph } = await import('./graphs.js');
const { inferModels } = await import('./models.js');
const { sanitizeGenerateBody } = await import('./validation.js');

const graph = {
  1: { class_type: 'CLIPTextEncode', inputs: { text: 'source negative' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, denoise: 0.65, negative: ['1', 0] } },
  3: { class_type: 'LoadImage', inputs: { image: 'example.png' } },
  4: { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'test' } },
  5: { class_type: 'VAEDecode', inputs: {} },
  6: { class_type: 'Power Lora Loader (rgthree)', inputs: {} }
};
const generate = structuredClone(graph);
delete generate[3];
generate[4].inputs.images = ['5', 0];
generate[2].inputs.denoise = 1;
generate[7] = { class_type: 'BasicGuider', inputs: {} };
const controls = { prompt: { node: '1', input: 'text' }, seed: { node: '2', input: 'seed' } };
const raw = { graph, heissUi: {
  id: 'mode-test', capabilities: { lora: true }, loraStack: { adapter: 'rgthree-power-v1', node: '6' },
  controls: { ...controls, negative: { node: '1', input: 'text' }, denoise: { node: '2', input: 'denoise' }, startImage: { node: '3', input: 'image' } },
  imageModes: {
    generate: { graph: generate, controls, capabilities: { lora: true } },
    reference: { graph, controls: { ...controls, negative: { node: '1', input: 'text' }, denoise: { node: '2', input: 'denoise' }, startImage: { node: '3', input: 'image' } }, capabilities: { lora: true } }
  }
} };
const list = (required = {}) => ({ input: { required } });
const info = Object.fromEntries([...Object.values(graph), ...Object.values(generate)].map((node) => [node.class_type, list()]));
info.LoraLoader = list({ lora_name: [['style.safetensors']] });
info.KSampler = list({ sampler_name: [['euler']], scheduler: [['simple']], denoise: ['FLOAT', { default: 1, min: 0, max: 1, step: 0.01 }] });

saveCustomWorkflow(raw);

test('mode metadata derives controls independently and checks nodes used only by generation', () => {
  const workflow = metadataFromJson(raw);
  assert.equal(workflow.imageModes.generate.capabilities.negativePrompt, false);
  assert.equal(workflow.imageModes.generate.capabilities.denoise, false);
  assert.equal(workflow.imageModes.reference.capabilities.negativePrompt, true);
  assert.equal(workflow.imageModes.reference.capabilities.denoise, true);
  assert.ok(workflow.requiredNodes.includes('BasicGuider'));
  assert.equal(workflow.mediaInputs.length, 1);
});

test('custom profile discovery advertises installed LoRAs and compact mode capabilities', () => {
  const profile = inferModels(info).profiles.find((item) => item.id === 'custom:mode-test');
  assert.deepEqual(profile.options.loras, ['style.safetensors']);
  assert.equal(profile.capabilities.negativePrompt, false);
  assert.equal(profile.capabilities.denoise, false);
  assert.equal(profile.imageModes.generate.capabilities.negativePrompt, false);
  assert.equal(profile.imageModes.reference.capabilities.negativePrompt, true);
  assert.equal(profile.mediaInputs.length, 1);
  assert.ok(!('graph' in profile.imageModes.generate));
  saveCustomWorkflow({ ...raw, heissUi: { ...raw.heissUi, id: 'no-loras', capabilities: { lora: false } } });
  assert.deepEqual(inferModels(info).profiles.find((item) => item.id === 'custom:no-loras').options.loras, []);
});

test('mode selection reaches final graphs, preserves fixed generation denoise and binds reference LoRAs', async () => {
  const request = { kind: 'image', workflow: 'custom:mode-test', model: 'custom:mode-test', prompt: 'A scene', denoise: 0.3, loras: [{ name: 'style.safetensors', strength: 0.5 }] };
  const generated = await customWorkflowGraph(sanitizeGenerateBody(request, info));
  validateGraph(generated);
  assert.ok(!generated[3]);
  assert.equal(generated[2].inputs.denoise, 1);
  assert.equal(generated[6].inputs.lora_1.lora, 'style.safetensors');
  const checked = sanitizeGenerateBody({ ...request, referenceAssets: [{ slot: 'reference', assetId: 'image' }] }, info);
  checked.referenceAssets[0].comfyName = 'staged.png';
  const referenced = await customWorkflowGraph(checked);
  validateGraph(referenced);
  assert.equal(referenced[3].inputs.image, 'staged.png');
  assert.equal(referenced[2].inputs.denoise, 0.3);
});
