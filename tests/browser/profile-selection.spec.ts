import { expect, test } from '@playwright/test';

test('image count keeps minus and plus across profile widths and mobile sizes', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const names = ['Count Short', 'Count With A Much Longer Profile Name'];
  const profiles = names.map((name, index) => ({ ...base, id: index ? 'count-long-profile' : base.id, displayName: name, label: name, defaults: { ...base.defaults, count: 4 }, constraints: { ...base.constraints, count: { min: 1, max: 8, step: 1 } }, capabilities: { ...base.capabilities, variations: true } }));
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), ...profiles];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  if (!isMobile) await page.addInitScript(() => { localStorage.setItem('heiss-ui-prefs', JSON.stringify({ fullStudioOnPhone: true })); });
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt').filter({ visible: true });
  for (const width of isMobile ? [390, 320] : [1440, 900, 640]) {
    await page.setViewportSize({ width, height: isMobile ? 844 : 1000 });
    for (const name of names) {
      if (isMobile) {
        await page.locator('.phone-create').getByRole('button', { name: 'Browse Models', exact: true }).click();
        await page.locator('.phone-model-sheet .phone-model-option').filter({ hasText: name }).first().click();
      } else {
        await root.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
        await root.locator('.model-trigger').click();
        await page.getByRole('option').filter({ hasText: name }).first().click();
      }
      const picker = root.locator('.composer-count-picker').filter({ visible: true });
      if (!await picker.count()) await root.getByRole('button', { name: 'More settings', exact: true }).click();
      await expect(picker).toBeVisible();
      const decrease = picker.getByRole('button', { name: 'Decrease images', exact: true });
      const increase = picker.getByRole('button', { name: 'Increase images', exact: true });
      await expect(decrease).toBeVisible();
      await expect(increase).toBeVisible();
      await expect(picker).not.toHaveClass(/is-density-mini/);
      await increase.click();
      await expect(picker.getByRole('button', { name: 'Images: 5, click to edit', exact: true })).toBeVisible();
      await decrease.click();
      await expect(picker.getByRole('button', { name: 'Images: 4, click to edit', exact: true })).toBeVisible();
      if (isMobile) for (const button of [decrease, increase]) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      if (!isMobile && await root.locator('.composer-drawer').isVisible()) await root.locator('.composer-drawer').getByRole('button', { name: 'Close settings', exact: true }).click();
    }
  }
});

test('model menus show profile details without recent sections or discovery footers', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const profile = { ...base, displayName: 'Detailed Model', label: 'Studio Profile', familyName: 'Test Family', recipe: undefined, recipeProfiles: undefined, mediaInputs: [{ id: 'reference', kind: 'image', max: 3, min: 0, required: false }] };
  models.profiles = [profile];
  const workflows = await (await page.request.get('/api/workflows')).json();
  workflows.preferences = { ...workflows.preferences, favorites: [], lastUsed: { [profile.id]: new Date().toISOString() } };
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/workflows', route => route.fulfill({ json: workflows }));
  await page.goto('/');
  if (isMobile) {
    await page.locator('.phone-create-open').click();
    await page.locator('.phone-create').getByRole('button', { name: 'Browse Models', exact: true }).click();
  } else {
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
    await page.locator('.zen-prompt .model-trigger').click();
  }
  const menu = page.locator(isMobile ? '.phone-model-sheet' : '.model-menu');
  const option = menu.locator(isMobile ? '.phone-model-option' : '[role="option"]').filter({ hasText: 'Detailed Model' }).first();
  await expect(option).toContainText('Studio Profile');
  await expect(option).toContainText('Test Family');
  await expect(option).toContainText('Image');
  await expect(option).toContainText('3 Reference Images');
  await expect(option.locator('.model-selection-tick')).toBeVisible();
  await expect(menu.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Find (More )?Models/ })).toHaveCount(0);
  if (!isMobile) {
    await page.mouse.move(0, 0);
    await expect(option).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(option).toHaveCSS('box-shadow', 'none');
    const browse = menu.getByRole('button', { name: 'Browse Models', exact: true });
    await expect(browse).toHaveClass(/model-option/);
    await expect.poll(() => menu.evaluate(element => {
      const selected = element.querySelector('[role="option"][aria-selected="true"]')!;
      const browse = element.querySelector('.model-menu-browse')!;
      const row = selected.getBoundingClientRect();
      const footer = browse.getBoundingClientRect();
      const selectedText = selected.querySelector('.model-copy')!.getBoundingClientRect();
      const footerText = browse.querySelector('.model-copy')!.getBoundingClientRect();
      return Math.abs(row.left - footer.left) <= 1 && Math.abs(row.right - footer.right) <= 1 && Math.abs(selectedText.left - footerText.left) <= 1;
    })).toBe(true);
    await browse.click();
    await expect(page.locator('.workflow-gallery')).toBeVisible();
    await expect(page.locator('.workflow-gallery').getByText('Recent', { exact: true })).toHaveCount(0);
  }
});
