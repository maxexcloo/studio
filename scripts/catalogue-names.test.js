import assert from 'node:assert/strict';
import test from 'node:test';
import { compareModelNames, loraCompatibility, loraName, modelFamily, modelFamilyLabel, modelGroups, modelLoras, modelName, profileMatchesFilters, workflowSpeed } from '../src/app/catalogueNames.js';

test('imported workflows share stock family headings, including aliases and cloud models', () => {
  const profiles = [
    { id: 'image:flux', family: 'flux2_klein_9b', familyName: 'Flux.2 Klein 9B', label: 'Stock Flux' },
    { id: 'custom:flux', family: 'flux2_klein_9b', label: 'Custom Flux' },
    { id: 'video:h3', family: 'minimax_h3', familyName: 'MiniMax', label: 'Stock Video' },
    { id: 'custom:h3', family: 'minimax-h3', label: 'Custom Video' },
    { id: 'custom:grok', family: 'grok', label: 'Grok Imagine Image 2.0' },
    { id: 'custom:unknown', family: 'custom', label: 'Unclassified Workflow' },
  ];
  const groups = modelGroups(profiles);
  assert.deepEqual(groups.map((group) => group.label), ['FLUX', 'Grok', 'MiniMax', 'Other Workflows']);
  assert.deepEqual(groups.find((group) => group.label === 'FLUX').rows.map((profile) => profile.id), ['custom:flux', 'image:flux']);
  assert.deepEqual(groups.find((group) => group.label === 'MiniMax').rows.map((profile) => profile.id), ['custom:h3', 'video:h3']);
  assert.equal(groups.flatMap((group) => group.rows).length, profiles.length);
  assert.deepEqual(profiles.map((profile) => profile.id), ['image:flux', 'custom:flux', 'video:h3', 'custom:h3', 'custom:grok', 'custom:unknown']);
});

test('Singularity has a fine tune heading without changing the H3 generation family', () => {
  const stock = { id: 'custom:h3', family: 'minimax-h3', label: 'MiniMax H3 · Generate' };
  const imported = { id: 'custom:singularity', family: 'minimax-h3', label: 'Singularity · Reference · 20 Steps' };
  const checkpoint = { id: 'video:singularity', family: 'minimax_h3', label: 'Reference', baseModel: 'Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors' };
  const groups = modelGroups([stock, imported, checkpoint]);
  assert.deepEqual(groups.map((group) => group.label), ['MiniMax', 'MiniMax (Fine Tunes)']);
  assert.deepEqual(groups[0].rows.map((profile) => profile.id), ['custom:h3']);
  assert.equal(groups[1].rows.length, 2);
  assert.equal(imported.family, 'minimax-h3');
  assert.equal(checkpoint.family, 'minimax_h3');
  assert.equal(loraCompatibility({ families: ['minimax_h3'] }, imported), 'fits');
});

test('model names keep model identity separate from precision and workflow settings', () => {
  assert.deepEqual(modelName({ kind: 'video', label: 'MiniMax H3 [INT8 ConvRot] · Reference · Sol & PDD · 8 Steps · 4B Encoder (≈72 s)' }), { name: 'MiniMax H3 · Animate Image', detail: 'INT8 · Sol & PDD · 8 Steps · 4B Encoder · ~72 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'FLUX.2 [klein] 9B [FP8] · Distilled' }), { name: 'FLUX.2 [klein] 9B', detail: 'FP8' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Qwen-Image 2.1 [INT8 ConvRot] · Standard · 25 Steps (≈15 s)' }), { name: 'Qwen-Image 2.1', detail: 'INT8 · 25 Steps · ~15 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Qwen-Image 2.1 Turbo [BF16] · 8 Steps (≈7 s)' }), { name: 'Qwen-Image 2.1 Turbo', detail: 'BF16 · 8 Steps · ~7 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'FLUX.2 [klein] 9B KV [FP8] · Reference · 4 Steps (≈4 s)' }), { name: 'FLUX.2 [klein] 9B · Edit', detail: 'FP8 · KV Cache · 4 Steps · ~4 s' });
  assert.deepEqual(modelName({ kind: 'video', label: 'Grok Imagine Video 1.5 Preview · Animate Image · Cloud · 720p · 6 Seconds' }), { name: 'Grok Imagine Video 1.5 Preview · Animate Image', detail: 'Cloud · 720p · 6 Seconds' });
  assert.deepEqual(modelName({ kind: 'image', label: 'Grok Imagine Image 2.0 · Edit · Cloud' }), { name: 'Grok Imagine Image 2.0 · Edit', detail: 'Cloud' });
  assert.deepEqual(modelName({ kind: 'image', family: 'grok', defaults: { steps: 20 }, label: 'Grok Image Edit' }), { name: 'Grok Image · Edit', detail: 'grok' });
  assert.deepEqual(modelName({ kind: 'video', family: 'grok', label: 'Grok Image To Video' }), { name: 'Grok Video · Animate Image', detail: 'grok' });
  assert.deepEqual(modelName({ kind: 'image', defaults: { steps: 28 }, label: 'Krea 2 Center SemiRaw v1 [FP8]' }), { name: 'Krea 2 Center SemiRaw v1', detail: 'FP8 · 28 Steps' });
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
  assert.equal(workflowSpeed({ name: 'Grok', family: 'grok', defaults: { steps: 4 } }), 'standard');
  assert.equal(workflowSpeed({ name: 'MiniMax H3 · Non-Reference · PDD · 8 Steps', defaults: { steps: 20 } }, { variant: 'standard' }), 'flash');
});

