import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('a model without references offers Reference With, which switches model and opens the picker', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const images = models.profiles.filter((profile: { kind: string }) => profile.kind === 'image');
  const current = images.find((profile: { id: string }) => profile.id === models.defaults.imageModel);
  const editor = images.find((profile: { id: string }) => profile.id !== current.id);
  // Only one image model takes a reference; the selected one doesn't.
  for (const profile of images) {
    profile.capabilities = { ...profile.capabilities, imageToImage: false, startImage: false };
    profile.mediaInputs = (profile.mediaInputs || []).filter((input: { kind: string }) => input.kind !== 'image');
  }
  editor.ready = true;
  editor.displayName = 'Reference Editor';
  editor.mediaInputs = [{ id: 'reference', kind: 'image', role: 'reference', label: 'Reference Image', min: 0, max: 1, required: false }];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await expect(composer.getByRole('button', { name: /Reference Image/ })).toHaveCount(0);
  await composer.getByRole('button', { name: 'Reference With', exact: true }).click();
  const list = page.getByRole('dialog', { name: 'Reference With', exact: true });
  await expect(list).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reference-with.png') });
  // Only the models that take a reference, labelled as the model picker labels them.
  await expect(list.locator('.reference-with-option')).toHaveCount(1);
  await list.getByRole('button', { name: /Reference Editor/ }).click();
  await expect(list).toHaveCount(0);
  // Switched, with its reference picker open straight away.
  await expect(page.locator('.reference-popover:not(.reference-with)')).toBeVisible();
  await expect(page.locator('.reference-popover input[type="file"]')).toHaveCount(1);
  await expect(composer.getByRole('button', { name: 'Reference With', exact: true })).toHaveCount(0);
  await expect(ui.modelTrigger).toContainText('Reference Editor');
});
