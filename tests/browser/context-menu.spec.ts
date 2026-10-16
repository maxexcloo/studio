import { expect, test } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const image = { id: 'native-context-image', url: picture, filename: 'native-context.png', type: 'image', status: 'done', prompt: 'Native image actions', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512 };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [image], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('viewer images permit native context menus without zooming or closing', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.locator('[data-tile-id]').first().locator('.tile').click();
  const canvas = page.locator('.viewer-canvas');
  const media = canvas.locator('img.generation-result');
  await expect(media).toBeVisible();
  // Hit testing matters: an uncancelled event is insufficient if CSS directs
  // the browser to the canvas instead of the actual image.
  expect(await media.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  })).toBe(true);
  const zoom = await canvas.evaluate((element) => element.style.getPropertyValue('--zoom'));
  if (!isMobile) {
    await media.click({ button: 'right' });
    await expect(canvas).not.toHaveClass(/is-dragging/);
  }
  const allowed = await media.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
  expect(allowed).toBe(true);
  await expect(media).toBeVisible();
  expect(await canvas.evaluate((element) => element.style.getPropertyValue('--zoom'))).toBe(zoom);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('gallery keeps management actions and Shift-right-click permits native image actions', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phones use their existing action sheet on gallery long press.');
  await page.goto('/');
  const tile = page.locator('[data-tile-id]').first().locator('.tile');
  await tile.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Item Actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  const allowed = await tile.locator('img').evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, shiftKey: true })));
  expect(allowed).toBe(true);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await tile.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Item Actions' })).toBeVisible();
});
