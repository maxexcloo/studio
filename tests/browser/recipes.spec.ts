import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('prepared recipes select actual workflows without merging conditioning variants', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const standard = { ...base, displayName: 'Example · Standard', label: 'Example · Standard', baseModel: 'example.safetensors', recipe: { modelLabel: 'Example Base', conditioning: 'Generate', label: 'Standard · 30-Step', adapters: [] } };
  const accelerated = { ...standard, id: 'example-turbo', workflow: 'example-turbo', label: 'Example · Turbo', displayName: 'Example · Turbo', defaults: { ...standard.defaults, steps: 4 }, recipe: { ...standard.recipe, label: 'Turbo · 4-Step', adapters: ['accel.safetensors'] } };
  const reference = { ...standard, id: 'example-reference', recipe: { ...standard.recipe, conditioning: 'Reference', modelLabel: 'Example Reference' } };
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), standard, accelerated, reference];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  const ui = studioUi(page);
  // The phone keeps the recipe in its model sheet; the full studio keeps it in the composer.
  const phone = await ui.isPhone();
  if (phone) await ui.openModelPicker();
  else await ui.openComposer();
  let recipe = page.getByLabel('Recipe', { exact: true }).filter({ visible: true }).first();
  await expect(recipe).toBeVisible();
  await expect(recipe.locator('option')).toHaveText(['Standard · 30-Step', 'Turbo · 4-Step']);
  await recipe.selectOption('example-turbo');
  await expect(recipe).toHaveValue('example-turbo');
  const menu = phone ? ui.modelPicker : await ui.openModelPicker();
  await menu.getByPlaceholder('Search Models', { exact: true }).fill('Example');
  await expect(ui.modelOptions.filter({ hasText: 'Example Base' })).toHaveCount(1);
  await expect(ui.modelOptions.filter({ hasText: 'Example Reference' })).toHaveCount(1);
  await ui.modelOptions.filter({ hasText: 'Example Reference' }).click();
  if (phone) await ui.openModelPicker();
  recipe = page.getByLabel('Recipe', { exact: true }).filter({ visible: true }).first();
  await expect(recipe.locator('option')).toHaveText(['Standard · 30-Step']);
  await expect(recipe).toHaveValue('example-reference');
});
