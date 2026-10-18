import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRecipeOptions, optionalLoras, recipeModelMenu, recipesFor } from '../src/app/modelRecipes.js';

const profile = (id, conditioning = 'FL2VA', file = 'base.safetensors') => ({ id, kind: 'video', family: 'minimax_h3', baseModel: file, label: id, recipe: { modelLabel: 'H3 · ' + conditioning, conditioning, label: id, adapters: ['turbo.safetensors'] } });

test('model selection groups prepared recipes while retaining the selected workflow identity', () => {
  const profiles = [profile('standard'), profile('turbo4'), profile('ref', 'Ref2VA'), profile('fine-tune', 'FL2VA', 'fine-tune.safetensors')];
  const models = modelRecipeOptions(profiles, 'turbo4');
  assert.equal(models.length, 3);
  assert.equal(models[0].id, 'turbo4');
  assert.equal(models[0].displayName, 'H3 · FL2VA');
  assert.deepEqual(recipesFor(profiles, 'turbo4').map((item) => item.id), ['standard', 'turbo4']);
  assert.equal(profiles[1].label, 'turbo4');
  assert.deepEqual(recipesFor(profiles.filter((item) => item.id !== 'standard'), 'turbo4').map((item) => item.id), ['turbo4']);
});

test('unknown workflows are not grouped by similar names or model family', () => {
  const profiles = [{ id: 'a', family: 'minimax_h3', baseModel: 'same' }, { id: 'b', family: 'minimax_h3', baseModel: 'same' }];
  assert.equal(modelRecipeOptions(profiles, 'a').length, 2);
  assert.deepEqual(recipesFor(profiles, 'a'), []);
});

test('optional picker excludes known infrastructure and recipe-owned files but keeps unknown effects', () => {
  const options = ['effect', 'unknown', 'turbo.safetensors', 'accel', 'source'];
  const infos = { effect: { role: 'effect' }, accel: { role: 'acceleration' }, source: { role: 'supporting' } };
  assert.deepEqual(optionalLoras(options, infos, profile('turbo4')), ['effect', 'unknown']);
  assert.deepEqual(options, ['effect', 'unknown', 'turbo.safetensors', 'accel', 'source']);
});


test('grouping preserves original favourite identities and exposes every available recipe speed', async () => {
  const { profileMatchesFilters } = await import('../src/app/catalogueNames.js');
  const profiles = [profile('standard'), profile('turbo4')];
  profiles[0].defaults = { steps: 30 };
  profiles[1].defaults = { steps: 4 };
  const toggled = [];
  const original = { favorites: ['turbo4'], recents: ['turbo4'], toggleFavorite: (id) => toggled.push(id) };
  const menu = recipeModelMenu(original, profiles, 'standard');
  assert.deepEqual(menu.favorites, ['standard']);
  assert.deepEqual(menu.recents, ['standard']);
  menu.toggleFavorite('standard');
  assert.deepEqual(toggled, ['turbo4']);
  assert.deepEqual(original.favorites, ['turbo4']);
  const model = modelRecipeOptions(profiles, 'standard')[0];
  assert.equal(profileMatchesFilters(model, { speed: 'flash' }), true);
  assert.equal(profileMatchesFilters(model, { speed: 'standard' }), true);
});


test('model recipe projection preserves model version and precision on the second line', async () => {
  const { modelName } = await import('../src/app/catalogueNames.js');
  const model = { ...profile('fine-tune'), kind: 'image', family: 'krea2', label: 'Tesserafine Turbo · Fast · 8 Steps · V1.0 · INT8 ConvRot', recipe: { modelLabel: 'Tesserafine Turbo', conditioning: 'Image', label: 'Turbo · 8 Steps' } };
  const projected = modelRecipeOptions([model], model.id)[0];
  assert.equal(modelName(projected).name, 'Tesserafine Turbo');
  assert.match(modelName(projected).detail, /V1[.]0/);
  assert.match(modelName(projected).detail, /INT8 ConvRot/);
  assert.equal(projected.id, model.id);
});
