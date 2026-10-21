import { test, type Page } from '@playwright/test';

const svg = (w: number, h: number, fill: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`);
const shapes = [[512, 640], [640, 512], [512, 512], [448, 800], [800, 448]];
const items = Array.from({ length: 80 }, (_, index) => {
  const [width, height] = shapes[index % shapes.length];
  return { id: `probe-${index}`, url: svg(width, height, '#497e7b'), thumbnailUrl: svg(width, height, '#497e7b'), filename: `probe-${index}.png`, type: 'image', status: 'done', prompt: `Probe ${index} a long prompt about a misty harbour at dawn`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 80 - index)).toISOString(), width, height, profileId: 'flux-schnell' };
});

async function setup(page: Page) {
  await page.route('**/api/gallery?*', (route) => {
    const url = new URL(route.request().url());
    const list = url.searchParams.get('type') === 'video' ? [] : items.filter((item) => !url.searchParams.get('q') || item.prompt.includes(url.searchParams.get('q')!));
    return route.fulfill({ json: { items: list, revision: 1, hasMore: false } });
  });
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
}

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const stage = document.querySelector('.stage-gallery') as HTMLElement;
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-tile-id]')];
    const anchor = tiles.map((t) => [t, Math.abs(t.getBoundingClientRect().top - 300)] as const).sort((a, b) => a[1] - b[1])[0]?.[0];
    const id = anchor?.dataset.tileId;
    const frames: any[] = [];
    const sample = () => {
      const tile = id ? document.querySelector<HTMLElement>(`[data-tile-id="${id}"]`) : null;
      const box = (sel: string) => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      frames.push({ scroll: Math.round(stage?.scrollTop ?? -1), tile: tile ? Math.round(tile.getBoundingClientRect().top) : null, tileX: tile ? Math.round(tile.getBoundingClientRect().left) : null, toolbar: box('.gallery-toolbar'), composer: box('.zen-prompt'), dock: box('.studio-dock'), docScroll: document.scrollingElement!.scrollTop, docOverflowX: document.scrollingElement!.scrollWidth > innerWidth });
      (window as any).__probeRaf = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__probe = frames;
  });
}

async function stopProbe(page: Page, label: string) {
  const frames = await page.evaluate(() => { cancelAnimationFrame((window as any).__probeRaf); return (window as any).__probe; });
  const report: string[] = [];
  for (const key of ['scroll', 'tile', 'tileX', 'toolbar', 'composer', 'dock', 'docScroll', 'docOverflowX']) {
    const values = [...new Set(frames.map((f: any) => JSON.stringify(f[key])))];
    if (values.length > 1) report.push(`${key}: ${values.slice(0, 8).join(' → ')}${values.length > 8 ? ` …(${values.length})` : ''}`);
  }
  console.log(`[${label}] ${frames.length} frames${report.length ? '\n   ' + report.join('\n   ') : ' stable'}`);
}

async function clipped(page: Page, label: string) {
  const out = await page.evaluate(() => {
    const results: string[] = [];
    for (const n of document.querySelectorAll<HTMLElement>('.gallery-toolbar *, .zen-prompt *, .studio-dock *, [role=dialog] *, [data-radix-popper-content-wrapper] *, .model-menu *')) {
      if (!(n instanceof HTMLButtonElement || n instanceof HTMLInputElement || n.getAttribute('role') === 'button' || n.tagName === 'TEXTAREA')) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(n);
      if (style.visibility === 'hidden') continue;
      if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) results.push(`${n.getAttribute('aria-label') || n.textContent?.trim().slice(0, 20)} @ ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return results;
  });
  if (out.length) console.log(`[${label}] off-screen: ${out.slice(0, 10).join(' | ')}`);
}

