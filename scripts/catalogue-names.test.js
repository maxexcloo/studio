import assert from 'node:assert/strict';
import test from 'node:test';
import { compareModelNames, loraCompatibility, loraName, modelGroups, modelLoras, modelName, profileMatchesFilters, workflowPurpose, workflowSpeed } from '../src/app/catalogueNames.js';

test('imported workflows share stock family headings, including aliases and cloud models', () => {
  const profiles = [
    { id: 'image:flux', family: 'flux2_klein_9b', familyName: 'Flux.2 Klein 9B', label: 'Stock Flux' },
    { id: 'custom:flux', family: 'flux2_klein_9b', label: 'Custom Flux' },
    { id: 'video:h3', family: 'minimax_h3', familyName: 'MiniMax H3', label: 'Stock Video' },
    { id: 'custom:h3', family: 'minimax-h3', label: 'Custom Video' },
    { id: 'custom:grok', family: 'grok', label: 'Grok Imagine Image 2.0' },
    { id: 'custom:unknown', family: 'custom', label: 'Unclassified Workflow' },
  ];
  const groups = modelGroups(profiles);
  assert.deepEqual(groups.map((group) => group.label), ['FLUX.2 Klein 9B', 'Grok Imagine', 'MiniMax H3', 'Other Workflows']);
  assert.deepEqual(groups.find((group) => group.label === 'FLUX.2 Klein 9B').rows.map((profile) => profile.id), ['custom:flux', 'image:flux']);
  assert.deepEqual(groups.find((group) => group.label === 'MiniMax H3').rows.map((profile) => profile.id), ['custom:h3', 'video:h3']);
  assert.equal(groups.flatMap((group) => group.rows).length, profiles.length);
  assert.deepEqual(profiles.map((profile) => profile.id), ['image:flux', 'custom:flux', 'video:h3', 'custom:h3', 'custom:grok', 'custom:unknown']);
});

