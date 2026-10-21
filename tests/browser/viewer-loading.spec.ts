import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { studioUi } from './helpers/ui';

// A slow network: the thumbnail is quick (the gallery has it), the display copy and original are not.
const sizes = [[2048, 1536], [832, 1216], [4096, 4096]];
const originals = await Promise.all(sizes.map(([width, height]) => sharp({ create: { width, height, channels: 3, background: '#527b8f' } }).png().toBuffer()));
const thumbnails = await Promise.all(originals.map((png) => sharp(png).resize(768, 768, { fit: 'inside' }).webp().toBuffer()));
const displays = await Promise.all(originals.map((png) => sharp(png).resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer()));
const items = sizes.map(([width, height], index) => {
  const query = `filename=loading-${index}.png&subfolder=&type=output`;
  return { id: `loading-${index}`, type: 'image', status: 'done', url: `/comfy/view?${query}`, thumbnailUrl: `/comfy/thumb?${query}`, width, height, prompt: `Loading ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 10 - index)).toISOString() };
});
const indexOf = (url: string) => Number(/loading-(\d)/.exec(url)![1]);
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the viewer shows each picture at its final size from the first frame, sharpening without a jump', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  const asked: string[] = [];
  await page.route('**/comfy/thumb?*', async (route) => {
    const url = route.request().url();
    const display = url.includes('size=display');
    if (display) asked.push(`display ${indexOf(url)}`);
    await later(display ? 700 : 0);
    await route.fulfill({ body: (display ? displays : thumbnails)[indexOf(url)], contentType: 'image/webp' });
  });
  await page.route('**/comfy/view?*', async (route) => {
    asked.push(`original ${indexOf(route.request().url())}`);
    await later(900);
    await route.fulfill({ body: originals[indexOf(route.request().url())], contentType: 'image/png' });
  });
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  await expect(page.locator('[data-tile-id="loading-0"] img')).toBeVisible();
  // Every frame: the rectangle each visible layer of the picture draws in, and how sharp the top one is.
  await page.evaluate(() => {
    const frames: Array<{ id: string; rects: string[]; sharp: number }> = [];
    (window as unknown as { frames_: typeof frames }).frames_ = frames;
    const tick = () => {
      const canvas = document.querySelector('.viewer-canvas');
      const layers = canvas ? [...canvas.querySelectorAll<HTMLImageElement>('img')].filter((image) => image.naturalWidth && getComputedStyle(image).opacity !== '0') : [];
      const id = canvas?.getAttribute('data-generation-size') || '';
      if (layers.length) frames.push({ id, sharp: Math.max(...layers.map((image) => image.naturalWidth)), rects: layers.map((image) => {
        const box = image.getBoundingClientRect();
        const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
        return `${Math.round(image.naturalWidth * scale)}x${Math.round(image.naturalHeight * scale)}`;
      }) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const frames = () => page.evaluate(() => (window as unknown as { frames_: Array<{ id: string; rects: string[]; sharp: number }> }).frames_);
  await ui.openViewer(page.locator('[data-tile-id="loading-0"] .tile'));
  for (const [step, [width, height]] of sizes.entries()) {
    const label = `${width} × ${height}`;
    // Sharp: the display copy, or on the full studio at 1:1 past its size, the original.
    const sharpWidth = !phone && Math.max(width, height) > 2560 ? width : Math.round(width * Math.min(1, 2560 / Math.max(width, height)));
    await expect.poll(async () => (await frames()).filter((frame) => frame.id === label).at(-1)?.sharp, { timeout: 10000 }).toBe(sharpWidth);
    await page.waitForTimeout(400);
    const seen = (await frames()).filter((frame) => frame.id === label);
    // A thumbnail's rounded size may land a pixel off; a jump is far more.
    const rects = seen.flatMap((frame) => frame.rects).map((rect) => rect.split('x').map(Number));
    const spread = (axis: number) => Math.max(...rects.map((rect) => rect[axis])) - Math.min(...rects.map((rect) => rect[axis]));
    expect(Math.max(spread(0), spread(1)), `${label}: one rectangle from the first frame to the sharp picture`).toBeLessThanOrEqual(1);
    // The thumbnail filled it first.
    expect(seen[0].sharp).toBeLessThanOrEqual(768);
    if (step < sizes.length - 1) await page.keyboard.press('ArrowRight');
  }
  // The display copy, not the PNG, unless the screen needs more pixels than it holds.
  expect(asked.filter((entry) => entry.startsWith('original'))).toEqual(phone ? [] : ['original 2']);
});