const layouts = [
  { name: 'normal', width: 1440, height: 1000 },
  { name: 'narrow', width: 900, height: 1000 },
  { name: 'short', width: 1440, height: 700 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
];

test.describe('with a mouse', () => {
  test.use({ hasTouch: false });
  for (const layout of layouts) {
    test(`probe ${layout.name}`, async ({ page, isMobile }) => {
      test.skip(isMobile);
      test.setTimeout(120000);
      await setup(page);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.goto('/');
      await page.locator('[data-tile-id]').first().waitFor();
      await page.waitForTimeout(500);
      const L = layout.name;
      await clipped(page, `${L} initial`);
      await page.locator('.stage-gallery').evaluate((n) => { n.scrollTop = 900; });
      await page.waitForTimeout(300);

      // Typing in the prompt.
      await startProbe(page);
      const prompt = page.locator('.zen-prompt').getByRole('textbox', { name: 'Prompt', exact: true });
      await prompt.click();
      await page.waitForTimeout(400);
      await stopProbe(page, `${L} focus prompt`);
      await clipped(page, `${L} prompt focused`);
      await startProbe(page);
      await prompt.pressSequentially('A quiet harbour at dawn with fishing boats, mist over the water, warm light and long reflections. '.repeat(3), { delay: 2 });
      await page.waitForTimeout(300);
      await stopProbe(page, `${L} typing`);
      await startProbe(page);
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('More lines');
      await page.waitForTimeout(300);
      await stopProbe(page, `${L} newlines`);
      await clipped(page, `${L} after typing`);

      // Popovers.
      for (const [name, open] of [
        ['model', () => page.locator('.zen-prompt .model-trigger').click()],
        ['loras', () => page.locator('.zen-prompt').getByRole('button', { name: 'LoRAs', exact: true }).click()],
        ['size', () => page.locator('.zen-prompt .size-trigger, .zen-prompt [aria-label^="Size"]').first().click()],
        ['advanced', () => page.locator('.zen-prompt').getByRole('button', { name: /Advanced/ }).first().click()],
        ['history', () => page.locator('.zen-prompt').getByRole('button', { name: 'Recent Prompts', exact: true }).click()],
      ] as const) {
        await startProbe(page);
        try { await (open as () => Promise<void>)(); } catch (error) { console.log(`[${L}] ${name} open failed ${(error as Error).message.split('\n')[0]}`); }
        await page.waitForTimeout(400);
        await clipped(page, `${L} ${name} open`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        await stopProbe(page, `${L} popover ${name}`);
      }

      // Blur the composer.
      await startProbe(page);
      await page.locator('.stage-gallery').click({ position: { x: 5, y: 300 } });
      await page.waitForTimeout(500);
      await stopProbe(page, `${L} blur composer`);

      // Viewer open/close.
      const before = await page.locator('.stage-gallery').evaluate((n) => n.scrollTop);
      await startProbe(page);
      const visible = page.locator('[data-tile-id]').filter({ visible: true });
      await visible.nth(3).locator('.tile').click();
      await page.waitForTimeout(400);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await stopProbe(page, `${L} viewer step+close`);
      console.log(`[${L}] viewer scroll ${before} -> ${await page.locator('.stage-gallery').evaluate((n) => n.scrollTop)}`);
      await startProbe(page);
      await visible.nth(2).locator('.tile').click();
      await page.waitForTimeout(400);
      await page.keyboard.press('i');
      await page.waitForTimeout(300);
      await clipped(page, `${L} viewer details`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await stopProbe(page, `${L} viewer details+close`);

      // Selection.
      const management = page.getByRole('group', { name: 'Gallery Management' });
      await startProbe(page);
      await management.getByRole('button', { name: 'Select', exact: true }).click();
      await page.waitForTimeout(300);
      await page.locator('[data-tile-id]').filter({ visible: true }).nth(1).locator('.tile').click();
      await page.waitForTimeout(300);
      await management.getByRole('button', { name: 'Select All', exact: true }).click();
      await page.waitForTimeout(300);
      await clipped(page, `${L} selecting`);
      await management.getByRole('button', { name: 'Stop Selecting', exact: true }).click();
      await page.waitForTimeout(300);
      await stopProbe(page, `${L} selection`);

      // Search and filter.
      await startProbe(page);
      await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).pressSequentially('Probe 1', { delay: 20 });
      await page.waitForTimeout(600);
      await stopProbe(page, `${L} search`);
      await clipped(page, `${L} searching`);
      await startProbe(page);
      await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
      await page.waitForTimeout(300);
      await clipped(page, `${L} filters open`);
      await page.getByLabel('Filter By Model', { exact: true }).click().catch(() => {});
      await page.waitForTimeout(300);
      await clipped(page, `${L} model filter open`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Clear Search', exact: true }).click().catch(() => {});
      await page.waitForTimeout(500);
      await stopProbe(page, `${L} filter+clear`);

      // Images/Videos.
      await page.locator('.stage-gallery').evaluate((n) => { n.scrollTop = 600; });
      await page.waitForTimeout(300);
      await startProbe(page);
      await page.getByRole('group', { name: 'Gallery Mode' }).first().getByRole('button', { name: 'Videos', exact: true }).click();
      await page.waitForTimeout(500);
      await page.getByRole('group', { name: 'Gallery Mode' }).first().getByRole('button', { name: 'Images', exact: true }).click();
      await page.waitForTimeout(600);
      await stopProbe(page, `${L} images/videos`);
      console.log(`[${L}] after mode switch scroll ${await page.locator('.stage-gallery').evaluate((n) => n.scrollTop)}`);

      // Resize.
      await startProbe(page);
      for (const delta of [-60, -120, -200, 0]) {
        await page.setViewportSize({ width: layout.width + delta, height: layout.height + Math.round(delta / 2) });
        await page.waitForTimeout(200);
      }
      await stopProbe(page, `${L} resize`);
      await clipped(page, `${L} after resize`);
    });
  }
});
