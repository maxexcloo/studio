import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('image count keeps minus and plus across profile widths and mobile sizes', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const names = ['Count Short', 'Count With A Much Longer Profile Name'];
  const profiles = names.map((name, index) => ({ ...base, id: index ? 'count-long-profile' : base.id, displayName: name, label: name, defaults: { ...base.defaults, count: 4 }, constraints: { ...base.constraints, count: { min: 1, max: 8, step: 1 } }, capabilities: { ...base.capabilities, variations: true } }));
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), ...profiles];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  // Every project has a touch screen, so 640px would switch to the phone studio; the full one is chosen to keep it.
  if (!isMobile) await page.addInitScript(() => { localStorage.setItem('heiss-ui-prefs', JSON.stringify({ fullStudioOnPhone: true })); });
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const root = await ui.openComposer();
  for (const width of phone ? [390, 320] : [1440, 900, 640]) {
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    for (const name of names) {
      await ui.chooseModel(name);
      const picker = root.locator('.composer-count-picker').filter({ visible: true });
      if (!await picker.count()) await root.getByRole('button', { name: 'More Settings', exact: true }).click();
      await expect(picker).toBeVisible();
      const decrease = picker.getByRole('button', { name: 'Decrease Images', exact: true });
      const increase = picker.getByRole('button', { name: 'Increase Images', exact: true });
      await expect(decrease).toBeVisible();
      await expect(increase).toBeVisible();
      await expect(picker).not.toHaveClass(/is-density-mini/);
      await increase.click();
      await expect(picker.getByRole('button', { name: 'Images: 3', exact: true })).toBeVisible();
      await decrease.click();
      await expect(picker.getByRole('button', { name: 'Images: 2', exact: true })).toBeVisible();
      if (phone) for (const button of [decrease, increase]) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      if (await root.locator('.composer-drawer').isVisible()) await root.locator('.composer-drawer').getByRole('button', { name: 'Close Settings', exact: true }).click();
    }
  }
});

test('model menus show profile details without recent sections or discovery footers', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const profile = { ...base, displayName: 'Detailed Model', label: 'Studio Profile', familyName: 'Test Family', recipe: undefined, recipeProfiles: undefined, mediaInputs: [{ id: 'reference', kind: 'image', max: 3, min: 0, required: false }] };
  models.profiles = [profile];
  const workflows = await (await page.request.get('/api/workflows')).json();
  workflows.preferences = { ...workflows.preferences, favorites: [], lastUsed: { [profile.id]: new Date().toISOString() } };
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/workflows', route => route.fulfill({ json: workflows }));
  await page.goto('/');
  const ui = studioUi(page);
  const menu = await ui.openModelPicker();
  const option = ui.modelOptions.filter({ hasText: 'Detailed Model' }).first();
  await expect(option).toContainText('Studio Profile');
  await expect(option).toContainText('Test Family');
  await expect(option).toContainText('Image');
  await expect(option).toContainText('3 Reference Images');
  await expect(option.locator('.model-selection-tick')).toBeVisible();
  await expect(menu.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Find (More )?Models/ })).toHaveCount(0);
  // Only the full studio's menu offers Browse Models and hover states.
  if (!await ui.isPhone()) {
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
