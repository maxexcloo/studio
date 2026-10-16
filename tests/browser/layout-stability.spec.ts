import { expect, test, type Locator } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#497e7b"/></svg>');
const items = Array.from({ length: 12 }, (_, index) => ({ id: `layout-${index}`, url: picture, filename: `layout-${index}.png`, type: 'image', status: 'done', prompt: 'Layout test', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 640 }));

async function reachable(locator: Locator, hasTrailingAction = false) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element, hasTrailingAction) => {
    const box = element.getBoundingClientRect();
    return [box.left + 8, box.left + box.width / 2, ...(hasTrailingAction ? [] : [box.right - 8])].every((x) => element.contains(document.elementFromPoint(x, box.top + box.height / 2)));
  }, hasTrailingAction)).toBe(true);
}

test.beforeEach(async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.mediaInputs = [{ id: 'reference', kind: 'image', role: 'start', label: 'Start Image', required: false, min: 0, max: 1 }];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
  if (!isMobile) await page.addInitScript(() => localStorage.setItem('heiss-ui-prefs', JSON.stringify({ fullStudioOnPhone: true })));
});

test('desktop menus stay above controls and the viewer covers a pinned sidebar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop layering and pinning.');
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Generation Controls' });
  await expect(sidebar).toHaveClass(/open/);
  await page.locator('.zen-prompt .model-trigger').click();
  await reachable(page.locator('.model-menu .model-option').first(), true);
  await reachable(page.locator('.model-menu .model-star').first());
  await page.keyboard.press('Escape');
  const more = page.locator('.zen-prompt').getByRole('button', { name: 'More settings', exact: true });
  await more.click();
  await reachable(page.locator('.composer-drawer').getByRole('button', { name: 'Increase images', exact: true }));
  await page.locator('.composer-drawer').getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Close Controls', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Pin Controls', exact: true }).click();
  const sidebarBox = await sidebar.boundingBox();
  await page.locator('[data-tile-id]').first().locator('.tile').click();
  const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
  await expect.poll(() => viewer.evaluate((element, box) => element.contains(document.elementFromPoint(box!.x + box!.width / 2, box!.y + box!.height / 2)), sidebarBox)).toBe(true);
  await reachable(viewer.getByRole('button', { name: 'Toggle Details', exact: true }));
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Unpin Controls', exact: true }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/has-pinned-controls/);
});

test('search and selection preserve toolbar geometry while open surfaces remain reachable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop toolbar geometry.');
  await page.goto('/');
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    const toolbar = page.locator('.gallery-toolbar');
    const before = await toolbar.boundingBox();
    const modeBefore = await toolbar.locator('.gallery-generation-mode').boundingBox();
    const management = page.getByRole('group', { name: 'Gallery Management' });
    await management.getByRole('button', { name: 'Select', exact: true }).click();
    await management.getByRole('button', { name: 'Select All Loaded', exact: true }).click();
    await expect(management.getByRole('status')).toHaveText('12 Selected');
    const actionsBox = await toolbar.locator('.gallery-toolbar-actions').boundingBox();
    const modeBox = await toolbar.locator('.gallery-generation-mode').boundingBox();
    expect(actionsBox!.x).toBeGreaterThanOrEqual(modeBox!.x + modeBox!.width);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(width);
    await expect.poll(async () => (await toolbar.boundingBox())!.height).toBe(before!.height);
    expect((await toolbar.locator('.gallery-generation-mode').boundingBox())!.x).toBe(modeBefore!.x);
    await management.getByRole('button', { name: 'Stop Selecting', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search the gallery', exact: true }).fill('Layout');
    await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
    await reachable(page.getByLabel('Filter By Model', { exact: true }));
    expect((await toolbar.boundingBox())!.height).toBe(before!.height);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByLabel('Gallery View Options', { exact: true }).click();
    await reachable(page.locator('.gallery-view-panel button').first());
    await page.getByLabel('Gallery View Options', { exact: true }).click();
  }
});

test('phone filter panels stay on screen and yield to create and reference sheets', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone containment and sheets.');
  await page.goto('/');
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
    const panel = page.getByRole('group', { name: 'Gallery Filters', exact: true });
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await reachable(page.getByLabel('Filter By Model', { exact: true }));
    await panel.getByRole('button', { name: 'Clear Filters', exact: true }).scrollIntoViewIfNeeded();
    await reachable(panel.getByRole('button', { name: 'Clear Filters', exact: true }));
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
  await page.locator('.phone-create-open').click();
  await reachable(page.locator('.phone-create').getByRole('textbox', { name: 'Prompt', exact: true }));
  await page.locator('.phone-create .ref-add').click();
  await reachable(page.locator('.reference-popover').getByRole('searchbox', { name: 'Search Reference Images', exact: true }));
  await page.locator('.reference-popover').getByRole('button', { name: 'Close', exact: true }).click();
  await reachable(page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }));
});

test('horizontal dock and Generate keep separate lanes without changing dock orientation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop deck lanes.');
  await page.goto('/');
  for (const width of [1041, 1200, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.locator('.studio-dock').evaluate((dock) => {
      const prompt = document.querySelector('.zen-prompt')!.getBoundingClientRect();
      return dock.getBoundingClientRect().left - prompt.right;
    })).toBeGreaterThanOrEqual(10);
    expect(await page.locator('.studio-dock').evaluate((dock) => getComputedStyle(dock).flexDirection)).toBe('row');
    await reachable(page.locator('.zen-prompt .composer-submit-actions button').last());
  }
});

test('short desktop filters scroll above the composer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Full studio filter and composer overlap.');
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
  const clear = page.getByRole('group', { name: 'Gallery Filters', exact: true }).getByRole('button', { name: 'Clear Filters', exact: true });
  await clear.scrollIntoViewIfNeeded();
  await reachable(clear);
  const panel = await page.locator('.gallery-filter-panel').boundingBox();
  const composer = await page.locator('.zen-prompt').boundingBox();
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(composer!.y);
});
