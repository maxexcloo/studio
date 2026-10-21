import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-profile-store-'));
process.env.STUDIO_DATA_DIR = temporary;
process.env.COMFY_URL = 'http://127.0.0.1:9';
const { createGuideStore, createProfileStore, hashOf, livePrompting } = await import('./profile-store.js');
const editor = await import('./profile-editor.js');
const { loadMcpPrompting } = await import('./mcp-prompting.js');
const { userWorkflowsDir } = await import('./custom-workflows.js');
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const quiet = { info: () => {}, warn: () => {} };

const profile = (name, extra = {}) => JSON.stringify({
  heissUi: { id: 'image-test', name, kind: 'image', controls: { prompt: { node: '2', input: 'text' } }, ...extra },
  graph: { 1: { class_type: 'UNETLoader', inputs: { unet_name: 'model.safetensors' } }, 2: { class_type: 'CLIPTextEncode', inputs: { text: '' } } }
}, null, 2);
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('profiles migrate once: backups and the current file become versions, seed first, studio after', (t) => {
  const dir = scratch(t);
  const workflows = path.join(dir, 'workflows');
  fs.mkdirSync(workflows, { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups', 'profile-edits'), { recursive: true });
  fs.writeFileSync(path.join(workflows, 'edited.json'), profile('Third'));
  fs.writeFileSync(path.join(workflows, 'plain.json'), profile('Plain'));
  fs.writeFileSync(path.join(dir, 'backups', 'profile-edits', 'edited-2026-10-01T10-00-00-000Z.json'), profile('First'));
  fs.writeFileSync(path.join(dir, 'backups', 'profile-edits', 'edited-2026-10-02T10-00-00-000Z.json'), profile('Second'));
  fs.writeFileSync(path.join(workflows, '.studio-edits.json'), JSON.stringify({ edited: { editedAt: '2026-10-03T10:00:00.000Z', by: 'admin-1', baseHash: hashOf(profile('First')) } }));
  const before = fs.readFileSync(path.join(workflows, '.studio-edits.json'), 'utf8');
  const store = createProfileStore({ dataDir: dir, workflowsDir: workflows, log: quiet });
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 4 });
  assert.deepEqual(store.versions('edited').map((item) => [item.version, item.origin, item.by, item.at]), [[3, 'studio', 'admin-1', '2026-10-03T10:00:00.000Z'], [2, 'studio', 'studio', '2026-10-02T10:00:00.000Z'], [1, 'seed', 'seed', '2026-10-01T10:00:00.000Z']]);
  assert.match(store.version('edited', 1).text, /"First"/);
  assert.deepEqual([store.meta('edited').version, store.meta('edited').origin, store.meta('edited').seedHash], [3, 'studio', hashOf(profile('First'))]);
  assert.deepEqual(store.versions('plain').map((item) => item.origin), ['seed']);
  // Idempotent; a seed deploy that changed an unedited profile is a new seed version.
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 0 });
  fs.writeFileSync(path.join(workflows, 'plain.json'), profile('Plain v2'));
  assert.deepEqual(store.migrate(), { profiles: 2, versions: 1 });
  assert.deepEqual(store.versions('plain').map((item) => [item.version, item.origin]), [[2, 'seed'], [1, 'seed']]);
  assert.equal(fs.readFileSync(path.join(workflows, '.studio-edits.json'), 'utf8'), before, '.studio-edits.json is left for the deploy script');
  assert.equal(fs.readdirSync(path.join(dir, 'backups', 'profile-edits')).length, 2, 'backups stay');
  // The same text again is no new version.
  assert.equal(store.record('plain', profile('Plain v2'), { origin: 'studio' }).version, 2);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'history', 'profiles', 'plain')).sort(), ['1.json', '2.json']);
});

test('saving through the editor records versions, marks AI drafts until an edit or Approve, and reverts as a new version', () => {
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(userWorkflowsDir, 'image-test.json'), profile('Seed Name'));
  const store = createProfileStore({ log: quiet });
  const { hash } = editor.readEditableProfile('image-test');
  const drafted = editor.saveEditableProfile('image-test', profile('AI Name'), { baseHash: hash, by: 'assistant', origin: 'ai', aiDrafted: true });
  assert.deepEqual([drafted.version.version, drafted.version.origin, drafted.version.aiDrafted], [2, 'ai', true]);
  assert.deepEqual(store.versions('image-test').map((item) => [item.version, item.origin]), [[2, 'ai'], [1, 'seed']]);
  assert.equal(store.approve('image-test', { by: 'admin-1' }).aiDrafted, false);
  editor.saveEditableProfile('image-test', profile('AI Name', { nsfw: true }), { baseHash: drafted.hash, by: 'assistant', origin: 'ai', aiDrafted: true });
  const edited = editor.saveEditableProfile('image-test', profile('Admin Name'), { by: 'admin-1' });
  assert.deepEqual([edited.version.version, edited.version.aiDrafted, edited.version.by], [4, false, 'admin-1'], 'an administrator’s edit clears AI-Drafted');
  const reverted = editor.revertEditableProfile('image-test', 1, { by: 'admin-1', baseHash: edited.hash });
  assert.match(reverted.text, /Seed Name/);
  assert.deepEqual(store.versions('image-test').map((item) => item.version), [5, 4, 3, 2, 1], 'history only grows');
  assert.equal(JSON.parse(fs.readFileSync(path.join(userWorkflowsDir, '.studio-edits.json'), 'utf8'))['image-test'].by, 'admin-1', 'still written');
  assert.throws(() => editor.revertEditableProfile('image-test', 9), /version was not found/);
});

