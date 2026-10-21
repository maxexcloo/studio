import { expect, test, type Page } from '@playwright/test';

/*
 * Geometry probes for the full studio (Verification › Desktop view): while
 * typing, opening popovers, viewing, selecting, searching, filtering,
 * switching Images | Videos and resizing, the tiles on screen stay where they
 * are, nothing glides from a provisional place, and no control is cut off,
 * in normal, narrow, short and tablet windows. Each probe samples every frame,
 * so a jump that settles again before the end still fails.
 */

const svg = (width: number, height: number) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#497e7b"/></svg>`);
const shapes = [[512, 640], [640, 512], [512, 512], [448, 800], [800, 448]];
const items = Array.from({ length: 80 }, (_, index) => {
  const [width, height] = shapes[index % shapes.length];
  return { id: `steady-${index}`, url: svg(width, height), thumbnailUrl: svg(width, height), filename: `steady-${index}.png`, type: 'image', status: index === 5 ? 'error' : 'done', prompt: `Steady ${index} harbour at dawn`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 80 - index)).toISOString(), width, height };
});

const layouts = [
  { name: 'normal', width: 1440, height: 1000 },
  { name: 'narrow', width: 900, height: 1000 },
  { name: 'short', width: 1440, height: 700 },
  { name: 'tablet', width: 820, height: 1180 },
];

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.route('**/api/gallery?*', (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q') || '';
    const list = url.searchParams.get('type') === 'video' ? [] : items.filter((item) => item.prompt.includes(q));
    return route.fulfill({ json: { items: list, revision: 1, hasMore: false } });
  });
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  await scrollGallery(page, 900);
}

async function scrollGallery(page: Page, top: number) {
  await page.locator('.stage-gallery').evaluate((stage, top) => { stage.scrollTop = top; }, top);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Starts sampling, every frame, the scroll, a tile in the middle of the screen, the toolbar and the composer's bottom edge. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage-gallery')!;
    const middle = innerHeight * 0.45;
    const anchor = [...document.querySelectorAll<HTMLElement>('[data-tile-id]')].sort((a, b) => Math.abs(a.getBoundingClientRect().top - middle) - Math.abs(b.getBoundingClientRect().top - middle))[0];
    const id = anchor?.dataset.tileId;
    const frames: number[][] = [];
    const sample = () => {
      const tile = id ? document.querySelector(`[data-tile-id="${id}"]`)?.getBoundingClientRect() : undefined;
      const toolbar = document.querySelector('.gallery-toolbar')!.getBoundingClientRect();
      const composer = document.querySelector('.zen-prompt')?.getBoundingClientRect();
      frames.push([stage.scrollTop, tile?.left ?? NaN, tile?.top ?? NaN, toolbar.top, toolbar.height, composer?.bottom ?? NaN]);
      (window as any).__steadyFrame = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__steady = frames;
  });
}

/** Stops sampling and returns how far each measure strayed from its first value. */
async function strayed(page: Page) {
  return page.evaluate(() => {
    cancelAnimationFrame((window as any).__steadyFrame);
    const frames: number[][] = (window as any).__steady;
    const names = ['scroll', 'tileX', 'tileY', 'toolbarTop', 'toolbarHeight', 'composerBottom'];
    return Object.fromEntries(names.map((name, index) => [name, Math.round(Math.max(...frames.map((frame) => Math.abs(frame[index] - frames[0][index])).filter((value) => !Number.isNaN(value)), 0))]));
  });
}

const still = { scroll: 0, tileX: 0, tileY: 0, toolbarTop: 0, toolbarHeight: 0, composerBottom: 0 };

/** Every visible button in the toolbar, the composer and any open popover is wholly on screen and not clipped by its bar. */
async function nothingCutOff(page: Page) {
  const cut = await page.evaluate(() => {
    const out: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>('.gallery-toolbar button, .zen-prompt button, .studio-dock button, [data-radix-popper-content-wrapper] button, .model-menu button')) {
      const box = button.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(button).visibility === 'hidden') continue;
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) { out.push(`${button.getAttribute('aria-label') || button.textContent} off screen`); continue; }
      // Clipped by a scrolling or hidden-overflow ancestor (a bar too narrow for it).
      for (let parent = button.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const clip = parent.getBoundingClientRect();
        if (box.left < clip.left - 1 || box.right > clip.right + 1) out.push(`${button.getAttribute('aria-label') || button.textContent} clipped`);
        break;
      }
    }
    return out;
  });
  expect(cut).toEqual([]);
}

/** The nth tile wholly between the toolbar and the composer, clicked at its centre so nothing scrolls it into view first. */
async function clickTile(page: Page, nth: number) {
  const point = await page.evaluate((nth) => {
    const top = document.querySelector('.gallery-toolbar')!.getBoundingClientRect().bottom;
    const bottom = document.querySelector('.zen-prompt')?.getBoundingClientRect().top ?? innerHeight;
    const boxes = [...document.querySelectorAll('[data-tile-id] .tile')].map((tile) => tile.getBoundingClientRect()).filter((box) => box.width && box.top >= top && box.bottom <= bottom).sort((a, b) => a.top - b.top || a.left - b.left);
    const box = boxes[Math.min(nth, boxes.length - 1)];
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, nth);
  await page.mouse.click(point.x, point.y);
}

const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);

