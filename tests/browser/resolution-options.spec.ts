import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

for (const supported of [0, 1, 2]) test(`native resolution choices follow model support (${supported})`, async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
    profile.native = supported === 2 ? { '2k': 'yes', '4k': 'yes' } : supported === 1 ? { '2k': 'yes', '4k': 'maybe' } : { '2k': 'maybe' };
    profile.constraints.width = { min: 64, max: 8192, step: 16 };
    profile.constraints.height = { min: 64, max: 8192, step: 16 };
    profile.mediaInputs = [];
    profile.capabilities.startImageRequired = false;
  }
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  let request: any;
  await page.route('**/api/generate', async route => { request = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured resolution' } }); });
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  await ui.prompt.fill('A mountain');
  const menu = await ui.openSizeMenu();
  await expect(menu.getByRole('button', { name: 'Custom Size', exact: true })).toBeVisible();
  if (!supported) {
    await expect(menu.getByText('Resolution', { exact: true })).toHaveCount(0);
    await expect(menu.getByRole('radio')).toHaveCount(0);
    return;
  }
  if (supported === 1) {
    await expect(menu.getByRole('radiogroup', { name: 'Resolution', exact: true })).toBeVisible();
    await expect(menu.getByRole('radio')).toHaveCount(2);
    await expect(menu.getByRole('radio', { name: '4K', exact: true })).toHaveCount(0);
    await menu.getByRole('radio', { name: '2K', exact: true }).click();
  } else {
    // A segmented toggle of the native options, however many.
    await expect(menu.getByRole('radio')).toHaveCount(3);
    await menu.getByRole('radio', { name: '4K', exact: true }).click();
  }
  // The panel stays open, so a shape can be picked in the same go.
  await expect(menu).toBeVisible();
  const shape = menu.locator('.aspect-option, .phone-size-row').filter({ hasText: /1:1|Square/ }).first();
  if (await shape.count()) { await shape.click(); await expect(menu).toBeVisible(); }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await ui.generate.click();
  await expect.poll(() => request).toBeTruthy();
  expect(Math.max(request.width, request.height)).toBe(supported === 2 ? 4096 : 2048);
  expect(request.tiledDecode).toBe(true);
  expect(request.autoUpscale).toBeUndefined();
});
