import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { seedMissing } from './profile-seed.js';
import { createGuideStore, createProfileStore, guideSeedFile } from './profile-store.js';

const quiet = { info: () => {}, warn: () => {} };
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const profile = (id, name) => `${JSON.stringify({ heissUi: { id, name, kind: 'image', controls: { prompt: { node: '1', input: 'text' } } }, graph: { 1: { class_type: 'CLIPTextEncode', inputs: { text: '' } } } }, null, 2)}\n`;

function seedTree(root) {
  const workflows = path.join(root, 'config', 'studio', 'workflows');
  fs.mkdirSync(workflows, { recursive: true });
  fs.writeFileSync(path.join(workflows, 'fresh.json'), profile('fresh', 'Fresh From Seed'));
  fs.writeFileSync(path.join(workflows, 'edited.json'), profile('edited', 'Seed Version'));
  fs.writeFileSync(path.join(workflows, 'removed.json'), profile('removed', 'Removed In Studio'));
  fs.writeFileSync(path.join(workflows, 'broken.json'), '{ nope');
  fs.writeFileSync(path.join(root, 'config', 'prompting.json'), JSON.stringify({ families: {}, packs: { seed: { summary: 'Seed.' } }, profiles: {}, variants: {} }));
  fs.writeFileSync(path.join(root, 'config', 'lora-catalogue.json'), '{}');
  return workflows;
}

test('the seed fills a new install and missing files only, and never overwrites or revives a Studio profile', (t) => {
  const dir = scratch(t);
  const seed = path.join(dir, 'seed');
  const data = path.join(dir, 'data');
  const workflowsDir = path.join(data, 'workflows');
  seedTree(seed);
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(path.join(data, 'config'), { recursive: true });
  // Studio's own copy of "edited", and an existing catalogue the seed must not replace.
  fs.writeFileSync(path.join(workflowsDir, 'edited.json'), profile('edited', 'Studio Version'));
  fs.writeFileSync(path.join(data, 'config', 'lora-catalogue.json'), '{"studio.safetensors":{}}');
  const store = createProfileStore({ dataDir: data, workflowsDir, log: quiet });
  // "removed" was held once (it has history) and deleted in Studio.
  store.record('removed', profile('removed', 'Old'), { origin: 'seed', by: 'seed' });
  const seedBefore = fs.readFileSync(path.join(seed, 'config', 'studio', 'workflows', 'edited.json'), 'utf8');

  const result = seedMissing({ seedDir: seed, dataDir: data, workflowsDir, store, log: quiet });
  assert.deepEqual(result, { profiles: ['fresh'], config: ['prompting.json'], kept: 1, skipped: ['removed'] });
  assert.match(fs.readFileSync(path.join(workflowsDir, 'fresh.json'), 'utf8'), /Fresh From Seed/);
  assert.match(fs.readFileSync(path.join(workflowsDir, 'edited.json'), 'utf8'), /Studio Version/, 'Studio’s copy stays');
  assert.equal(fs.existsSync(path.join(workflowsDir, 'removed.json')), false, 'a profile removed in Studio stays removed');
  assert.equal(fs.existsSync(path.join(workflowsDir, 'broken.json')), false);
  assert.equal(fs.readFileSync(path.join(data, 'config', 'lora-catalogue.json'), 'utf8'), '{"studio.safetensors":{}}');
  assert.deepEqual(store.versions('fresh').map((item) => [item.version, item.origin, item.by]), [[1, 'seed', 'seed']]);
  assert.equal(fs.readFileSync(path.join(seed, 'config', 'studio', 'workflows', 'edited.json'), 'utf8'), seedBefore, 'the seed is only read');

  // A seed change later never reaches a profile Studio holds; a second run changes nothing.
  fs.writeFileSync(path.join(seed, 'config', 'studio', 'workflows', 'fresh.json'), profile('fresh', 'Seed Update'));
  assert.deepEqual(seedMissing({ seedDir: seed, dataDir: data, workflowsDir, store, log: quiet }), { profiles: [], config: [], kept: 2, skipped: ['removed'] });
  assert.match(fs.readFileSync(path.join(workflowsDir, 'fresh.json'), 'utf8'), /Fresh From Seed/);
});

test('without a seed directory nothing is copied; a missing one is a warning', (t) => {
  const dir = scratch(t);
  const store = createProfileStore({ dataDir: dir, log: quiet });
  assert.deepEqual(seedMissing({ seedDir: '', dataDir: dir, store, log: quiet }), { profiles: [], config: [], kept: 0, skipped: [] });
  const warnings = [];
  seedMissing({ seedDir: path.join(dir, 'absent'), dataDir: dir, store, log: { warn: (message) => warnings.push(message) } });
  assert.match(warnings[0], /doesn’t exist/);
});

test('the guides’ seed is MCP_PROMPTING_PATH, else the seeded config/prompting.json', (t) => {
  const dir = scratch(t);
  assert.equal(guideSeedFile({ MCP_PROMPTING_PATH: '/x/prompting.json', STUDIO_SEED_DIR: '/seed' }, dir), '/x/prompting.json');
  assert.equal(guideSeedFile({ STUDIO_SEED_DIR: '/seed' }, dir), path.join(dir, 'config', 'prompting.json'));
  assert.equal(guideSeedFile({}, dir), '');
  // A new install: the seeded file becomes the guide store's version 1.
  const seed = path.join(dir, 'seed');
  seedTree(seed);
  seedMissing({ seedDir: seed, dataDir: dir, store: createProfileStore({ dataDir: dir, log: quiet }), log: quiet });
  const guides = createGuideStore({ dataDir: dir, seedFile: guideSeedFile({ STUDIO_SEED_DIR: seed }, dir), log: quiet });
  assert.deepEqual(guides.migrate(), { packs: 1, versions: 1 });
  assert.equal(guides.pack('seed').meta.origin, 'seed');
});