test('model filters combine favourites and sampling speed', () => {
  const filters = { favourites: true, speed: 'flash' };
  const profile = { id: 'quick-edit', label: 'Quick Edit', defaults: { steps: 4 } };
  assert.equal(profileMatchesFilters(profile, filters, ['quick-edit']), true);
  assert.equal(profileMatchesFilters(profile, filters, []), false);
  assert.equal(profileMatchesFilters(profile, { ...filters, speed: 'standard' }, ['quick-edit']), false);
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


test('combined image and video profiles omit redundant generation actions', () => {
  for (const kind of ['image', 'video']) {
    const profile = { kind, label: 'Combined Model · Generate · 8 Steps', imageModes: { generate: {}, reference: {} } };
    assert.deepEqual(modelName(profile), { name: 'Combined Model', detail: '8 Steps' });
    assert.equal(modelName({ ...profile, imageModes: undefined }).name, 'Combined Model · Generate');
  }
});


test('fine tunes share parent headings without changing workflow identities', () => {
  const profiles = [
    { id: 'tessera', family: 'krea2', label: 'Tessera Turbo' },
    { id: 'noct', family: 'qwen_image_21', label: 'Vesper Q V4' },
    { id: 'noct-lite', family: 'qwen_image_21', label: 'Vesper-Q Lite' },
    { id: 'stock', family: 'qwen_image_21', label: 'Qwen Turbo' },
  ];
  assert.deepEqual(modelGroups(profiles).map(({label}) => label), ['Krea (Fine Tunes)', 'Qwen', 'Qwen (Fine Tunes)']);
  assert.deepEqual(profiles.map(({id}) => id), ['tessera', 'noct', 'noct-lite', 'stock']);
});


test('imported Boogu and MOSS profiles use readable model groups and specific adapter family labels', () => {
  const profiles = [{ id: 'boogu', family: 'boogu', label: 'Boogu Edit' }, { id: 'moss', family: 'moss_image', label: 'MOSS Image SFT' }];
  assert.deepEqual(modelGroups(profiles).map((group) => group.label), ['Boogu', 'MOSS']);
  assert.equal(modelFamilyLabel(profiles[0]), 'Boogu');
  assert.equal(modelFamilyLabel(profiles[1]), 'MOSS Image');
  assert.equal(modelFamilyLabel({ family: 'flux3_klein' }), 'FLUX.3 Klein');
});

test('actual model weights distinguish fine-tunes from accelerator recipe names', () => {
  assert.equal(modelFamily({ family: 'minimax_h3', baseModel: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', label: 'MiniMax H3 · DMAD · 4 Steps' }), 'MiniMax');
  assert.equal(modelFamily({ family: 'minimax_h3', baseModel: 'Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors', label: 'Reference' }), 'MiniMax (Fine Tunes)');
  for (const baseModel of ['lumenTESSERAKrea2Fp8Bf16_krea2Fp8.safetensors', 'serendipityV5INT8C_rays.safetensors', 'tesserafineTurboBF16FP8_v10_3291478.safetensors']) {
    const profile = { family: 'krea2', baseModel, label: 'Quality · 8 Steps' };
    assert.equal(modelFamily(profile), 'Krea (Fine Tunes)');
    assert.equal(loraCompatibility({ families: ['krea2'] }, profile), 'fits');
    assert.equal(loraCompatibility({ families: ['flux3_klein'] }, profile), 'other');
  }
});
