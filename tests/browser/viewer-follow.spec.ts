import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#527b8f"/></svg>');
const items = Array.from({ length: 80 }, (_, index) => ({ id: `follow-${index}`, url: picture, filename: `follow-${index}.png`, type: 'image', status: 'done', prompt: `Follow test ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 80 - index)).toISOString(), width: 512, height: 768 }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('the gallery follows the viewer to another item and stays put otherwise', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const first = page.locator('[data-tile-id="follow-0"]');
  await expect(first).toBeVisible();
  const scrollTop = () => first.evaluate((tile) => {
    for (let node = tile.parentElement; node; node = node.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) return node.scrollTop;
    return document.scrollingElement!.scrollTop;
  });
  // Opening a tile already on screen leaves the gallery where it is.
  await ui.openViewer(first.locator('.tile'));
  expect(await scrollTop()).toBe(0);
  // Stepping back from the newest wraps to the oldest, far below: its tile comes into view behind the viewer.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-tile-id="follow-79"]')).toBeAttached();
  await ui.closeViewer();
  await expect(page.locator('[data-tile-id="follow-79"]')).toBeInViewport();
  await expect(first).not.toBeInViewport();
});
