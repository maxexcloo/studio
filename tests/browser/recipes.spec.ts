import { expect, test } from '@playwright/test';

test('prepared recipes select actual workflows without merging conditioning variants', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const standard = { ...base, displayName: 'Example · Standard', label: 'Example · Standard', baseModel: 'example.safetensors', recipe: { modelLabel: 'Example Base', conditioning: 'Generate', label: 'Standard · 30-Step', adapters: [] } };
  const accelerated = { ...standard, id: 'example-turbo', workflow: 'example-turbo', label: 'Example · Turbo', displayName: 'Example · Turbo', defaults: { ...standard.defaults, steps: 4 }, recipe: { ...standard.recipe, label: 'Turbo · 4-Step', adapters: ['accel.safetensors'] } };
  const reference = { ...standard, id: 'example-reference', recipe: { ...standard.recipe, conditioning: 'Reference', modelLabel: 'Example Reference' } };
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), standard, accelerated, reference];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  if (!isMobile) await page.addInitScript(() => { localStorage.setItem('heiss-ui-prefs', JSON.stringify({ fullStudioOnPhone: true })); });
  await page.goto('/');
  if (isMobile) {
    await page.locator('.phone-create-open').click();
    await page.locator('.phone-create').getByRole('button', { name: 'Browse Models', exact: true }).click();
  } else await page.locator('.zen-prompt').getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  let recipe = page.getByLabel('Recipe', { exact: true }).filter({ visible: true }).first();
  await expect(recipe).toBeVisible();
  await expect(recipe.locator('option')).toHaveText(['Standard · 30-Step', 'Turbo · 4-Step']);
  await recipe.selectOption('example-turbo');
  await expect(recipe).toHaveValue('example-turbo');
  if (!isMobile) await page.locator('.model-trigger').filter({ visible: true }).click();
  const menu = page.locator(isMobile ? '.phone-model-sheet' : '.model-menu');
  await menu.getByPlaceholder('Search Models', { exact: true }).fill('Example');
  await expect(menu.locator(isMobile ? '.phone-model-option' : '.model-option').filter({ hasText: 'Example Base' })).toHaveCount(1);
  await expect(menu.locator(isMobile ? '.phone-model-option' : '.model-option').filter({ hasText: 'Example Reference' })).toHaveCount(1);
  await menu.locator(isMobile ? '.phone-model-option' : '.model-option').filter({ hasText: 'Example Reference' }).click();
  if (isMobile) await page.locator('.phone-create').getByRole('button', { name: 'Browse Models', exact: true }).click();
  recipe = page.getByLabel('Recipe', { exact: true }).filter({ visible: true }).first();
  await expect(recipe.locator('option')).toHaveText(['Standard · 30-Step']);
  await expect(recipe).toHaveValue('example-reference');
});
