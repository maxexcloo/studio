import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeImport, missingPromptFields, presetGrade, promptFields } from './library-grade.js';

const complete = { prompt: 'a fox', negative: 'blur', negativeUsed: true, seed: '0', sampler: 'euler', steps: 20, cfg: 0, width: 1024, height: 1024 };
const checkpoint = { name: 'Base', role: 'checkpoint', status: 'installed' };
const base = { required: true, installed: true, profile: true };

test('the grade table: each rule lands on its grade with its reason', () => {
  const rows = [
    ['everything verified, prompt complete', { resources: [checkpoint], recipe: complete, baseModel: base }, 'exact', /installed and verified/],
    ['a model file verified', { resources: [{ name: 'Style', status: 'installed' }] }, 'exact', /verified by checksum/],
    ['matched by name and size', { resources: [{ name: 'Style', status: 'installed', unverified: true }] }, 'close', /Style matched by name and size/],
    ['matched by filename only', { resources: [{ ...checkpoint, nameOnly: true }], recipe: complete, baseModel: base }, 'close', /filename only/],
    ['a same-family substitute', { resources: [{ name: 'Base', status: 'substitute', substitute: { reason: 'FP8 instead of BF16' } }], recipe: complete, baseModel: base }, 'close', /substitute: FP8 instead of BF16/],
    ['an approximate sampler', { resources: [checkpoint], recipe: complete, baseModel: base, approximate: ['Schedule “Odd” needs a manual choice'] }, 'close', /manual choice/],
    ['extra processing', { resources: [checkpoint], recipe: complete, baseModel: base, extraProcessing: true }, 'close', /Extra processing/],
    ['a missing file', { resources: [{ name: 'Style', status: 'missing' }] }, 'partial', /Style isn’t installed/],
    ['a downloading file', { resources: [{ name: 'Style', status: 'downloading' }] }, 'partial', /downloading/],
    ['a paid file', { resources: [{ name: 'Style', status: 'unavailable', unavailable: { reason: 'paid' } }] }, 'partial', /paid on Civitai/],
    ['an early-access file', { resources: [{ name: 'Style', status: 'unavailable', unavailable: { reason: 'early-access' } }] }, 'partial', /early access/],
    ['a filename conflict', { resources: [{ name: 'Style', status: 'conflict' }] }, 'partial', /already uses the name/],
    ['an unsupported file', { resources: [{ name: 'Style', status: 'unsupported' }] }, 'partial', /isn’t supported/],
    ['no base model recorded', { resources: [], recipe: complete, baseModel: { required: false } }, 'partial', /No base model recorded/],
    ['the base model missing', { resources: [{ ...checkpoint, status: 'missing' }], recipe: complete, baseModel: { required: true, installed: false } }, 'partial', /base model isn’t installed/],
    ['no profile for the base model', { resources: [checkpoint], recipe: complete, baseModel: { required: true, installed: true, profile: false } }, 'partial', /No profile runs/],
    ['described by AI', { resources: [checkpoint], recipe: complete, baseModel: base, described: true }, 'partial', /Described by AI/],
    ['a repository with nothing picked', { resources: [{ name: 'a', status: 'missing', optional: true }] }, 'partial', /No file chosen/],
    ['a repository with one file installed', { resources: [{ name: 'a', status: 'installed', optional: true }, { name: 'b', status: 'missing', optional: true }] }, 'exact', /verified/]
  ];
  for (const [name, input, value, reason] of rows) {
    const grade = gradeImport(input);
    assert.equal(grade.value, value, name);
    assert.ok(grade.reasons.some((text) => reason.test(text)), `${name}: ${grade.reasons.join('; ')}`);
  }
});

test('every missing prompt field caps the grade at Partial and is named', () => {
  for (const [field, words] of promptFields) {
    const recipe = { ...complete, [field]: field === 'negative' ? '' : undefined };
    const grade = gradeImport({ resources: [checkpoint], recipe, baseModel: base });
    assert.equal(grade.value, 'partial', field);
    assert.deepEqual(grade.missingFields, [field]);
    assert.ok(grade.reasons.includes(words), field);
  }
  // A substitute and a missing seed: still Partial, and both reasons stay.
  const both = gradeImport({ resources: [{ ...checkpoint, unverified: true }], recipe: { ...complete, seed: '' }, baseModel: base });
  assert.equal(both.value, 'partial');
  assert.ok(both.reasons.includes('No seed recorded') && both.reasons.some((text) => /not yet verified/.test(text)));
});

test('CFG and the negative are only required where they apply', () => {
  assert.deepEqual(missingPromptFields({ ...complete, cfg: undefined, cfgUsed: false }), []);
  assert.deepEqual(missingPromptFields({ ...complete, negative: '', negativeUsed: false }), []);
  assert.deepEqual(missingPromptFields({ ...complete, cfg: 0 }), [], 'zero is a recorded value');
  assert.deepEqual(missingPromptFields({}), ['prompt', 'seed', 'sampler', 'steps', 'cfg', 'width', 'height']);
});

test('saved images grade from their matched preset', () => {
  const preset = {
    prompt: 'a fox', negative: 'blur', sourceMetadata: { negativePrompt: 'blur' }, warnings: [],
    settings: { seed: '1', sampler: 'euler', steps: 20, cfg: 4, width: 832, height: 1216, scheduler: 'karras' },
    resources: [{ name: 'Base', folder: 'checkpoints', status: 'installed', profileId: 'p' }, { name: 'Style', folder: 'loras', status: 'installed' }]
  };
  assert.equal(presetGrade(preset).value, 'exact');
  assert.equal(presetGrade({ ...preset, warnings: ['No sampling schedule was recorded; the selected workflow’s default will be used.'] }).value, 'close');
  assert.equal(presetGrade({ ...preset, warnings: ['Additional processing was recorded. Its workflow is not included in this preset.'] }).value, 'close');
  const missing = presetGrade({ ...preset, resources: [preset.resources[0], { name: 'Style', folder: 'loras', status: 'missing' }] });
  assert.equal(missing.value, 'partial');
  assert.ok(missing.reasons.includes('Style isn’t installed'));
  const paid = presetGrade({ ...preset, resources: [preset.resources[0], { name: 'Style', folder: 'loras', status: 'unsupported', unavailable: { reason: 'paid' } }] });
  assert.ok(paid.reasons.includes('Style is paid on Civitai'));
  assert.equal(presetGrade({ ...preset, settings: { ...preset.settings, seed: undefined } }).missingFields[0], 'seed');
  assert.equal(presetGrade({ ...preset, resources: [{ ...preset.resources[0], profileId: '' }] }).value, 'partial');
});