for (const layout of layouts) {
  test.describe(`${layout.name} window`, () => {
    // A narrow or short window with a mouse keeps the full studio; the tablet is a touch screen.
    test.use({ hasTouch: layout.name === 'tablet' });
    test.beforeEach(async ({ isMobile }) => { test.skip(isMobile, 'Full studio geometry.'); });

    test('typing and the composer popovers leave the gallery still', async ({ page }) => {
      await open(page, layout);
      const prompt = page.locator('.zen-prompt').getByRole('textbox', { name: 'Prompt', exact: true });
      await prompt.click();
      await settle(page);
      await watch(page);
      await prompt.pressSequentially('A quiet harbour at dawn with fishing boats, mist over the water and long reflections. '.repeat(2), { delay: 1 });
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('More');
      await settle(page, 200);
      // The composer grows upwards from a bottom edge that stays put.
      expect(await strayed(page)).toEqual(still);
      expect((await page.locator('.zen-prompt').boundingBox())!.y).toBeGreaterThanOrEqual(0);
      await nothingCutOff(page);
      for (const trigger of [
        page.locator('.zen-prompt .model-trigger'),
        page.locator('.zen-prompt').getByRole('button', { name: 'LoRAs', exact: true }),
        page.locator('.zen-prompt').getByRole('button', { name: /^(Aspect Ratio$|Size:)/ }),
        page.locator('.zen-prompt').getByRole('button', { name: /^Advanced/ }).first(),
      ]) {
        await watch(page);
        await trigger.click();
        await settle(page);
        await nothingCutOff(page);
        await page.keyboard.press('Escape');
        await settle(page, 300);
        expect(await strayed(page)).toEqual(still);
      }
    });

    test('the viewer returns to the same place and selecting leaves the tiles still', async ({ page }) => {
      await open(page, layout);
      await watch(page);
      await clickTile(page, 2);
      const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
      await expect(viewer).toBeVisible();
      await page.keyboard.press('i');
      await settle(page, 300);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
      await settle(page, 300);
      expect(await strayed(page)).toEqual(still);
      // Stepping to a neighbour already on screen doesn't scroll either.
      await watch(page);
      await clickTile(page, 1);
      await page.keyboard.press('ArrowRight');
      await settle(page, 300);
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
      await settle(page, 300);
      expect(await strayed(page)).toEqual(still);

      const management = page.getByRole('group', { name: 'Gallery Management', exact: true });
      await watch(page);
      await management.getByRole('button', { name: 'Select', exact: true }).click();
      await clickTile(page, 1);
      await management.getByRole('button', { name: 'Select All', exact: true }).click();
      await settle(page, 300);
      // Every selection action fits in the bar, none clipped (the view toggles step aside).
      await nothingCutOff(page);
      await expect(management.getByRole('button', { name: 'Delete Selected', exact: true })).toBeInViewport({ ratio: 1 });
      await management.getByRole('button', { name: 'Stop Selecting', exact: true }).click();
      await settle(page, 300);
      expect(await strayed(page)).toEqual(still);
      await expect(page.getByRole('button', { name: 'Auto-Grouping', exact: true })).toBeVisible();
    });

    test('filters and activity above the gallery leave scrolled tiles still', async ({ page }) => {
      await open(page, layout);
      await watch(page);
      await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Gallery Filters', exact: true })).toBeVisible();
      await settle(page, 300);
      await nothingCutOff(page);
      await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Gallery Filters', exact: true })).toHaveCount(0);
      await settle(page, 300);
      const filters = await strayed(page);
      // The scroll follows the room the filter row takes, so the tiles never move.
      expect({ ...filters, scroll: 0, toolbarTop: 0 }).toEqual(still);
      // An activity pill joining the top (a generation out of sight, a download) pushes the bars, not the tiles.
      await watch(page);
      await page.locator('.app-shell').evaluate((shell) => { shell.style.setProperty('--islands-h', '79px'); });
      await settle(page, 200);
      await page.locator('.app-shell').evaluate((shell) => { shell.style.setProperty('--islands-h', '0px'); });
      await settle(page, 200);
      const islands = await strayed(page);
      expect({ ...islands, scroll: 0, toolbarTop: 0 }).toEqual(still);
      expect(islands.toolbarTop).toBe(79);
    });

    test('a new list appears in place: search, Images | Videos and resizing', async ({ page }) => {
      await open(page, layout);
      // Searching, then clearing, lands the tiles where they belong in the first frame they show.
      const settledTiles = async (step: string) => {
        await watch(page);
        await settle(page, 500);
        const moved = await strayed(page);
        expect({ step, tileX: moved.tileX, tileY: moved.tileY }).toEqual({ step, tileX: 0, tileY: 0 });
      };
      await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).fill('Steady 1');
      await expect(page.locator('[data-tile-id]')).toHaveCount(11);
      await settledTiles('search');
      await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
      await expect(page.locator('[data-tile-id="steady-0"]')).toBeVisible();
      await settledTiles('clear');

      // Each mode keeps its place, back before the list first shows.
      await scrollGallery(page, 900);
      const mode = page.getByRole('group', { name: 'Gallery Mode', exact: true }).first();
      await mode.getByRole('button', { name: 'Videos', exact: true }).click();
      await expect(page.locator('[data-tile-id]')).toHaveCount(0);
      await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('.stage-gallery')!;
        const seen: number[] = [];
        (window as any).__shown = seen;
        const sample = () => { if (stage.querySelector('[data-tile-id]')) seen.push(stage.scrollTop); if (seen.length < 20) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
      });
      await mode.getByRole('button', { name: 'Images', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__shown.length)).toBeGreaterThan(5);
      expect(new Set(await page.evaluate(() => (window as any).__shown))).toEqual(new Set([900]));
      await settledTiles('mode');

      // A resize within the same columns moves the tiles with the window at once.
      await page.setViewportSize({ width: layout.width - 30, height: layout.height - 20 });
      // The grid hears of the new width a frame or two later; after that, nothing more moves.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      await settledTiles('resize');
      await nothingCutOff(page);
    });
  });
}
