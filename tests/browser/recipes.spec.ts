import { expect, test } from '@playwright/test';
import { studioUi, pickerSearch } from './helpers/ui';

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
  // The shared dropdown on both devices (UI-PATTERNS › Dropdowns).
  let recipe = page.getByRole('combobox', { name: 'Recipe', exact: true }).filter({ visible: true }).first();
  await expect(recipe).toBeVisible();
  await recipe.click();
  await expect(page.getByRole('listbox', { name: 'Recipe', exact: true }).getByRole('option')).toHaveText(['Standard · 30-Step', 'Turbo · 4-Step']);
  await page.getByRole('option', { name: 'Turbo · 4-Step', exact: true }).click();
  await expect(recipe).toContainText('Turbo · 4-Step');
  const menu = phone ? ui.modelPicker : await ui.openModelPicker();
  await (await pickerSearch(menu, 'Search Models', phone ? 'textbox' : 'combobox')).fill('Example');
  await expect(ui.modelOptions.filter({ hasText: 'Example Base' })).toHaveCount(1);
  await expect(ui.modelOptions.filter({ hasText: 'Example Reference' })).toHaveCount(1);
  await ui.modelOptions.filter({ hasText: 'Example Reference' }).click();
  if (phone) await ui.openModelPicker();
  recipe = page.getByRole('combobox', { name: 'Recipe', exact: true }).filter({ visible: true }).first();
  await recipe.click();
  await expect(page.getByRole('listbox', { name: 'Recipe', exact: true }).getByRole('option')).toHaveText(['Standard · 30-Step']);
  await expect(page.getByRole('option', { name: 'Standard · 30-Step', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
});
