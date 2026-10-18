import { expect, test } from '@playwright/test';

test('native 2K reaches generation without automatic upscaling on desktop and phone', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
    profile.native = { '2k': 'yes' };
    profile.mediaInputs = [];
    profile.capabilities.startImageRequired = false;
  }
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  const requests: any[] = [];
  await page.route('**/api/generate', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'Captured native sizing' } });
  });
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt').filter({ visible: true });
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A mountain at sunrise');
  await root.getByRole('button', { name: isMobile ? 'Aspect Ratio' : /^Size:/ }).click();
  const menu = page.locator(isMobile ? '.phone-size' : '.size-menu').filter({ visible: true });
  await menu.getByRole('radio', { name: '2K', exact: true }).click();
  await expect(menu.getByRole('radio', { name: '2K', exact: true })).toHaveAttribute('aria-checked', 'true');
  if (isMobile) await menu.getByRole('button', { name: 'Close', exact: true }).click();
  else await page.keyboard.press('Escape');
  await root.locator('.composer-submit-actions button').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(Math.max(requests[0].width, requests[0].height)).toBe(2048);
  expect(requests[0].tiledDecode).toBe(true);
  expect(requests[0].autoUpscale).toBeUndefined();
});

test('Edit and Reference preserve their framing rules when submitting', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const profile = models.profiles.find((item: any) => item.id === models.defaults.imageModel);
  profile.workflow = 'family:flux3';
  profile.family = 'flux3';
  profile.native = { '2k': 'yes' };
  profile.aspectPolicy = 'reference';
  profile.mediaInputs = [{ id: 'reference', kind: 'image', role: 'reference', label: 'Reference Image', min: 0, max: 1 }];
  models.profiles = [profile];
  const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#699b88"/></svg>');
  const asset = { id: 'role-reference', source: 'upload', name: 'Role Reference', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 512, height: 768, size: 10, createdAt: '', privacyDomain: 'gallery' };
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', route => route.fulfill({ json: { items: [asset], nextCursor: '' } }));
  const requests: any[] = [];
  await page.route('**/api/generate', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'Captured reference role' } });
  });
  await page.goto('/');
  const open = async () => {
    if (isMobile && !await page.locator('.phone-create').isVisible()) await page.locator('.phone-create-open').click();
    else if (!isMobile) await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  };
  await open();
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  await page.getByRole('button', { name: 'Role Reference', exact: true }).click();
  await expect(page.locator('.reference-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A painted mountain');
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt').filter({ visible: true });
  await root.locator('.composer-submit-actions button').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].referenceRole).toBe('edit');
  expect(requests[0].width / requests[0].height).toBeCloseTo(512 / 768, 1);
  if (isMobile) await expect(root).toHaveCount(0);
  await open();
  await page.getByRole('radio', { name: 'Reference', exact: true }).click();
  await root.locator('.composer-submit-actions button').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].referenceRole).toBe('reference');
  expect(requests[1].width).toBe(profile.defaults.width);
  expect(requests[1].height).toBe(profile.defaults.height);
});
