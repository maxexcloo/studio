import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = (height: number) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${height}"><rect width="512" height="${height}" fill="#527b8f"/></svg>`);
const items = Array.from({ length: 120 }, (_, index) => {
  const height = [768, 512, 896, 640][index % 4];
  return { id: `deep-${index}`, url: picture(height), filename: `deep-${index}.png`, type: 'image', status: 'done', prompt: `Deep test ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 120 - index)).toISOString(), width: 512, height };
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('closing the viewer leaves the gallery exactly where it was, deep in the gallery', async ({ page, isMobile }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await expect(page.locator('[data-tile-id="deep-0"]')).toBeVisible();
  const scroller = ui.scroller;
  const scrollTop = () => scroller.evaluate((element) => element === document.documentElement ? document.scrollingElement!.scrollTop : element.scrollTop);
  // Deep in the gallery, at a place where a tile straddles the top edge, partly scrolled away.
  const findPartial = () => page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-tile-id]'));
    const partial = tiles.find((node) => { const box = node.getBoundingClientRect(); return box.top < 40 && box.top > -200 && box.bottom > 160; });
    const box = partial?.getBoundingClientRect();
    return { id: partial?.dataset.tileId || '', x: box ? box.left + box.width / 2 : 0, y: box ? box.bottom - 40 : 0 };
  });
  let tile = { id: '', x: 0, y: 0 };
  for (let top = 3000; top < 4200 && !tile.id; top += 53) {
    await scroller.evaluate((element, top) => { (element === document.documentElement ? document.scrollingElement! : element).scrollTo({ top, behavior: 'instant' }); }, top);
    await expect.poll(scrollTop).toBe(top);
    tile = await findPartial();
  }
  expect(tile.id).not.toBe('');
  {
    const before = await scrollTop();
    // Where a finger lands on what shows of it: a locator click would scroll it into view first.
    if (isMobile) await page.touchscreen.tap(tile.x, tile.y); else await page.mouse.click(tile.x, tile.y);
    await expect(ui.viewer).toBeVisible();
    await page.waitForTimeout(400);
    expect(await scrollTop()).toBe(before);
    await ui.closeViewer();
    // Some frames after closing, once the page lock lifts and the rows re-measure.
    await page.waitForTimeout(400);
    expect(await scrollTop()).toBe(before);
  }
});