const seedGuides = (summary = 'Seed summary.') => ({
  reviewed_on: '2026-10-01',
  families: { krea2: { image: 'krea2' } },
  packs: { krea2: { name: 'Krea 2', summary, rules: ['R'] }, other: { name: 'Other', summary: 'Other summary.' } },
  profiles: { 'custom:fixture': { pack: 'other' } },
  variants: {},
  negatives: { 'custom:fixture': { effect: 'none', notes: 'No negative.' } }
});

test('guides copy from the seed once, follow it for unchanged packs, and keep Studio’s edits', (t) => {
  const dir = scratch(t);
  const seedFile = path.join(dir, 'config', 'prompting.json');
  fs.mkdirSync(path.dirname(seedFile), { recursive: true });
  fs.writeFileSync(seedFile, JSON.stringify(seedGuides()));
  const seedText = fs.readFileSync(seedFile, 'utf8');
  const store = createGuideStore({ dataDir: dir, seedFile, log: quiet });
  assert.deepEqual(store.migrate(), { packs: 2, versions: 2 });
  assert.deepEqual(store.read().meta.krea2, { version: 1, origin: 'seed', aiDrafted: false, editedAt: store.read().meta.krea2.editedAt, by: 'seed', seedHash: hashOf(seedGuides().packs.krea2), exportedHash: '' });
  assert.deepEqual(store.migrate(), { packs: 2, versions: 0 }, 'idempotent');
  // Studio edits one pack; a stale base is refused.
  const { hash } = store.pack('other');
  assert.throws(() => store.save('other', { summary: 'x' }, { baseHash: 'stale' }), /changed since you opened it/);
  store.save('other', { name: 'Other', summary: 'Studio summary.' }, { by: 'admin-1', baseHash: hash });
  // The seed changes both packs: only the unchanged one follows.
  fs.writeFileSync(seedFile, JSON.stringify({ ...seedGuides('Seed summary v2.'), packs: { ...seedGuides('Seed summary v2.').packs, other: { summary: 'Seed other v2.' } } }));
  assert.deepEqual(store.migrate(), { packs: 2, versions: 1 });
  assert.deepEqual([store.pack('krea2').pack.summary, store.pack('krea2').meta.version, store.pack('other').pack.summary], ['Seed summary v2.', 2, 'Studio summary.']);
  // An AI draft is marked until approved; revert restores an earlier version as a new one.
  store.save('other', { summary: 'AI summary.' }, { by: 'assistant', origin: 'ai', aiDrafted: true });
  assert.equal(store.pack('other').meta.aiDrafted, true);
  assert.equal(store.approve('other', { by: 'admin-1' }).aiDrafted, false);
  store.revert('other', 1, { by: 'admin-1' });
  assert.deepEqual([store.pack('other').pack.summary, store.versions('other').map((item) => item.version)], ['Other summary.', [4, 3, 2, 1]]);
  assert.throws(() => store.save('broken', 'text'), /JSON object/);
  assert.equal(fs.readFileSync(seedFile, 'utf8').length > 0 && fs.readFileSync(seedFile, 'utf8') !== seedText, true, 'only the test changed the seed');
});

test('the guide loader reads the store first, falls back to the seed, reloads on change and fills negatives', (t) => {
  const dir = scratch(t);
  const seedFile = path.join(dir, 'prompting.json');
  fs.writeFileSync(seedFile, JSON.stringify(seedGuides()));
  const prompting = livePrompting({ dataDir: dir, seedFile, log: quiet, negatives: true });
  const fixture = { id: 'custom:fixture', family: 'krea2', kind: 'image' };
  assert.equal(prompting(fixture, true).summary, 'Other summary.', 'the seed while there is no store');
  assert.deepEqual(prompting(fixture, true).negative, { effect: 'none', notes: 'No negative.' });
  // MCP's loader leaves negatives off: its guides stay exactly as loadMcpPrompting gives them.
  const mcp = livePrompting({ dataDir: dir, seedFile, log: quiet });
  assert.deepEqual(mcp(fixture, true), loadMcpPrompting(seedFile)(fixture, true));
  const store = createGuideStore({ dataDir: dir, seedFile, log: quiet });
  store.migrate();
  store.save('other', { summary: 'Edited in Studio.' }, { by: 'admin-1' });
  assert.equal(prompting(fixture, true).summary, 'Edited in Studio.', 'a saved guide applies without a restart');
  assert.equal(prompting({ id: 'x', family: 'krea2', kind: 'image' }).summary, 'Seed summary.');
  // Owned guidance still wins, as before.
  assert.equal(prompting({ ...fixture, prompting: { id: 'own', summary: 'Own.' } }, true).summary, 'Own.');
});
