import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('image count keeps minus and plus across profile widths and mobile sizes', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const names = ['Count Short', 'Count With A Much Longer Profile Name'];
  const profiles = names.map((name, index) => ({ ...base, id: index ? 'count-long-profile' : base.id, displayName: name, label: name, defaults: { ...base.defaults, count: 4 }, constraints: { ...base.constraints, count: { min: 1, max: 8, step: 1 } }, capabilities: { ...base.capabilities, variations: true } }));
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), ...profiles];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const root = await ui.openComposer();
  for (const width of phone ? [390, 320] : [1440, 900]) {
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    for (const name of names) {
      await ui.chooseModel(name);
      const picker = root.locator('.composer-count-picker').filter({ visible: true });
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
  // The row names Studio's own family for the model (catalogueNames.js), not the profile's familyName.
  await expect(option).toContainText('FLUX');
  await expect(option).toContainText('Image');
  await expect(option).toContainText('3 Reference Images');
  // The picked row: a tick in the desktop menu; on the phone the reserved tick column shows it and the row is current.
  if (await ui.isPhone()) await expect(option).toHaveAttribute('aria-current', 'true');
  else await expect(option.locator('.model-selection-tick')).toBeVisible();
  await expect(menu.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Find (More )?Models/ })).toHaveCount(0);
  // The full studio's menu has hover states, and no Browse Models: the chooser is the only way to pick.
  if (!await ui.isPhone()) {
    await page.mouse.move(0, 0);
    await expect(option).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(option).toHaveCSS('box-shadow', 'none');
  }
  await expect(menu.getByRole('button', { name: 'Browse Models', exact: true })).toHaveCount(0);
});

// UI-PATTERNS › Pickers: one heading row. Title, filters, search and Close share one centre line,
// and the search grows leftwards from its icon inside that row without moving anything vertically.
test('the model chooser heading keeps its filters, search and Close on one centre line', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const menu = await ui.openModelPicker();
  const heading = menu.locator('.reference-popover-head').first();
  const centres = () => heading.evaluate((head) => {
    const parts = [...head.querySelectorAll<HTMLElement>('.surface-title, .picker-view .picker-dropdown-trigger, .model-filters button, .picker-search-toggle, .picker-search-field > *, .reference-popover-close')]
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; });
    return { spread: Math.max(...parts) - Math.min(...parts), count: parts.length };
  });
  // Measured once the opening scale has settled.
  await expect.poll(async () => (await centres()).spread).toBeLessThanOrEqual(1);
  const before = await centres();
  expect(before.count).toBeGreaterThanOrEqual(3);
  // The entry scale has finished once the heading's height holds still.
  const settled = async () => { let last = -1; await expect.poll(async () => { const next = (await heading.boundingBox())!.height; const same = Math.abs(next - last) < 0.1; last = next; return same; }, { intervals: [120] }).toBe(true); return last; };
  const height = await settled();
  await menu.getByRole('button', { name: 'Search Models', exact: true }).click();
  await expect(menu.getByRole('combobox', { name: 'Search Models' }).or(menu.getByRole('textbox', { name: 'Search Models' })).first()).toBeFocused();
  await expect.poll(async () => (await centres()).spread).toBeLessThanOrEqual(1);
  expect((await centres()).count).toBeGreaterThan(before.count - 1);
  expect(Math.abs((await settled()) - height)).toBeLessThanOrEqual(1);
  // On the desktop the field sits inside the row, before Close Search, not on a row of its own.
  if (!await ui.isPhone()) {
    const field = await menu.locator('.picker-search-field').boundingBox();
    const close = await menu.getByRole('button', { name: 'Close Search', exact: true }).boundingBox();
    expect(field!.x + field!.width).toBeLessThanOrEqual(close!.x + 1);
    expect(Math.abs((field!.y + field!.height / 2) - (close!.y + close!.height / 2))).toBeLessThanOrEqual(1);
  }
});
