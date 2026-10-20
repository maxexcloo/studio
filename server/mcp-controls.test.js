import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertAdjustable, cfgIgnoresNegative, mcpControls, mcpLoras, prepareLoras, resolveLoraName } from './mcp-controls.js';
import { familyGraph } from './family-graph.js';
import { McpMedia, maxResultWaitSeconds } from './mcp-media.js';

const profile = {
  id: 'image:sdxl', label: 'SDXL', kind: 'image', family: 'sdxl', workflow: 'family:sdxl',
  capabilities: { negativePrompt: true, cfg: true, steps: true, seed: true, sampler: true, scheduler: true, lora: true },
  constraints: { width: { min: 256, max: 4096 }, height: { min: 256, max: 4096 }, steps: { min: 1, max: 150 }, cfg: { min: 0, max: 30 } },
  defaults: { width: 1024, height: 1024, steps: 25, cfg: 7, sampler: 'euler', scheduler: 'karras' },
  options: { samplers: ['euler', 'dpmpp_2m'], schedulers: ['karras', 'normal'], loras: ['style.safetensors'] },
  mediaInputs: []
};

test('adjustable controls omit fixed, single-option and unsupported Generate arguments', () => {
  const controls = mcpControls(profile);
  assert.deepEqual(Object.keys(controls), ['width', 'height', 'count', 'seed', 'steps', 'cfg', 'negative_prompt', 'sampler', 'scheduler', 'loras', 'upscale_quality', 'face_detail']);
  const turbo = mcpControls({ ...profile, capabilities: { ...profile.capabilities, negativePrompt: true, sampler: false }, constraints: { ...profile.constraints, steps: { min: 8, max: 8 }, cfg: { min: 1, max: 1 } }, defaults: { ...profile.defaults, steps: 8, cfg: 1 }, options: { ...profile.options, schedulers: ['simple'], loras: [] } });
  for (const key of ['steps', 'cfg', 'negative_prompt', 'sampler', 'scheduler', 'loras']) assert.equal(turbo[key], undefined, key);
  assert.equal(mcpControls({ ...profile, kind: 'video' }).upscale_quality, undefined);
});

test('negative prompts are refused with an explanation where CFG 1 ignores them', () => {
  assert.equal(cfgIgnoresNegative(1), true);
  assert.equal(cfgIgnoresNegative(0), false);
  assert.doesNotThrow(() => assertAdjustable(profile, { negative_prompt: 'blurry' }));
  assert.throws(() => assertAdjustable({ ...profile, defaults: { ...profile.defaults, cfg: 1 } }, { negative_prompt: 'blurry' }), /no effect at cfg 1.*Set cfg above 1 \(up to 30\)/);
  assert.doesNotThrow(() => assertAdjustable({ ...profile, defaults: { ...profile.defaults, cfg: 1 } }, { negative_prompt: 'blurry', cfg: 5 }));
  assert.doesNotThrow(() => assertAdjustable({ ...profile, capabilities: { ...profile.capabilities, negativePrompt: false } }, { negative_prompt: '' }), 'an empty negative is harmless');
  assert.throws(() => assertAdjustable(profile, { sampler: 'heun' }), /Choose sampler from: euler, dpmpp_2m/);
  assert.throws(() => assertAdjustable(profile, { steps: 200 }), /Choose steps from 1 to 150/);
});

test('an accepted MCP negative prompt reaches the built-in graph’s negative encoder', () => {
  // MCP submits the field as `negative`, the name the studio API and every graph builder read.
  const graph = familyGraph({ ...profile.defaults, family: 'sdxl', variant: 'base', source: 'checkpoint', bundled: { encoder: true, vae: true }, model: 'sdxl.safetensors', prompt: 'a lighthouse', negative: 'blurry, low detail', seed: 5 });
  const texts = Object.values(graph).filter(node => node.class_type === 'CLIPTextEncode').map(node => node.inputs.text);
  assert.ok(texts.includes('blurry, low detail'), JSON.stringify(texts));
  const sampler = Object.values(graph).find(node => node.class_type === 'KSampler');
  assert.ok(sampler.inputs.cfg > 1, 'the negative takes effect only above cfg 1');
});

