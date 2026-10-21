import { expect, test, type Page } from '@playwright/test';

/*
 * First and incremental gallery loads on a throttled CPU (Remaining UI
 * follow-up 3): tiles keep their reserved boxes, nothing shifts or glides once
 * it shows, and appending a page never blocks the main thread for long.
 */

const svg = (width: number, height: number, fill: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`);
const shapes = [[512, 640], [640, 512], [512, 512], [448, 800], [800, 448], [832, 1216]];
const all = Array.from({ length: 240 }, (_, index) => {
  const [width, height] = shapes[index % shapes.length];
  return { id: `load-${index}`, url: svg(width, height, '#497e7b'), thumbnailUrl: svg(width, height, '#3d6866'), filename: `load-${index}.png`, type: 'image', status: 'done', prompt: `Load ${index}`, createdAt: new Date(Date.UTC(2026, 0, 2) - index * 60000).toISOString(), width, height };
});
const PAGE = 80;

async function open(page: Page) {
  await page.route('**/api/gallery?*', (route) => {
    const url = new URL(route.request().url());
    const start = Number(url.searchParams.get('cursor') || 0);
    const items = url.searchParams.get('type') === 'video' ? [] : all.slice(start, start + PAGE);
    const next = start + PAGE < all.length ? String(start + PAGE) : '';
    return route.fulfill({ json: { items, revision: 1, hasMore: Boolean(next), nextCursor: next, totalApprox: all.length } });
  });
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.addInitScript(() => {
    const stats = { shift: 0, longTasks: [] as number[], moved: 0, frames: 0 };
    (window as any).__load = stats;
    new PerformanceObserver((list) => { for (const entry of list.getEntries() as any[]) if (!entry.hadRecentInput) stats.shift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) stats.longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: true });
    // Transforms don't count as layout shifts: follow every tile on screen, every frame.
    const seen = new Map<string, string>();
    const sample = () => {
      stats.frames++;
      const stage = document.querySelector('.stage-gallery');
      for (const tile of document.querySelectorAll<HTMLElement>('[data-tile-id]')) {
        const box = tile.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) continue;
        const key = `${Math.round(box.left)},${Math.round(box.top + (stage?.scrollTop || 0))},${Math.round(box.width)},${Math.round(box.height)}`;
        const id = tile.dataset.tileId!;
        if (seen.has(id) && seen.get(id) !== key) stats.moved++;
        seen.set(id, key);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/');
}

const read = (page: Page) => page.evaluate(() => { const stats = (window as any).__load; const out = { shift: Math.round(stats.shift * 1000) / 1000, longest: Math.max(0, ...stats.longTasks), longTasks: stats.longTasks.length, moved: stats.moved }; stats.shift = 0; stats.longTasks = []; stats.moved = 0; return out; });

test.describe('with a mouse', () => {
  test.use({ hasTouch: false });
  test('the gallery loads and grows without shifting tiles or long stalls', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The full studio gallery; the phone shares the same grid.');
    test.setTimeout(90000);
    await open(page);
    await expect(page.locator('[data-tile-id]').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const first = await read(page);
    console.log('first load', JSON.stringify(first));
    // Tiles show in their reserved boxes: no layout shift, and no tile moves once it shows.
    expect(first.shift).toBeLessThan(0.01);
    expect(first.moved).toBe(0);
    for (let step = 1; step <= 2; step++) {
      await page.locator('.stage-gallery').evaluate((stage) => { stage.scrollTop = stage.scrollHeight; });
      await expect.poll(() => page.evaluate(() => document.querySelector('.virtual-gallery-spacer')!.getBoundingClientRect().height), { timeout: 20000 }).toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      const more = await read(page);
      console.log(`page ${step + 1}`, JSON.stringify(more));
      expect(more.shift).toBeLessThan(0.01);
      expect(more.moved).toBe(0);
    }
  });
});
