import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');

test('generation completion stays compact and swipes away', async ({ page }) => {
  const images = Array.from({ length: 80 }, (_, index) => ({ id: `notice-image-${index}`, url: picture, filename: `${index}.png`, type: 'image', status: 'done', prompt: 'A calm landscape', createdAt: new Date(Date.now() - (index + 1) * 60000).toISOString(), width: 512, height: 512 }));
  const pending = { ...images[0], id: 'notice-pending', jobId: 'notice-job', status: 'pending', createdAt: new Date().toISOString(), progress: { value: 1, max: 4 } };
  let complete = false;
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [pending, ...images], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: complete ? 2 : 1, upserts: complete ? [{ ...pending, status: 'done' }] : [], removes: [] } }));
  await page.goto('/');
  await expect(page.locator('[data-tile-id="notice-pending"]')).toBeVisible();
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const scroller = ui.scroller;
  await scroller.evaluate((element) => element.scrollTo({ top: 1400, behavior: 'instant' }));
  // The full studio shows progress in its activity island; the phone shows a running badge.
  if (!phone) await expect(page.locator('.activity.is-live').filter({ hasText: 'Generating' })).toBeVisible();
  complete = true;
  // Both say it in the status pill (UI-PATTERNS › Messages).
  const notification = page.locator('.status-message').filter({ hasText: 'Image Ready' });
  await expect(notification).toBeVisible();
  await expect(notification.getByRole('button', { name: 'View', exact: true })).toBeVisible();
  await expect.poll(async () => (await notification.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(56);
  const drag = notification;
  const origin = await drag.boundingBox();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
  await page.mouse.down();
  await page.mouse.move(origin!.x + origin!.width / 2 + 110, origin!.y + origin!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(notification).toHaveCount(0);
});
