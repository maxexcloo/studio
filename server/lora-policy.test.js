import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibilityNote, loraCompatibility, strengthRange } from './lora-policy.js';
import { enrichLocalLoraInfo, optionalLoraPolicyIssue } from './lora-catalogue.js';

const profile = { id: 'custom:fl', family: 'minimax_h3', baseModel: 'models/h3.safetensors', recipe: { conditioning: 'FL2VA' } };
const effect = { families: ['minimax_h3'], compatibility: { conditionings: ['FL2VA'], unlisted: 'other' } };

test('explicit conditioning support separates FL and Ref without changing family-only compatibility', () => {
  assert.equal(loraCompatibility(effect, profile), 'fits');
  assert.equal(loraCompatibility(effect, { ...profile, recipe: { conditioning: 'Ref2VA' } }), 'other');
  assert.equal(loraCompatibility(effect, { ...profile, recipe: undefined }), 'unknown');
  assert.equal(loraCompatibility({ families: effect.families }, { ...profile, recipe: { conditioning: 'Ref2VA' } }), 'fits');
  assert.match(optionalLoraPolicyIssue({ name: 'effect', strength: 1 }, effect, { ...profile, recipe: { conditioning: 'Ref2VA' } }), /conditioning variant/);
});

test('Boogu verified base and turbo targets leave unverified edit variants available with a warning', () => {
  const info = { families: ['boogu'], compatibility: { baseModels: ['boogu_base.safetensors', 'boogu_turbo.safetensors'] } };
  const base = { family: 'boogu', defaults: { model: 'models/boogu_base.safetensors' } };
  assert.equal(loraCompatibility(info, base), 'fits');
  const edit = { ...base, defaults: { model: 'boogu_edit.safetensors' } };
  assert.equal(loraCompatibility(info, edit), 'unknown');
  assert.match(compatibilityNote(info, edit), /not been verified/);
  assert.equal(optionalLoraPolicyIssue({ name: 'effect', strength: 1 }, info, edit), '');
  assert.equal(loraCompatibility(undefined, edit), 'unknown');
});

test('exact profile and model allowlists are combined, with missing context marked unknown', () => {
  const info = { families: effect.families, compatibility: { baseModels: ['h3.safetensors'], profileIds: ['custom:fl'], unlisted: 'other' } };
  assert.equal(loraCompatibility(info, profile), 'fits');
  assert.equal(loraCompatibility(info, { ...profile, id: 'custom:other' }), 'other');
  assert.equal(loraCompatibility(info, { family: 'minimax_h3' }), 'unknown');
  assert.equal(loraCompatibility(info, { family: 'minimax_h3', id: 'custom:fl', model: 'custom:fl' }), 'unknown');
});

test('only valid explicit publisher strength bounds replace fallback controls', () => {
  const info = { strengthRange: { min: -3, max: 10, step: 0.05 } };
  assert.deepEqual(strengthRange(info), info.strengthRange);
  assert.equal(strengthRange({ strengthRange: { min: -3, max: 10, step: 0 } }), null);
  assert.equal(strengthRange({}), null);
  assert.equal(optionalLoraPolicyIssue({ name: 'slider', strength: 10 }, info, profile), '');
  assert.match(optionalLoraPolicyIssue({ name: 'slider', strength: 11 }, info, profile), /-3 to 10/);
  assert.equal(optionalLoraPolicyIssue({ name: 'unknown', strength: 10 }, {}, profile), '');
});

test('local and provider policy enrichment retains explicit constraints without fabricating family evidence', () => {
  const entry = { compatibility: { conditionings: ['FL2VA'], unlisted: 'other' }, strengthRange: { min: -10, max: 10, step: 0.1 } };
  const enriched = enrichLocalLoraInfo({ families: ['minimax_h3'] }, 'effect', { effect: entry }, () => [], { minimax_h3: { label: 'MiniMax H3' } });
  assert.deepEqual(enriched.compatibility, entry.compatibility);
  assert.deepEqual(enriched.strengthRange, entry.strengthRange);
  assert.deepEqual(enriched.families, ['minimax_h3']);
});


test('packaged server catalogue imports and applies policy without a source tree', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-packaged-lora-policy-'));
  try {
    fs.mkdirSync(path.join(scratch, 'server'));
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const name of ['lora-policy.js', 'lora-catalogue.js']) {
      fs.copyFileSync(fileURLToPath(new URL(name, import.meta.url)), path.join(scratch, 'server', name));
    }
    assert.equal(fs.existsSync(path.join(scratch, 'src')), false);
    const packaged = await import(pathToFileURL(path.join(scratch, 'server', 'lora-catalogue.js')).href);
    assert.match(packaged.optionalLoraPolicyIssue({ name: 'effect', strength: 1 }, effect, { ...profile, recipe: { conditioning: 'Ref2VA' } }), /conditioning variant/);
    assert.equal(packaged.optionalLoraPolicyIssue({ name: 'effect', strength: 1 }, effect, profile), '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
