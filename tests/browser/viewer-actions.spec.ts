import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#527b8f"/></svg>');
const item = { id: 'viewer-actions-0', url: picture, filename: 'viewer-actions.png', type: 'image', status: 'done', prompt: 'A lighthouse at dusk', negative: 'blurry, low quality', model: 'flux1-schnell.safetensors', createdAt: new Date().toISOString(), width: 512, height: 768, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '424242', width: 512, height: 768 } };

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('heiss-ui-prefs', JSON.stringify({ smartUpscale: true })));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

async function open(page) {
  const ui = studioUi(page);
  const viewer = await ui.openViewer(page.locator(`[data-tile-id="${item.id}"]`));
  return { ui, viewer, phone: await ui.isPhone() };
}

/** The bar's buttons by name, with "|" where a divider separates intents. */
async function barOrder(bar) {
  return bar.evaluate((node) => [...node.children].flatMap((child) => {
    if (child.matches('.viewer-divider, .viewer-phone-divider')) return ['|'];
    if (child.matches('.viewer-phone-star, .viewer-phone-info')) return [];
    const button = child.matches('button, a') ? child : child.querySelector('button, a');
    return button ? [button.getAttribute('aria-label') || button.textContent?.trim() || ''] : [];
  }));
}

test('the action bar is ordered by intent, with Star and Info in the phone’s top corners', async ({ page }) => {
  await page.goto('/');
  const { viewer, phone } = await open(page);
  if (phone) {
    const bar = viewer.getByRole('navigation', { name: 'Image Actions' });
    const order = await barOrder(bar);
    // Share where the browser can share files, Download where it can't.
    expect(order.map((name) => name === 'Share' ? 'Download' : name)).toEqual(['Copy', 'Download', '|', 'Recreate', 'Reference', 'Upscale', '|', 'Delete']);
    const star = await viewer.getByRole('button', { name: 'Star', exact: true }).boundingBox();
    const info = await viewer.getByRole('button', { name: 'Info', exact: true }).boundingBox();
    const close = await viewer.getByRole('button', { name: 'Close Viewer', exact: true }).boundingBox();
    expect(star!.x).toBeLessThan(80);
    expect(star!.y).toBeLessThan(80);
    expect(info!.y).toBeLessThan(80);
    expect(info!.x).toBeGreaterThan(200);
    expect(info!.x).toBeLessThan(close!.x);
    // Every bar button fits at 320 px with a full-height target.
    await page.setViewportSize({ width: 320, height: 640 });
    for (const button of await bar.locator(':scope > button').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
  } else {
    const order = await barOrder(viewer.getByRole('toolbar', { name: 'Image Actions' }));
    expect(order).toEqual(['Copy', 'Download', '|', 'Recreate', 'Reference', 'Upscale', '|', 'Star', 'Delete', '|', 'Info', 'Close']);
  }
});

test('Info toggles Details open and shut', async ({ page }) => {
  await page.goto('/');
  const { viewer } = await open(page);
  const info = viewer.getByRole('button', { name: 'Info', exact: true });
  const details = page.locator('.viewer-side');
  if (await details.count()) { await info.click(); await expect(details).toHaveCount(0); }
  await info.click();
  await expect(details).toBeVisible();
  await expect(info).toHaveAttribute('aria-pressed', 'true');
  await info.click();
  await expect(details).toHaveCount(0);
  await expect(info).toHaveAttribute('aria-pressed', 'false');
});

test('zoom is a small − % + pill, bottom middle, whose percentage cycles the fit', async ({ page }) => {
  await page.goto('/');
  const { viewer, phone } = await open(page);
  if (await page.locator('.viewer-side').count()) await viewer.getByRole('button', { name: 'Info', exact: true }).click();
  const zoom = viewer.getByRole('group', { name: 'Image Zoom' });
  const viewport = page.viewportSize()!;
  // Centred once Details has gone and the pill has slid back.
  await expect.poll(async () => { const b = await zoom.boundingBox(); return Math.abs(b!.x + b!.width / 2 - viewport.width / 2); }).toBeLessThan(4);
  const box = await zoom.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(phone ? 44 : 34);
  expect(box!.width).toBeLessThanOrEqual(phone ? 140 : 120);
  expect(box!.y).toBeGreaterThan(viewport.height * 0.7);
  await expect(zoom.getByRole('button')).toHaveCount(3);
  const percent = zoom.getByRole('button', { name: 'Image Zoom Percentage' });
  const before = await percent.textContent();
  await percent.click();
  await expect(percent).not.toHaveText(before!);
});

test('each prompt copies and uses on its own; Reuse loads both prompts', async ({ page }) => {
  await page.goto('/');
  const { ui, viewer, phone } = await open(page);
  if (!await page.locator('.viewer-side').count()) await viewer.getByRole('button', { name: 'Info', exact: true }).click();
  const details = page.locator('.viewer-side');
  for (const [name, text] of [['Copy Prompt', item.prompt], ['Copy Negative Prompt', item.negative]]) {
    // The phone's shortcut row has its own Copy Prompt; the prompt's own is the last.
    await details.getByRole('button', { name, exact: true }).last().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await page.evaluate(() => navigator.clipboard.writeText(''));
  }
  if (phone) {
    await details.getByRole('button', { name: 'Copy Settings', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Seed: 424242');
  }
  await details.getByRole('button', { name: 'Use Negative Prompt', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await ui.openComposer();
  await expect(ui.negativePrompt).toHaveValue(item.negative);
  await ui.prompt.fill('Something else');
  await ui.closeComposer();
  // The copies' toasts sit over the top of the gallery; clear them to reach the tile.
  await expect.poll(async () => {
    const dismiss = page.locator('.toast .island-close, .toast button[aria-label="Dismiss"]').first();
    if (await dismiss.count()) await dismiss.click({ force: true }).catch(() => {});
    return page.locator('.toast').count();
  }, { timeout: 15000 }).toBe(0);
  await ui.openViewer(page.locator(`[data-tile-id="${item.id}"]`));
  if (!await page.locator('.viewer-side').count()) await page.getByRole('button', { name: 'Info', exact: true }).click();
  await page.locator('.viewer-side').getByRole('button', { name: 'Reuse', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Image Viewer' })).toHaveCount(0);
  await ui.openComposer();
  await expect(ui.prompt).toHaveValue(item.prompt);
  await expect(ui.negativePrompt).toHaveValue(item.negative);
});

test('Recreate is an exact rerun: same prompts and the same seed', async ({ page }) => {
  let body: Record<string, any> | null = null;
  await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured' } }); });
  await page.goto('/');
  const { ui, viewer } = await open(page);
  await viewer.getByRole('button', { name: 'Recreate', exact: true }).first().click();
  await expect(viewer).toHaveCount(0);
  await ui.openComposer();
  await expect(ui.prompt).toHaveValue(item.prompt);
  await ui.generate.click();
  await expect.poll(() => body?.seed).toBe('424242');
  expect(body!.prompt).toBe(item.prompt);
  expect(body!.steps).toBe(4);
});
