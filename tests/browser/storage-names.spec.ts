import { expect, test } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const items = Array.from({ length: 6 }, (_, index) => ({ id: `kept-${index}`, url: picture, filename: `kept-${index}.png`, type: 'image', status: 'done', prompt: `Kept ${index}`, createdAt: new Date(Date.now() - index * 6 * 3600_000).toISOString(), width: 512, height: 512 }));

test('preferences and drafts saved under HEISS UI names carry over to Studio names', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('heiss-ui-prefs', JSON.stringify({ dateHeaders: true }));
    localStorage.setItem('heiss-ui-draft', JSON.stringify({ prompt: 'a prompt from before the rename' }));
  });
  await page.goto('/');
  // The old preference applies: date headers were switched on under the old key.
  await expect(page.locator('.virtual-gallery-moment').first()).toBeVisible();
  // The draft moved too, so the prompt is still there (the phone shows it in its prompt bar).
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studio-draft') || '{}').prompt)).toBe('a prompt from before the rename');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('studio-prefs');
  expect(keys).toContain('studio-draft');
  expect(keys).not.toContain('heiss-ui-prefs');
  expect(keys).not.toContain('heiss-ui-draft');
  // And it stays after a reload, from the new key alone.
  await page.reload();
  await expect(page.locator('.virtual-gallery-moment').first()).toBeVisible();
});
