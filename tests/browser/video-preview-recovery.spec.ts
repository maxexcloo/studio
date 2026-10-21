import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';
import sharp from 'sharp';

const poster = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#527b8f' } }).jpeg().toBuffer();

test('imported video previews use media URLs and recover after exhausting retries', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem('studio-grid-autoplay', 'on'));
  const item = { id: 'civitai:42', url: '/api/presets/42/media', thumbnailUrl: '/api/presets/42/thumbnail', filename: 'clip.mp4', type: 'video', status: 'done', prompt: 'A blue frame', createdAt: new Date().toISOString(), width: 64, height: 64 };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  let online = false;
  const attempts = new Set<number>();
  await page.route('**/api/presets/42/video-preview*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('poster') === '1') {
      attempts.add(Number(url.searchParams.get('try') || 0));
      if (online) return route.fulfill({ body: poster, contentType: 'image/jpeg' });
    }
    await route.fulfill({ status: 503, body: 'Offline' });
  });
  await page.goto('/');
  await studioUi(page).switchMode('video');
  const tile = page.locator('[data-tile-id="civitai:42"]');
  await expect(tile).toBeVisible();
  await expect.poll(() => attempts.has(0)).toBe(true);
  for (const [index, delay] of [3100, 10100, 30100].entries()) {
    await page.clock.fastForward(delay);
    await expect.poll(() => attempts.has(index + 1)).toBe(true);
  }
  // Poster and video errors arrive independently; wait for the poster itself to stop.
  await expect(tile.locator('.video-preview-poster')).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(tile.locator('.video-preview-poster')).toHaveCount(0);
  online = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(tile.locator('.video-preview-poster')).toBeVisible();
  await expect.poll(() => tile.locator('.video-preview-poster').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 64)).toBe(true);
});
