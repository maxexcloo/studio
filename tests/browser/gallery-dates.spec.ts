import { expect, test } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const items = Array.from({ length: 12 }, (_, index) => ({ id: `date-${index}`, url: picture, filename: `date-${index}.png`, type: 'image', status: 'done', prompt: `Date ${index}`, createdAt: new Date(Date.now() - index * 6 * 3600_000).toISOString(), width: 512, height: 512 }));

test('date headers are off until chosen in Settings › Studio › Gallery', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  await expect(page.locator('[data-tile-id="date-0"]')).toBeVisible();
  await expect(page.locator('.virtual-gallery-moment')).toHaveCount(0);
  // Saved preferences from before (with the old hidden switch on) don't turn them on.
  await page.evaluate(() => localStorage.setItem('heiss-ui-prefs', JSON.stringify({ showMoments: true })));
  await page.reload();
  await expect(page.locator('[data-tile-id="date-0"]')).toBeVisible();
  await expect(page.locator('.virtual-gallery-moment')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('heiss-ui-prefs', JSON.stringify({ dateHeaders: true })));
  await page.reload();
  await expect(page.locator('.virtual-gallery-moment').first()).toBeVisible();
});
