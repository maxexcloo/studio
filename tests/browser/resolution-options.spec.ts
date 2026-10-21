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
  // Width and Height are always there, but only Custom (the last size option) unlocks them.
  await expect(menu.getByRole('textbox', { name: 'Width in Pixels', exact: true })).toBeVisible();
  await expect(menu.getByRole('textbox', { name: 'Width in Pixels', exact: true })).toBeDisabled();
  await expect(menu.getByRole('button', { name: 'Custom Size', exact: true })).toHaveCount(0);
  await expect(menu.locator('.aspect-option, .size-option').last()).toHaveClass(/is-custom/);
  // The preview already names the size: no megapixel and ratio caption under the fields.
  await expect(menu.locator('.size-custom-note')).toHaveCount(0);
  const resolution = menu.getByRole('radiogroup', { name: 'Resolution', exact: true });
  if (!supported) {
    await expect(menu.getByText('Resolution', { exact: true })).toHaveCount(0);
    await expect(resolution).toHaveCount(0);
    return;
  }
  if (supported === 1) {
    await expect(resolution).toBeVisible();
    await expect(resolution.getByRole('radio')).toHaveCount(2);
    await expect(resolution.getByRole('radio', { name: '4K', exact: true })).toHaveCount(0);
    await resolution.getByRole('radio', { name: '2K', exact: true }).click();
  } else {
    // A segmented toggle of the native options, however many.
    await expect(resolution.getByRole('radio')).toHaveCount(3);
    await resolution.getByRole('radio', { name: '4K', exact: true }).click();
  }
  // The panel stays open, so a shape can be picked in the same go.
  await expect(menu).toBeVisible();
  const shape = menu.locator('.aspect-option, .size-option').filter({ hasText: /1:1|Square/ }).first();
  if (await shape.count()) { await shape.click(); await expect(menu).toBeVisible(); }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await ui.generate.click();
  await expect.poll(() => request).toBeTruthy();
  expect(Math.max(request.width, request.height)).toBe(supported === 2 ? 4096 : 2048);
  expect(request.tiledDecode).toBe(true);
  expect(request.autoUpscale).toBeUndefined();
});

test('Custom sits last in the size options and unlocks width and height', async ({ page }) => {
  let request: any;
  await page.route('**/api/generate', async route => { request = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured custom size' } }); });
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  await ui.prompt.fill('A mountain');
  const menu = await ui.openSizeMenu();
  const width = menu.getByRole('textbox', { name: 'Width in Pixels', exact: true });
  await expect(width).toBeDisabled();
  const custom = menu.locator('.aspect-option.is-custom, .size-option.is-custom');
  await custom.click();
  await expect(custom).toHaveAttribute(await custom.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-selected', 'true');
  await expect(width).toBeEnabled();
  // Picking a shape leaves Custom and locks the fields again.
  await menu.locator('.aspect-option:not(.is-custom), .size-option:not(.is-custom)').first().click();
  await expect(width).toBeDisabled();
  await custom.click();
  await expect(width).toBeEnabled();
  await width.fill('1200');
  await width.press('Enter');
  await page.keyboard.press('Escape');
  await ui.generate.click();
  await expect.poll(() => request).toBeTruthy();
  expect(request.width).toBe(1200);
});