test('LoRA discovery indexes compatible optional effects compactly and bounds looked-up details', () => {
  const infos = {
    'styles/ink.safetensors': { families: ['sdxl'], base: 'SDXL', title: 'Ink Wash Painting', triggers: ['inkstyle', 'wash'], description: 'x'.repeat(1000), sourceUrl: 'https://example.test/style' },
    'lora_1234_v2.safetensors': { families: ['sdxl'], title: 'Brutalist Concrete Architecture Photography LoRA by someone', triggers: ['lora'], strengthRange: { min: 0, max: 1.5, step: 0.1, default: 1.1 } },
    'PixelArtRedmond.safetensors': { families: ['sdxl'], title: 'Pixel Art Redmond', triggers: ['pixel art'] },
    'speed.safetensors': { families: ['sdxl'], role: 'acceleration' },
    'flux.safetensors': { families: ['flux'] }
  };
  const subject = { ...profile, options: { loras: Object.keys(infos) } };
  const { loras, total } = mcpLoras(subject, infos);
  assert.equal(total, 3);
  // A descriptive name needs no hint; a cryptic one gets the title's other words, at most 40 characters.
  // A trigger the name already spells out is left out too.
  assert.deepEqual(loras, ['lora_1234_v2 — Brutalist Concrete Architecture Photogr…', 'PixelArtRedmond', 'ink — Wash Painting [inkstyle]']);
  const detailed = mcpLoras(subject, infos, { query: 'ink' });
  assert.equal(detailed.loras[0].description.length, 280);
  assert.deepEqual(detailed.loras[0].strength, { recommended: 0.7 });
  assert.deepEqual(mcpLoras(subject, infos, { names: ['LORA_1234_V2'] }).loras[0].strength, { recommended: 1.1, min: 0, max: 1.5 });
  assert.deepEqual(mcpLoras({ ...profile, capabilities: { lora: false } }, infos), { loras: [], total: 0 });
  // Lookups return at most five full entries; further matches stay in the compact form.
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`glow-${index}.safetensors`, { families: ['sdxl'], title: `Glow ${index}` }]));
  const capped = mcpLoras({ ...profile, options: { loras: Object.keys(many) } }, many, { query: 'glow' });
  assert.equal(capped.loras.length, 5);
  assert.deepEqual(capped.more, ['glow-5', 'glow-6', 'glow-7']);
});

test('Generate LoRA names resolve without folder, extension or case and take the recommended strength', () => {
  const infos = { 'styles/Ink-Wash.safetensors': { families: ['sdxl'], strengthRange: { min: 0, max: 1.5, step: 0.1, default: 1.1 } } };
  const subject = { ...profile, options: { loras: Object.keys(infos) } };
  for (const name of ['styles/Ink-Wash.safetensors', 'ink-wash', 'Ink Wash', 'styles/ink_wash']) assert.equal(resolveLoraName(subject, name), 'styles/Ink-Wash.safetensors', name);
  assert.deepEqual(prepareLoras(subject, infos, [{ name: 'ink wash' }, { name: 'Ink-Wash', strength: 0.5 }]), [{ name: 'styles/Ink-Wash.safetensors', strength: 1.1 }]);
  assert.throws(() => prepareLoras(subject, infos, [{ name: 'oil paint' }]), /^Error: No LoRA named oil paint for SDXL\. Call Models with lora_query to look one up\.$/);
});

test('Result waits are capped below LibreChat’s 1800-second background deadline', async (t) => {
  assert.equal(maxResultWaitSeconds, 1500);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-mcp-wait-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const media = new McpMedia({ dataDir, baseUrl: 'http://127.0.0.1:1', publicUrl: 'https://studio.example.test' });
  let waited;
  media.job = async (_owner, _id, seconds) => { waited = seconds; return { status: 'running' }; };
  media.state.jobs['job-1'] = 'owner';
  await media.result('owner', 'job-1', 0, 1800, 'notification');
  assert.equal(waited, 1500);
});
