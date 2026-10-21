import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-profile-block-'));
process.env.STUDIO_DATA_DIR = temporary;
process.env.COMFY_URL = 'http://127.0.0.1:9';
const { profileBlock, profileBlockName, profileBlocksIn, withWrittenBlock, writtenBlockName } = await import('./profile-block.js');
const { allCustomWorkflowRecords, metadataFromJson, userWorkflowsDir, saveImportedWorkflow } = await import('./custom-workflows.js');
const { validateProfileText, createEditableProfile, approveEditableProfile } = await import('./profile-editor.js');
const { draftedProfile } = await import('./assistant.js');
const { effectiveAccountAccess, mayUseGenerationProfile, visibleGenerationProfiles } = await import('./account-policy.js');
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const graph = { 1: { class_type: 'UNETLoader', inputs: { unet_name: 'model.safetensors' } }, 2: { class_type: 'CLIPTextEncode', inputs: { text: '' } } };
const block = (id, extra = {}) => ({ id, name: `Profile ${id}`, kind: 'image', family: 'krea2', controls: { prompt: { node: '2', input: 'text' } }, ...extra });

test('both the studio and heissUi block names are read; heissUi is still what Studio writes', () => {
  assert.equal(writtenBlockName, 'heissUi');
  assert.equal(profileBlock({ studio: { name: 'New' }, graph })?.name, 'New');
  assert.equal(profileBlock({ heissUi: { name: 'Old' }, graph })?.name, 'Old');
  assert.equal(profileBlock({ heiss_ui: { name: 'Older' } })?.name, 'Older');
  assert.equal(profileBlock({ graph }), null);
  assert.equal(profileBlockName({ heissUi: {}, studio: {} }), 'studio');
  assert.deepEqual(profileBlocksIn({ heissUi: {}, studio: {}, graph }), ['studio', 'heissUi']);
  assert.deepEqual(Object.keys(withWrittenBlock({ graph, studio: { name: 'New' } })), ['heissUi', 'graph']);
  // Workflows and profiles read through either name.
  assert.equal(metadataFromJson({ studio: block('new-block'), graph }, 'new-block.json').name, 'Profile new-block');
  assert.equal(metadataFromJson({ heissUi: block('old-block'), graph }, 'old-block.json').name, 'Profile old-block');
  // A template under "studio" drafts a profile under "heissUi".
  const drafted = draftedProfile({ id: 'drafted', template: { studio: block('template', { defaults: { model: 'model.safetensors' } }), graph }, modelFile: 'next.safetensors' });
  assert.deepEqual([Object.keys(drafted).includes('studio'), drafted.heissUi.id, drafted.graph['1'].inputs.unet_name], [false, 'drafted', 'next.safetensors']);
});

test('the profile check accepts either name, names the block it found and refuses both at once', () => {
  assert.equal(validateProfileText('a', JSON.stringify({ studio: block('a'), graph })).ok, true);
  assert.equal(validateProfileText('a', JSON.stringify({ heissUi: block('a'), graph })).ok, true);
  assert.match(validateProfileText('a', JSON.stringify({ studio: block('a', { name: '' }), graph })).errors.join(' '), /studio\.name is required/);
  assert.match(validateProfileText('a', JSON.stringify({ studio: block('a'), heissUi: block('a'), graph })).errors.join(' '), /Keep one profile block: this file has studio and heissUi/);
  assert.match(validateProfileText('a', JSON.stringify({ graph })).errors.join(' '), /Missing the heissUi \(or studio\) block/);
});

test('an imported workflow carrying a studio block is saved under heissUi only', () => {
  const saved = saveImportedWorkflow({ studio: block('imported'), graph }, { name: 'Imported Here' });
  const raw = JSON.parse(fs.readFileSync(saved.path, 'utf8'));
  assert.deepEqual([raw.studio, raw.heissUi.name], [undefined, 'Imported Here']);
});

test('AI-drafted profiles are live for administrators only until approved', () => {
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  createEditableProfile('drafted-gate', JSON.stringify({ heissUi: block('drafted-gate'), graph }), { by: 'assistant' });
  const records = () => allCustomWorkflowRecords({ dedupe: false });
  assert.equal(records().find((item) => item.id === 'drafted-gate').aiDrafted, true);
  assert.equal(records().some((item) => item.id.startsWith('studio-') || item.name.startsWith('.')), false, 'Studio’s dotfiles are not workflows');
  const user = effectiveAccountAccess({ id: 'u1', role: 'user', accessProfileId: 'user' }, { user: { name: 'User', allModels: true, generationProfiles: ['custom:drafted-gate'], features: { nsfwModels: true } } });
  const admin = effectiveAccountAccess({ id: 'a1', role: 'administrator' }, {});
  const drafted = { id: 'custom:drafted-gate', family: 'krea2', aiDrafted: true };
  assert.equal(mayUseGenerationProfile(user, drafted), false, 'not even with an explicit grant');
  assert.equal(mayUseGenerationProfile(admin, drafted), true);
  assert.deepEqual(visibleGenerationProfiles([drafted, { id: 'custom:plain', family: 'krea2' }], user).map((item) => item.id), ['custom:plain']);
  approveEditableProfile('drafted-gate', { by: 'a1' });
  const approved = records().find((item) => item.id === 'drafted-gate');
  assert.equal(approved.aiDrafted, undefined);
  assert.equal(mayUseGenerationProfile(user, { id: approved.profileId, family: approved.family, aiDrafted: approved.aiDrafted }), true, 'after review it follows the access profile');
});