test('model names keep model identity separate from precision and workflow settings', () => {
  assert.deepEqual(modelName({ kind: 'video', label: 'MiniMax H3 [INT8 ConvRot] · Reference · Sol & PDD · 8 Steps · 4B Encoder (≈72 s)' }), { name: 'MiniMax H3 · Animate Image', detail: 'INT8 · Sol & PDD · 8 Steps · 4B Encoder · ~72 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'FLUX.2 [klein] 9B [FP8] · Distilled' }), { name: 'FLUX.2 Klein 9B · Generate', detail: 'FP8' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Qwen-Image 2.1 [INT8 ConvRot] · Standard · 25 Steps (≈15 s)' }), { name: 'Qwen Image 2.1 · Generate', detail: 'INT8 · 25 Steps · ~15 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Qwen-Image 2.1 Turbo [BF16] · 8 Steps (≈7 s)' }), { name: 'Qwen Image 2.1 Turbo · Generate', detail: 'BF16 · 8 Steps · ~7 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'FLUX.2 [klein] 9B KV [FP8] · Reference · 4 Steps (≈4 s)' }), { name: 'FLUX.2 Klein 9B · Edit', detail: 'FP8 · KV Cache · 4 Steps · ~4 s' });
  assert.deepEqual(modelName({ kind: 'video', label: 'Grok Imagine Video 1.5 Preview · Animate Image · Cloud · 720p · 6 Seconds' }), { name: 'Grok Imagine Video 1.5 Preview · Animate Image', detail: 'Cloud · 720p · 6 Seconds' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Grok Imagine Image 2.0 · Edit · Cloud' }), { name: 'Grok Imagine Image 2.0 · Edit', detail: 'Cloud' });
  assert.deepEqual(modelName({ kind: 'image', family: 'grok', defaults: { steps: 20 }, label: 'Grok Image Edit' }), { name: 'Grok Image · Edit', detail: 'grok' });
  assert.deepEqual(modelName({ kind: 'video', family: 'grok', label: 'Grok Image To Video' }), { name: 'Grok Video · Animate Image', detail: 'grok' });
  assert.deepEqual(modelName({ kind: 'image', defaults: { steps: 28 }, label: 'Krea 2 Center SemiRaw v1 [FP8]' }), { name: 'Krea 2 Center SemiRaw v1 · Generate', detail: 'FP8 · 28 Steps' });
  assert.deepEqual(modelName({ kind: 'video', family: 'minimax_h3', defaults: { steps: 20 }, label: 'Minimax H3 Singularity Ref2va Pruned V1.3 Int8 · MiniMax H3' }), { name: 'MiniMax H3 Singularity v1.3 · Animate Image', detail: 'INT8 · 20 Steps' });
  assert.deepEqual(modelName({ kind: 'video', family: 'minimax-h3', label: 'MiniMax H3 [INT8 ConvRot] · Non-Reference · Stock · 20 Steps · 4B Encoder' }), { name: 'MiniMax H3 · Generate', detail: 'INT8 · 20 Steps · 4B Encoder' });
  assert.deepEqual(modelName({ kind: 'video', family: 'grok', label: 'Grok Imagine Video 1.5 · Generate · 20 Steps · Cloud · 720p' }), { name: 'Grok Imagine Video 1.5 · Generate', detail: 'Cloud · 720p' });
});

test('LoRA names prefer metadata, preserve useful version information and leave identity untouched', () => {
  const filename = 'styles/watercolour_portrait-v2.safetensors';
  assert.equal(loraName(filename), 'watercolour portrait v2');
  assert.equal(loraName(filename, { title: '  Watercolour Portrait  ' }), 'Watercolour Portrait');
  assert.equal(filename, 'styles/watercolour_portrait-v2.safetensors');
});

test('model filter includes unknown files and allows explicitly showing other models', () => {
  const options = ['matching', 'unknown', 'different'];
  const fit = (name) => ({ matching: 'fits', unknown: 'unknown', different: 'other' })[name];
  assert.deepEqual(modelLoras(options, fit), ['matching', 'unknown']);
  assert.deepEqual(modelLoras(options, fit, true), options);
});

test('explicit family metadata supports imported workflows and identifier aliases', () => {
  assert.equal(loraCompatibility({ families: ['minimax_h3'] }, { family: 'minimax-h3', workflow: 'custom:reference' }), 'fits');
  assert.equal(loraCompatibility({ families: ['flux1'] }, { family: 'minimax-h3' }), 'other');
  assert.equal(loraCompatibility({ families: ['flux1'] }, { family: 'custom' }), 'unknown');
  assert.equal(loraCompatibility(undefined, { family: 'flux1' }), 'unknown');
});

test('speed filters use variant metadata and recognise accelerated imported recipes', () => {
  assert.equal(workflowSpeed({ name: 'Krea Turbo', defaults: { steps: 4 } }, { variant: 'raw' }), 'standard');
  for (const name of ['Qwen Turbo', 'Flux Schnell', 'SDXL Lightning', 'H3 Sol & PDD', 'Klein Distilled']) assert.equal(workflowSpeed({ name, defaults: { steps: 10 } }), 'flash');
  assert.equal(workflowSpeed({ name: 'Flux De-distilled', defaults: { steps: 28 } }), 'standard');
  assert.equal(workflowSpeed({ name: 'Custom Recipe', defaults: { steps: 4 } }), 'flash');
  assert.equal(workflowSpeed({ name: 'Grok Imagine', family: 'grok', defaults: { steps: 4 } }), 'standard');
});

test('purpose filters distinguish required references and keep optional references in both groups', () => {
  assert.deepEqual(workflowPurpose({}), { generate: true, edit: false });
  assert.deepEqual(workflowPurpose({ mediaInputs: [{ kind: 'image', required: true }] }), { generate: false, edit: true });
  assert.deepEqual(workflowPurpose({ mediaInputs: [{ kind: 'image', min: 1 }] }), { generate: false, edit: true });
  assert.deepEqual(workflowPurpose({ capabilities: { startImage: true } }), { generate: true, edit: true });
  assert.deepEqual(workflowPurpose({ mediaInputs: [{ kind: 'audio', required: true }] }), { generate: true, edit: false });
  const filters = { favourites: true, speed: 'flash', purpose: 'edit' };
  const profile = { id: 'quick-edit', label: 'Quick Edit', defaults: { steps: 4 }, capabilities: { startImageRequired: true, startImage: true } };
  assert.equal(profileMatchesFilters(profile, filters, ['quick-edit']), true);
  assert.equal(profileMatchesFilters(profile, filters, []), false);
  assert.equal(profileMatchesFilters(profile, { ...filters, purpose: 'generate' }, ['quick-edit']), false);
});

test('model lists sort visible names naturally before precision and recipe details', () => {
  const profiles = [
    { id: 'z', label: 'Z-Image Turbo' },
    { id: 'q10', label: 'Qwen Image 10' },
    { id: 'f8', label: 'FLUX.2 [klein] 9B [BF16] · Edit · 8 Steps' },
    { id: 'f4', label: 'FLUX.2 [klein] 9B [BF16] · Edit · 4 Steps' },
    { id: 'q2', label: 'qwen Image 2' },
    { id: 'a', name: 'Anima' },
  ];
  assert.deepEqual([...profiles].sort(compareModelNames).map((profile) => profile.id), ['a', 'f4', 'f8', 'q2', 'q10', 'z']);
  assert.equal(profiles[0].id, 'z');
});
