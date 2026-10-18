import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '2', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);

test('swiping in either direction autoplays videos even after a slow load', async ({ page, isMobile }) => {
  test.setTimeout(45000);
  const items = [0, 1].map((index) => ({ id: `autoplay-${index}`, url: `/autoplay-${index}.mp4`, filename: `clip-${index}.mp4`, type: 'video', status: 'done', prompt: 'A blue frame', createdAt: new Date(Date.now() - index * 1000).toISOString(), width: 64, height: 64 }));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/autoplay-*.mp4*', async (route) => {
    if (route.request().url().includes('autoplay-1')) await new Promise((resolve) => setTimeout(resolve, 11000));
    await route.fulfill({ body: video, contentType: 'video/mp4' });
  });
  await page.goto('/');
  await page.locator(isMobile ? '.phone-mode-select' : '.gallery-generation-mode').getByRole('button', { name: /^Videos?$/ }).click();
  await page.locator('[data-tile-id="autoplay-0"]').click();
  const canvas = page.locator('.viewer-canvas');
  const playing = () => canvas.locator('video').evaluate((element: HTMLVideoElement) => !element.paused && element.currentTime > 0);
  await expect.poll(playing).toBe(true);
  for (const delta of [-200, 200]) {
    const before = await canvas.locator('video').getAttribute('src');
    await canvas.evaluate((element, delta) => {
      const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const touch = (clientX: number) => new Touch({ identifier: 1, target: element, clientX, clientY: y });
      element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(x)], changedTouches: [touch(x)] }));
      element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch(x + delta)], changedTouches: [touch(x + delta)] }));
      element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(x + delta)] }));
    }, delta);
    await expect(canvas.locator('video')).not.toHaveAttribute('src', before!);
    await expect.poll(playing, { timeout: 18000 }).toBe(true);
  }
});
