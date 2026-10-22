import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

// Desktop tiles: a two-line caption (prompt, then time · profile) and one top
// row of actions in the viewer bar's order, with More taking what doesn't fit.
// Phone tiles: nothing over the picture until Tile Captions is on.
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const createdAt = '2026-01-01T14:14:00Z';
const done = { id: 'tile-done', url: picture, filename: 'tile-done.png', outputName: 'tile-done.png', type: 'image', status: 'done', prompt: 'A lighthouse at dusk', createdAt, width: 512, height: 512, settings: { profileName: 'FLUX.1 Schnell' } };
const failed = { id: 'tile-failed', filename: 'tile-failed.png', type: 'image', status: 'error', error: 'Out of memory', prompt: 'A failed harbour', createdAt, width: 512, height: 512, settings: { profileName: 'FLUX.1 Schnell' } };

async function serve(page: Page, items: unknown[]) {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
}

async function rowNames(page: Page, id: string) {
  const wrap = page.locator(`[data-tile-id="${id}"]`);
  await wrap.hover();
  const row = wrap.getByRole('group', { name: 'Item Actions' });
  await expect(row).toBeVisible();
  return { wrap, row, names: await row.locator('a, button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))) };
}

test('a desktop tile captions its prompt, then the time and profile, also on keyboard focus', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phones keep their own caption rules.');
  await serve(page, [done]);
  await page.goto('/');
  const wrap = page.locator('[data-tile-id="tile-done"]');
  const caption = wrap.locator('.tile-caption');
  await expect(caption.locator('strong')).toHaveText(/lighthouse at dusk/i);
  const time = await page.evaluate((value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), createdAt);
  await expect(caption.locator('em')).toHaveText(`${time} · FLUX.1 Schnell`);
  // Hidden until hovered where there is a hover (the test browser reports touch).
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) await expect(caption).toHaveCSS('opacity', '0');
  await wrap.locator('.tile').focus();
  await expect(caption).toHaveCSS('opacity', '1');
});

test('desktop tile actions follow the viewer bar, Retry stands in on failures, and More opens the menu when narrow', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone tiles show no actions.');
  await serve(page, [done, failed]);
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const { wrap, row, names } = await rowNames(page, 'tile-done');
    // Upscale joins the make group in the row; there is no corner button. Star has the top left corner.
    const full = ['Download', 'Recreate With the Same Seed', 'Upscale', 'Delete'];
    expect(names).not.toContain('Star');
    const tileWidth = (await wrap.boundingBox())!.width;
    const slots = Math.max(1, Math.floor((tileWidth - 24 - 48) / 40));
    if (slots >= full.length) expect(names).toEqual(full);
    else {
      // Make goes first, then keep; Delete stays, More takes the last slot.
      expect(names.slice(-2)).toEqual(['Delete', 'More Actions']);
      await row.getByRole('button', { name: 'More Actions' }).click();
      await expect(page.getByRole('menu', { name: 'Item Actions' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    // One row: every circle on one line, none overlapping, clear of the caption.
    const boxes = await row.locator('a, button').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    for (let index = 1; index < boxes.length; index += 1) {
      expect(Math.abs(boxes[index].top - boxes[0].top)).toBeLessThan(1);
      expect(boxes[index].left).toBeGreaterThanOrEqual(boxes[index - 1].right);
    }
    const failedRow = await rowNames(page, 'tile-failed');
    expect(failedRow.names).toContain('Try Again, Replacing This One');
    expect(failedRow.names).not.toContain('Recreate With the Same Seed');
  }
});

test('a showing upscale stays pressed in the desktop tile row', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone tiles show no actions.');
  await serve(page, [{ ...done, upscaleActive: true, upscale: { status: 'done', url: picture } }]);
  await page.goto('/');
  const wrap = page.locator('[data-tile-id="tile-done"]');
  await expect(wrap.locator('.tile')).toBeVisible();
  await page.mouse.move(2, 2);
  const upscale = wrap.getByRole('group', { name: 'Item Actions' }).getByRole('button', { name: /^Showing the upscale/ });
  await expect(upscale).toHaveAttribute('aria-pressed', 'true');
  await expect(upscale).toHaveCSS('opacity', '1');
  await expect(wrap.locator('.tile-overlay > .tile-upscale')).toHaveCount(0);
});

test('a set Star stays in view on a desktop tile without a hover', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone tiles show no actions.');
  await serve(page, [{ ...done, favorite: true }]);
  await page.goto('/');
  const wrap = page.locator('[data-tile-id="tile-done"]');
  await expect(wrap.locator('.tile')).toBeVisible();
  await page.mouse.move(2, 2);
  const star = wrap.getByRole('button', { name: 'Unstar' });
  await expect(star).toHaveCSS('opacity', '1');
  await expect(star).toHaveCSS('color', 'rgb(255, 154, 82)');
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) await expect(wrap.getByRole('button', { name: 'Delete' })).toHaveCSS('opacity', '0');
});

test('the favourite sits in the top left corner of a desktop tile, image and video alike', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone tiles show no actions.');
  const clip = { ...done, id: 'tile-video', type: 'video', url: '/tile-video.mp4', thumbnailUrl: picture, outputName: 'tile-video.mp4', settings: { ...done.settings, duration: 5 } };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [clip] : [done], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/tile-video.mp4*', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  const corner = async (id: string) => {
    const wrap = page.locator(`[data-tile-id="${id}"]`);
    await wrap.hover();
    const star = wrap.getByRole('button', { name: 'Star', exact: true });
    await expect(star).toBeVisible();
    const tile = (await wrap.boundingBox())!;
    const box = (await star.boundingBox())!;
    // Top left, clear of the row on the right and of the caption at the bottom.
    expect(box.x - tile.x).toBeLessThan(16);
    expect(box.y - tile.y).toBeLessThan(16);
    const row = (await wrap.getByRole('group', { name: 'Item Actions' }).locator('a, button').first().boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(row.x);
    expect(Math.abs(box.y - row.y)).toBeLessThan(1);
    return { x: box.x - tile.x, y: box.y - tile.y };
  };
  const image = await corner('tile-done');
  await studioUi(page).switchMode('video');
  const video = await corner('tile-video');
  expect(video).toEqual(image);
  // The video's caption reads the same way: time · profile · its length.
  await expect(page.locator('[data-tile-id="tile-video"] .tile-caption em')).toHaveText(/ · FLUX\.1 Schnell · 5 s$/);
});

test('phone tiles show nothing over the picture until Tile Captions is on', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone tiles only.');
  await serve(page, [{ ...done, favorite: true }]);
  await page.goto('/');
  const wrap = page.locator('[data-tile-id="tile-done"]');
  await expect(wrap.locator('.tile')).toBeVisible();
  await expect(wrap.locator('.tile-caption')).toHaveCount(0);
  await expect(wrap.locator('.tile-overlay').locator('button:visible, a:visible')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('studio-prefs', JSON.stringify({ phoneTileCaptions: true })));
  await page.reload();
  const caption = page.locator('[data-tile-id="tile-done"] .tile-caption');
  await expect(caption.locator('strong')).toHaveText(/lighthouse at dusk/i);
  await expect(caption.locator('em')).toHaveText('tile-done.png');
});
