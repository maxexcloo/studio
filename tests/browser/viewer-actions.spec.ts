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

test('the action bar is ordered by intent, with Star · Info · Close in the phone’s top right', async ({ page }) => {
  await page.goto('/');
  const { viewer, phone } = await open(page);
  if (phone) {
    const bar = viewer.getByRole('navigation', { name: 'Image Actions' });
    const order = await barOrder(bar);
    // Share where the browser can share files, Download where it can't.
    expect(order.map((name) => name === 'Share' ? 'Download' : name)).toEqual(['Copy', 'Download', '|', 'Rerun', 'Reference', 'Upscale', '|', 'Delete']);
    const star = await viewer.getByRole('button', { name: 'Star', exact: true }).boundingBox();
    const info = await viewer.getByRole('button', { name: 'Info', exact: true }).boundingBox();
    const close = await viewer.getByRole('button', { name: 'Close Viewer', exact: true }).boundingBox();
    expect(star!.x).toBeGreaterThan(150);
    expect(star!.x).toBeLessThan(info!.x);
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
    // Info sits on its own in the top right, while Details is shut; open, its footer has Rerun and the dock leaves it out.
    const toolbar = viewer.getByRole('toolbar', { name: 'Image Actions' });
    if (await page.locator('.viewer-side').count()) expect(await barOrder(toolbar)).not.toContain('Rerun');
    await studioUi(page).hideDetails();
    const order = await barOrder(toolbar);
    expect(order).toEqual(['Copy', 'Download', '|', 'Rerun', 'Reference', 'Upscale', '|', 'Star', 'Delete', '|', 'Close']);
    const info = await viewer.getByRole('button', { name: 'Info', exact: true }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(info!.y).toBeLessThan(80);
    expect(info!.x + info!.width).toBeGreaterThan(viewport.width - 80);
  }
});

test('Info opens Details, which closes with its own Close (or Info on a phone)', async ({ page }) => {
  await page.goto('/');
  const { viewer, phone } = await open(page);
  const info = viewer.getByRole('button', { name: 'Info', exact: true });
  const details = page.locator('.viewer-side');
  const closeDetails = details.getByRole('button', { name: 'Close Details', exact: true });
  await studioUi(page).hideDetails();
  await info.click();
  await expect(details).toBeVisible();
  if (phone) {
    await expect(info).toHaveAttribute('aria-pressed', 'true');
    await info.click();
    await expect(details).toHaveCount(0);
    await expect(info).toHaveAttribute('aria-pressed', 'false');
    await expect(closeDetails).toHaveCount(0);
    return;
  }
  await expect(info).toHaveCount(0);
  await closeDetails.click();
  await expect(details).toHaveCount(0);
  await expect(info).toBeVisible();
});

test('zoom is a small − % + pill, clear of the action bar, whose percentage cycles the fit', async ({ page }) => {
  await page.goto('/');
  const { viewer, phone } = await open(page);
  await studioUi(page).hideDetails();
  const zoom = viewer.getByRole('group', { name: 'Image Zoom' });
  const viewport = page.viewportSize()!;
  if (phone) {
    // Centred above the phone bar.
    await expect.poll(async () => { const b = await zoom.boundingBox(); return Math.abs(b!.x + b!.width / 2 - viewport.width / 2); }).toBeLessThan(4);
  } else {
    // Bottom right, level with the action bar, so the bar's tooltips (above it) never cover it.
    const bar = viewer.getByRole('toolbar', { name: 'Image Actions' });
    await expect.poll(async () => { const b = await zoom.boundingBox(); return viewport.width - (b!.x + b!.width); }).toBeLessThan(32);
    const [pill, dock] = [await zoom.boundingBox(), await bar.boundingBox()];
    expect(Math.abs((pill!.y + pill!.height / 2) - (dock!.y + dock!.height / 2))).toBeLessThan(2);
    expect(pill!.x).toBeGreaterThan(dock!.x + dock!.width);
  }
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

test('each prompt copies on its own; Copy Prompts, Copy Settings, and Edit loads the prompts with a new seed', async ({ page }) => {
  let body: Record<string, any> | null = null;
  await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured' } }); });
  await page.goto('/');
  const { ui, viewer } = await open(page);
  if (!await page.locator('.viewer-side').count()) await viewer.getByRole('button', { name: 'Info', exact: true }).click();
  const details = page.locator('.viewer-side');
  for (const [name, text] of [['Copy Prompt', item.prompt], ['Copy Negative Prompt', item.negative]]) {
    await details.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await page.evaluate(() => navigator.clipboard.writeText(''));
  }
  // No per-prompt Use: Edit and Rerun in the footer load Create.
  await expect(details.getByRole('button', { name: /^Use / })).toHaveCount(0);
  await details.getByRole('button', { name: 'Copy Settings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Seed: 424242');
  await details.getByRole('button', { name: 'Copy Prompts', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(item.negative);
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Image Viewer' })).toHaveCount(0);
  await ui.openComposer();
  await expect(ui.prompt).toHaveValue(item.prompt);
  await expect(ui.negativePrompt).toHaveValue(item.negative);
  await ui.generate.click();
  await expect.poll(() => body).not.toBeNull();
  // Edit keeps the settings but not the seed: Rerun is the exact one.
  expect(body!.seed).not.toBe('424242');
  expect(body!.steps).toBe(4);
});

test('Rerun is an exact rerun: same prompts and the same seed', async ({ page }) => {
  let body: Record<string, any> | null = null;
  await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured' } }); });
  await page.goto('/');
  const { ui, viewer } = await open(page);
  await viewer.getByRole('button', { name: 'Rerun', exact: true }).first().click();
  await expect(viewer).toHaveCount(0);
  await ui.openComposer();
  await expect(ui.prompt).toHaveValue(item.prompt);
  await ui.generate.click();
  await expect.poll(() => body?.seed).toBe('424242');
  expect(body!.prompt).toBe(item.prompt);
  expect(body!.steps).toBe(4);
});

test('a message over the viewer shows in the status pill at its top edge, clear of every control', async ({ page }) => {
  await page.route('**/api/gallery/favorite', (route) => route.fulfill({ status: 403, json: { ok: false, error: 'Refused for the test.' } }));
  await page.goto('/');
  const { viewer } = await open(page);
  await viewer.getByRole('button', { name: /^(Star|Unstar)$/ }).filter({ visible: true }).first().click();
  const pill = viewer.locator('.status-message');
  await expect(pill).toBeVisible();
  // One message, one place: the dock's or bar's copy steps aside while the viewer covers it.
  await expect(page.locator('.status-message')).toHaveCount(1);
  const box = (await pill.boundingBox())!;
  expect(box.y).toBeLessThan(80);
  for (const button of await viewer.locator('button:visible').all()) {
    if (await pill.locator('button').evaluateAll((own, target) => own.includes(target as HTMLElement), await button.elementHandle())) continue;
    const other = await button.boundingBox();
    if (!other) continue;
    const overlaps = box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height;
    expect(overlaps, `the pill covers ${await button.getAttribute('aria-label')}`).toBe(false);
  }
});
