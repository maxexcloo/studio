import { expect, test } from '@playwright/test';

for (const supported of [0, 1, 2]) test(`native resolution choices follow model support (${supported})`, async ({ page, isMobile }) => {
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
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt').filter({ visible: true });
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A mountain');
  await root.getByRole('button', { name: isMobile ? 'Aspect Ratio' : /^Size:/ }).click();
  const menu = page.locator(isMobile ? '.phone-size' : '.size-menu').filter({ visible: true });
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
    await expect(menu.getByRole('radio')).toHaveCount(0);
    await menu.getByRole('combobox', { name: 'Resolution', exact: true }).click();
    await page.getByRole('option', { name: '4K', exact: true }).click();
  }
  if (isMobile) await menu.getByRole('button', { name: 'Close', exact: true }).click();
  else await page.keyboard.press('Escape');
  await root.locator('.composer-submit-actions button').click();
  await expect.poll(() => request).toBeTruthy();
  expect(Math.max(request.width, request.height)).toBe(supported === 2 ? 4096 : 2048);
  expect(request.tiledDecode).toBe(true);
  expect(request.autoUpscale).toBeUndefined();
});
