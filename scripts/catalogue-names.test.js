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
  assert.deepEqual(groups.map((group) => group.label), ['FLUX', 'Grok', 'MiniMax H3', 'Other Workflows']);
  assert.deepEqual(groups.find((group) => group.label === 'FLUX').rows.map((profile) => profile.id), ['custom:flux', 'image:flux']);
  assert.deepEqual(groups.find((group) => group.label === 'MiniMax H3').rows.map((profile) => profile.id), ['custom:h3', 'video:h3']);
  assert.equal(groups.flatMap((group) => group.rows).length, profiles.length);
  assert.deepEqual(profiles.map((profile) => profile.id), ['image:flux', 'custom:flux', 'video:h3', 'custom:h3', 'custom:grok', 'custom:unknown']);
});

test('fine tunes sit in their family: Singularity under MiniMax H3', () => {
  const stock = { id: 'custom:h3', family: 'minimax-h3', label: 'MiniMax H3 · Fast · 8 Steps' };
  const imported = { id: 'custom:singularity', family: 'minimax-h3', label: 'Singularity · Quality · 20 Steps' };
  const groups = modelGroups([stock, imported]);
  assert.deepEqual(groups.map((group) => group.label), ['MiniMax H3']);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(loraCompatibility({ families: ['minimax_h3'] }, imported), 'fits');
});

test('model names show the title as it is, with tier, steps and tags on the second line', () => {
  assert.deepEqual(modelName({ kind: 'image', label: 'Krea 2 Turbo Radiance · Fast · 8 Steps · ~7 s' }), { name: 'Krea 2 Turbo Radiance', detail: 'Fast · 8 Steps · ~7 s' });
  assert.deepEqual(modelName({ kind: 'image', label: 'FLUX.3 [klein] Distilled · Fast · 4 Steps' }), { name: 'FLUX.3 [klein] Distilled', detail: 'Fast · 4 Steps' });
  assert.deepEqual(modelName({ kind: 'video', label: 'MiniMax H3 Singularity · Quality · 20 Steps · Reference' }), { name: 'MiniMax H3 Singularity', detail: 'Quality · 20 Steps · Reference' });
  assert.deepEqual(modelName({ kind: 'image', family: 'grok', label: 'Grok Imagine Image 2.0 · Cloud' }), { name: 'Grok Imagine Image 2.0', detail: 'Cloud' });
  assert.deepEqual(modelName({ kind: 'image', defaults: { steps: 28 }, label: 'Krea 2 Center SemiRaw v1' }), { name: 'Krea 2 Center SemiRaw v1', detail: '28 Steps' });
  assert.deepEqual(modelName({ kind: 'image', family: 'moss_image', label: 'MOSS Image Base' }), { name: 'MOSS Image Base', detail: 'moss_image' });
  assert.deepEqual(modelName({ kind: 'video', label: 'Wan 2.1 (≈72 s)' }).name, 'Wan 2.1 (≈72 s)');
});

test('LoRA names prefer metadata, preserve useful version information and leave identity untouched', () => {
  const filename = 'styles/watercolour_portrait-v2.safetensors';
  assert.equal(loraName(filename), 'Watercolour Portrait V2');
  // Unknown files read as a cleaned, Title Case stem; capitals and digits stay as they are.
  assert.equal(loraName('loras/pawg_krea2.safetensors'), 'Pawg Krea2');
  assert.equal(loraName('FLUX-detail_LoRA.pt'), 'FLUX Detail LoRA');
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


test('fine tunes share their family heading without changing workflow identities', () => {
  const profiles = [
    { id: 'tessera', family: 'krea2', label: 'Tessera Turbo' },
    { id: 'noct', family: 'qwen_image_21', label: 'Vesper Q V4' },
    { id: 'stock', family: 'qwen_image_21', label: 'Qwen Turbo' },
  ];
  assert.deepEqual(modelGroups(profiles).map(({label}) => label), ['Krea 2', 'Qwen-Image 2.1']);
  assert.deepEqual(profiles.map(({id}) => id), ['tessera', 'noct', 'stock']);
});


test('imported Boogu and MOSS profiles use readable model groups and specific adapter family labels', () => {
  const profiles = [{ id: 'boogu', family: 'boogu', label: 'Boogu Edit' }, { id: 'moss', family: 'moss_image', label: 'MOSS Image SFT' }];
  assert.deepEqual(modelGroups(profiles).map((group) => group.label), ['Boogu', 'MOSS Image']);
  assert.equal(modelFamilyLabel(profiles[0]), 'Boogu');
  assert.equal(modelFamilyLabel(profiles[1]), 'MOSS Image');
  assert.equal(modelFamilyLabel({ family: 'flux3_klein' }), 'FLUX.3 Klein');
});

test('every Krea 2 fine tune sits under Krea 2 and keeps its LoRA fit', () => {
  for (const baseModel of ['lumenTESSERAKrea2Fp8Bf16_krea2Fp8.safetensors', 'serendipityV5INT8C_rays.safetensors', 'tesserafineTurboBF16FP8_v10_3291478.safetensors']) {
    const profile = { family: 'krea2', baseModel, label: 'Quality · 8 Steps' };
    assert.equal(modelFamily(profile), 'Krea 2');
    assert.equal(loraCompatibility({ families: ['krea2'] }, profile), 'fits');
    assert.equal(loraCompatibility({ families: ['flux3_klein'] }, profile), 'other');
  }
});
