import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=128x64:r=10', '-t', '2', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);

for (const kind of ['image', 'video']) {
  test(`${kind} backdrop closes the viewer while media and controls remain interactive`, async ({ page, isMobile }) => {
    const item = { id: `backdrop-${kind}`, url: kind === 'image' ? picture : '/backdrop-video.mp4', filename: `backdrop.${kind === 'image' ? 'png' : 'mp4'}`, type: kind, status: 'done', prompt: 'Backdrop click test', createdAt: '2026-01-01T00:00:00Z', width: kind === 'video' ? 1024 : 512, height: 512 };
    await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.route('**/backdrop-video.mp4*', (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
    await page.goto('/');
    if (kind === 'video') await page.locator(isMobile ? '.phone-mode-select' : '.gallery-generation-mode').getByRole('button', { name: /^Videos?$/ }).click();
    await page.locator('[data-tile-id]').first().locator('.tile').click();
    const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
    const canvas = viewer.locator('.viewer-canvas');
    const media = canvas.locator(kind === 'image' ? 'img.generation-result' : 'video');
    await expect(media).toBeVisible();
    await expect.poll(() => media.evaluate((element: HTMLImageElement | HTMLVideoElement) => element instanceof HTMLImageElement ? element.naturalWidth : element.videoWidth)).toBeGreaterThan(0);
    if (kind === 'video') {
      const play = canvas.getByRole('button', { name: /^(Play|Pause)$/ }).first();
      await expect(play).toBeVisible();
      await play.click();
      await expect(viewer).toBeVisible();
    }
    const mediaBox = await media.boundingBox();
    if (isMobile) await page.touchscreen.tap(mediaBox!.x + mediaBox!.width / 2, mediaBox!.y + mediaBox!.height / 2);
    else await page.mouse.click(mediaBox!.x + mediaBox!.width / 2, mediaBox!.y + mediaBox!.height / 2);
    await expect(viewer).toBeVisible();
    // Desktop image clicks toggle zoom; restore fit so the backdrop is exposed.
    if (kind === 'image' && !isMobile) {
      await page.mouse.click(mediaBox!.x + mediaBox!.width / 2, mediaBox!.y + mediaBox!.height / 2);
      await expect(canvas).not.toHaveClass(/is-zoomed/);
    }
    const blank = await canvas.evaluate((element, kind) => {
      const surface = kind === 'video' ? element.querySelector('[data-video-viewer]')! : element;
      const bounds = surface.getBoundingClientRect();
      const media = surface.querySelector('img, video') as HTMLImageElement | HTMLVideoElement;
      const elementBox = media.getBoundingClientRect();
      const naturalWidth = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
      const naturalHeight = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
      const scale = Math.min(elementBox.width / naturalWidth, elementBox.height / naturalHeight);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      const box = { left: elementBox.left + (elementBox.width - width) / 2, top: elementBox.top + (elementBox.height - height) / 2 };
      if (box.left - bounds.left > 1) return { x: (bounds.left + box.left) / 2, y: bounds.top + bounds.height / 2 };
      if (box.top - bounds.top > 1) return { x: bounds.left + bounds.width / 2, y: (bounds.top + box.top) / 2 };
      // A square player can fill its host to within a couple of pixels; use
      // the canvas padding instead of silently choosing a point on the video.
      const canvas = element.getBoundingClientRect();
      return { x: canvas.left + 2, y: canvas.top + canvas.height / 2 };
    }, kind);
    if (isMobile) await page.touchscreen.tap(blank.x, blank.y);
    else await page.mouse.click(blank.x, blank.y);
    await expect(viewer).toHaveCount(0);
  });
}
