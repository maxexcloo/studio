import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import { studioUi } from './helpers/ui';

const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '4', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);
const clip = { id: 'pause-clip', url: '/pause-clip.mp4', filename: 'clip.mp4', type: 'video', status: 'done', prompt: 'A blue frame', createdAt: new Date().toISOString(), width: 64, height: 64 };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [clip] : [], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/pause-clip.mp4*', (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
});

/** Every video on the page is paused and its time stands still. */
async function allStill(page) {
  const sample = () => page.evaluate(() => [...document.querySelectorAll('video')].map((node) => ({ paused: node.paused, time: node.currentTime })));
  const before = await sample();
  await page.waitForTimeout(400);
  const after = await sample();
  return before.every((entry, index) => entry.paused && after[index]?.time === entry.time);
}

test('closing the video viewer stops playback for good', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await ui.switchMode('video');
  await ui.openViewer(page.locator(`[data-tile-id="${clip.id}"]`));
  const viewerVideo = page.locator('[data-video-viewer] video');
  await expect.poll(() => viewerVideo.evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime > 0)).toBe(true);
  await ui.closeViewer();
  await expect.poll(() => allStill(page)).toBe(true);
});

test('a phone sheet over a playing video pauses it, and closing the sheet resumes it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone sheets.');
  await page.goto('/');
  const ui = studioUi(page);
  await ui.switchMode('video');
  await ui.openViewer(page.locator(`[data-tile-id="${clip.id}"]`));
  const viewerVideo = page.locator('[data-video-viewer] video');
  await expect.poll(() => viewerVideo.evaluate((node: HTMLVideoElement) => !node.paused)).toBe(true);
  // Details covers the video on a phone.
  await ui.showDetails();
  await expect.poll(() => allStill(page)).toBe(true);
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect.poll(() => viewerVideo.evaluate((node: HTMLVideoElement) => !node.paused)).toBe(true);
  // A sheet over the gallery pauses what plays behind it too.
  await ui.closeViewer();
  await ui.openComposer();
  await expect.poll(() => allStill(page)).toBe(true);
});
