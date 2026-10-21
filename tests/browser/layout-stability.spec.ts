import { expect, test, type Locator } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#497e7b"/></svg>');
const items = Array.from({ length: 12 }, (_, index) => ({ id: `layout-${index}`, url: picture, filename: `layout-${index}.png`, type: 'image', status: 'done', prompt: 'Layout test', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 640 }));

async function reachable(locator: Locator, hasTrailingAction = false) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element, hasTrailingAction) => {
    const box = element.getBoundingClientRect();
    return [box.left + 8, box.left + box.width / 2, ...(hasTrailingAction ? [] : [box.right - 8])].every((x) => element.contains(document.elementFromPoint(x, box.top + box.height / 2)));
  }, hasTrailingAction)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.mediaInputs = [{ id: 'reference', kind: 'image', role: 'start', label: 'Start Image', required: false, min: 0, max: 1 }];
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
});

test('composer menus stay reachable and side controls are removed', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop composer layering.');
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Generation Controls' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await expect(page.locator('.zen-prompt')).toHaveClass(/is-expanded/);
  await page.locator('.zen-prompt .model-trigger').click();
  await reachable(page.locator('.model-menu .model-option').first(), true);
  await page.keyboard.press('Escape');
  // Every control stays in the bar; there is no More Settings drawer.
  await expect(page.locator('.zen-prompt').getByRole('button', { name: 'More Settings', exact: true })).toHaveCount(0);
  await page.locator('.zen-prompt').getByRole('button', { name: 'LoRAs', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'LoRAs', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-tile-id]').first().locator('.tile').click();
  const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
  await reachable(viewer.getByRole('button', { name: 'Info', exact: true }));
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
    await management.getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(management.getByRole('status')).toHaveText('12 Selected');
    const actionsBox = await toolbar.locator('.gallery-toolbar-actions').boundingBox();
    const modeBox = await toolbar.locator('.gallery-generation-mode').boundingBox();
    expect(actionsBox!.y >= modeBox!.y + modeBox!.height || actionsBox!.x >= modeBox!.x + modeBox!.width).toBe(true);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(width);
    await expect.poll(async () => (await toolbar.boundingBox())!.height).toBe(before!.height);
    expect((await toolbar.locator('.gallery-generation-mode').boundingBox())!.x).toBe(modeBefore!.x);
    expect(await page.locator('.stage-gallery').evaluate(node => ({ left: node.scrollLeft, overflow: node.scrollWidth > node.clientWidth }))).toEqual({ left: 0, overflow: false });
    await management.getByRole('button', { name: 'Stop Selecting', exact: true }).click();
    await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).fill('Layout');
    await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
    await expect.poll(() => page.getByRole('group', { name: 'Gallery Filters', exact: true }).evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    await page.getByLabel('Filter By Model', { exact: true }).scrollIntoViewIfNeeded();
    await reachable(page.getByLabel('Filter By Model', { exact: true }));
    expect(await page.locator('.stage-gallery').evaluate(n => n.scrollLeft)).toBe(0);
    await expect(page.getByRole('button', { name: 'Search Gallery', exact: true })).toBeInViewport();
    expect((await toolbar.boundingBox())!.height).toBe(before!.height);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
    await reachable(page.getByRole('button', { name: 'Auto-Grouping', exact: true }));
    await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
  }
});

test('phone filter tools stay on screen and yield to create and reference sheets', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone containment and sheets.');
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Search Gallery', exact: true })).toHaveCount(0);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Open Gallery Filters', exact: true }).click();
    const panel = page.getByRole('group', { name: 'Gallery Filters', exact: true });
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    // One line that scrolls sideways rather than wrapping.
    await expect.poll(() => panel.evaluate(n => getComputedStyle(n).flexWrap === 'nowrap' && getComputedStyle(n).overflowX === 'auto')).toBe(true);
    await page.getByLabel('Filter By Aspect Ratio', { exact: true }).scrollIntoViewIfNeeded();
    await reachable(page.getByLabel('Filter By Aspect Ratio', { exact: true }));
    await page.getByLabel('Filter By Model', { exact: true }).scrollIntoViewIfNeeded();
    await reachable(page.getByLabel('Filter By Model', { exact: true }));
    await panel.getByRole('button', { name: 'Starred', exact: true }).scrollIntoViewIfNeeded();
    await reachable(panel.getByRole('button', { name: 'Starred', exact: true }));
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open Gallery Filters', exact: true }).click();
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await reachable(ui.prompt, true);
  await composer.locator('.ref-add').click();
  await reachable(page.locator('.reference-popover').getByRole('searchbox', { name: 'Search Library', exact: true }));
  await page.locator('.reference-popover').getByRole('button', { name: 'Close References', exact: true }).click();
  await reachable(composer.getByRole('button', { name: 'Close', exact: true }));
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

// A narrow or short window with a mouse keeps the full studio; a touch screen that size is a phone.
test.describe('with a mouse', () => {
  test.use({ hasTouch: false });
  test('short desktop filter tools stay above the composer', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Full studio filter and composer overlap.');
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
    const clear = page.getByRole('button', { name: 'Filter By Model', exact: true });
    await clear.scrollIntoViewIfNeeded();
    await reachable(clear);
    const panel = await page.locator('.gallery-filter-panel').boundingBox();
    const composer = await page.locator('.zen-prompt').boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(composer!.y);
  });
});

test('the composer model menu stays within the composer, under its trigger', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone uses its own model sheet.');
  await page.goto('/');
  await page.locator('.zen-prompt').getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await page.locator('.zen-prompt .model-trigger').click();
  const menu = page.locator('.model-menu');
  await expect(menu).toBeVisible();
  // Measured once its opening scale has settled.
  await menu.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  const [box, composer, trigger] = await Promise.all([menu.boundingBox(), page.locator('.zen-prompt').boundingBox(), page.locator('.zen-prompt .model-picker').boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(composer!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(composer!.x + composer!.width + 1);
  // Right-aligned under its trigger, unless the composer is too narrow to allow it.
  if (trigger!.x + trigger!.width - box!.width >= composer!.x + 8) expect(Math.abs(box!.x + box!.width - (trigger!.x + trigger!.width))).toBeLessThan(2);
});
