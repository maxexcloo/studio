import { expect, test, type Page } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = Array.from({ length: 80 }, (_, index) => ({ id: `image-${index}`, url: `${picture}#${index}`, filename: `image-${index}.png`, type: 'image', status: 'done', prompt: `Photo ${index}`, model: 'flux1-schnell.safetensors', createdAt: new Date(Date.now() - index * 60000).toISOString(), width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '0' } }));
const videos = images.map((item, index) => ({ ...item, id: `video-${index}`, type: 'video' }));

function controls(page: Page, phone: boolean) {
  return { mode: page.locator(phone ? '.phone-generation-mode' : '.gallery-generation-mode'), scroller: page.locator(phone ? '.phone-gallery' : '.stage-gallery') };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? videos : images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('photo and video keep their own scroll positions through repeated switches', async ({ page, isMobile }) => {
  await page.goto('/');
  const { mode, scroller } = controls(page, isMobile);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  expect(await mode.evaluate((element) => Boolean(element.closest('main')))).toBe(true);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1700 })); element.scrollTo({ top: 1700, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1600);
  const photoTop = await scroller.evaluate((element) => element.scrollTop);
  await mode.getByText('Video', { exact: true }).click();
  await expect(page.locator('[data-tile-id^="video-"]').first()).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 900 })); element.scrollTo({ top: 900, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(800);
  const videoTop = await scroller.evaluate((element) => element.scrollTop);
  for (let index = 0; index < 3; index++) {
    await mode.getByText('Photo', { exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(photoTop, 0);
    await mode.getByText('Video', { exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(videoTop, 0);
  }
});

test('swipes move through previews and generation settings stay visible', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-tile-id]').first().click();
  const canvas = page.locator('.viewer-canvas');
  await expect(canvas).toBeVisible();
  for (const delta of [-200, 200, -200, 200]) {
    const before = await canvas.locator('img').getAttribute('src');
    await canvas.evaluate((element, delta) => {
      const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const touch = (clientX: number) => new Touch({ identifier: 1, target: element, clientX, clientY: y });
      element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(x)], changedTouches: [touch(x)] }));
      element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch(x + delta)], changedTouches: [touch(x + delta)] }));
      element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(x + delta)] }));
    }, delta);
    await expect(canvas.locator('img')).not.toHaveAttribute('src', before!);
    await expect.poll(() => canvas.evaluate((element) => element.style.getPropertyValue('--pan-x'))).toBe('0px');
  }
  if (isMobile) await page.getByRole('button', { name: 'Details', exact: true }).click();
  else await page.keyboard.press('i');
  await expect(page.getByRole('heading', { name: 'Generation Settings', exact: true })).toBeVisible();
  await expect(page.locator('details').filter({ hasText: 'Generation Settings' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function openComposer(page: Page, phone: boolean) {
  if (phone) await page.locator('.phone-create-open').click();
}

test('generation completion stays in its mode and unsupported negatives remain saved', async ({ page, isMobile }) => {
  // A software GPU uses the lightweight preview without requiring reduced motion.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: any, ...args: any[]) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return (getContext as any).call(this, type, ...args);
    } as any;
  });
  const effectRequests: string[] = [];
  page.on('request', (request) => { if (/\/assets\/generation-fx-/.test(request.url())) effectRequests.push(request.url()); });
  await page.route('**/api/models', async (route) => {
    const response = await route.fetch();
    const models = await response.json();
    for (const profile of models.profiles) profile.capabilities.negativePrompt = false;
    await route.fulfill({ json: models });
  });
  let body: Record<string, any> = {}, done = false;
  await page.route('**/api/generate', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { jobId: 'browser-job', items: [] } });
  });
  await page.route('**/api/jobs/browser-job', (route) => route.fulfill({ json: { status: done ? 'done' : 'running', progress: { value: 1, max: 4 }, outputs: done ? [{ ...images[0], type: body.kind, id: 'completed-browser-job' }] : [] } }));
  await page.goto('/');
  const { mode, scroller } = controls(page, isMobile);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  for (const kind of ['image', 'video']) {
    await mode.getByText(kind === 'image' ? 'Photo' : 'Video', { exact: true }).click();
    await openComposer(page, isMobile);
    await page.getByRole('textbox', { name: 'Negative prompt', exact: true }).fill(`Saved ${kind} negative`);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A verification generation');
    await scroller.evaluate((element) => element.scrollTo({ top: 1200, behavior: 'instant' }));
    done = false;
    const posted = page.waitForResponse('**/api/generate');
    if (isMobile) await page.locator('.phone-create').getByRole('button', { name: kind === 'video' ? 'Generate Video' : 'Generate', exact: true }).click();
    else await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await posted;
    expect(body).not.toHaveProperty('negative');
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await mode.getByText(kind === 'image' ? 'Video' : 'Photo', { exact: true }).click();
    const completion = page.waitForResponse('**/api/jobs/browser-job');
    done = true;
    await completion;
    await expect(page.locator('[data-tile-id="completed-browser-job"]')).toHaveCount(0);
  }
  await mode.getByText('Photo', { exact: true }).click();
  await openComposer(page, isMobile);
  await expect(page.getByRole('textbox', { name: 'Negative prompt', exact: true })).toHaveValue('Saved image negative');
  expect(effectRequests).toEqual([]);
});

test('reference failures can retry and searching reaches beyond loaded pages', async ({ page, isMobile }) => {
  const assets = Array.from({ length: 1000 }, (_, index) => ({ id: `asset-${index}`, source: 'upload', name: `Reference ${index}`, thumbnailUrl: picture, mime: 'image/png', width: 512, height: 512, size: 1, createdAt: '', privacyDomain: 'gallery' }));
  let fail = true, failNextPage = true;
  await page.route('**/api/reference-assets?*', async (route) => {
    if (fail) { await route.fulfill({ status: 500, json: { error: 'Temporary failure' } }); return; }
    const query = new URL(route.request().url()).searchParams;
    const filtered = query.get('q') ? assets.filter((asset) => asset.name.includes(query.get('q')!)) : assets;
    const cursor = Number(query.get('cursor') || 0);
    if (cursor && failNextPage) { failNextPage = false; await route.fulfill({ status: 500, json: { error: 'Next page unavailable' } }); return; }
    const next = cursor + 60;
    await route.fulfill({ json: { items: filtered.slice(cursor, next), nextCursor: next < filtered.length ? String(next) : '', hasMore: next < filtered.length } });
  });
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  await openComposer(page, isMobile);
  await page.getByRole('button', { name: 'Add start image', exact: true }).click();
  await expect(page.getByText('Images unavailable')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-reference-index]').first()).toBeVisible();
  const body = page.locator('.reference-popover-body');
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('alert')).toContainText('Next page unavailable');
  await expect(page.locator('[data-reference-index="59"]')).toBeVisible();
  const initialHeight = await page.locator('[data-reference-grid]').evaluate((element) => element.clientHeight);
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-reference-grid]').evaluate((element) => element.clientHeight)).toBeGreaterThan(initialHeight);
  for (let index = 0; index < 4; index++) {
    const height = await page.locator('[data-reference-grid]').evaluate((element) => element.clientHeight);
    const response = page.waitForResponse('**/api/reference-assets?*');
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await response;
    await expect.poll(() => page.locator('[data-reference-grid]').evaluate((element) => element.clientHeight)).toBeGreaterThan(height);
  }
  expect(await page.locator('[data-reference-index]').count()).toBeLessThan(80);
  await body.evaluate((element) => { element.scrollTop = 900; });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(900);
  await page.keyboard.press('Escape');
  await expect(page.locator('.reference-popover')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add start image', exact: true }).click();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(900);
  await page.getByRole('tab', { name: 'Uploads', exact: true }).click();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('tab', { name: 'Generations', exact: true }).click();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(900);
  await body.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.locator('[data-reference-index="0"]')).toBeVisible();
  await page.locator('[data-reference-index="0"]').focus();
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.referenceIndex);
  expect(Number(focused)).toBeGreaterThan(20);
  await page.keyboard.press('End');
  await expect(page.locator('[data-reference-index="359"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-reference-index="0"]')).toBeFocused();
  expect(await page.locator('[data-reference-index][tabindex="0"]').count()).toBe(1);
  await page.getByRole('searchbox', { name: 'Search Reference Images' }).fill('Reference 999');
  await expect(page.getByRole('button', { name: 'Reference 999', exact: true })).toBeVisible();
  await expect(page.locator('[data-reference-index]')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search Reference Images' }).fill('No Such Reference');
  await expect(page.getByText('No Matching Images')).toBeVisible();
  await page.getByRole('button', { name: 'Clear Reference Search' }).click();
  await expect(page.locator('[data-reference-index]').first()).toBeVisible();
  await expect(page.locator('[data-reference-index][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add start image', exact: true })).toBeFocused();
});

test('secondary panels load only when opened and connections identify each generation mode', async ({ page, isMobile }) => {
  const loaded: string[] = [];
  page.on('request', (request) => loaded.push(request.url()));
  await page.route('**/api/comfy/status', (route) => route.fulfill({ json: { connected: true, backends: { primary: { connected: true, device: 'Image GPU', url: 'http://images:8188' }, video: { connected: false, device: '', url: 'http://video:8188' } } } }));
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  expect(loaded.some((url) => /\/(SettingsDialog|WorkflowGallery|InpaintStudio)-/.test(url))).toBe(false);
  const { mode } = controls(page, isMobile);
  await mode.getByText('Video', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Video (offline|is offline)/ })).toBeVisible();
  await mode.getByText('Photo', { exact: true }).click();
  if (isMobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: /Use the full studio/ }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  } else await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.set-nav')).toBeVisible();
  expect(loaded.some((url) => /\/SettingsDialog-/.test(url))).toBe(true);
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Generation Connections' })).toBeVisible();
  await expect(page.locator('.set-row').filter({ hasText: 'Image GPU' })).toBeVisible();
  await expect(page.locator('.set-row').filter({ hasText: 'Video' }).filter({ hasText: 'Offline' })).toBeVisible();
});

test('model speed and reference filters combine and All clears them', async ({ page, isMobile }) => {
  await page.route('**/api/models', async (route) => {
    const result = await (await route.fetch()).json();
    const base = result.profiles.find((profile: any) => profile.kind === 'image');
    result.profiles = [
      { name: 'Standard Generate', steps: 25, edit: false },
      { name: 'Flash Generate', steps: 4, edit: false },
      { name: 'Standard Edit', steps: 25, edit: true },
      { name: 'Flash Edit', steps: 4, edit: true },
    ].map((recipe, index) => ({ ...base, id: `filter-${index}`, label: recipe.name, displayName: recipe.name, variant: undefined, variantLabel: undefined, defaults: { ...base.defaults, steps: recipe.steps }, capabilities: { ...base.capabilities, startImage: recipe.edit, startImageRequired: recipe.edit }, mediaInputs: recipe.edit ? [{ id: 'reference', kind: 'image', required: true }] : [] }));
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await openComposer(page, isMobile);
  if (isMobile) await page.locator('.phone-create .phone-row').filter({ hasText: 'Standard Generate' }).click();
  else await page.locator('.model-trigger').first().click();
  const menu = page.locator(isMobile ? '.phone-sheet[aria-label="Model"]' : '.model-menu');
  const rows = menu.locator(isMobile ? '.phone-model-option' : '.model-option');
  const filters = menu.getByRole('group', { name: 'Filter Models' });
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Flash Edit');
  await expect(rows.last()).toContainText('Standard Generate');
  await filters.getByRole('button', { name: 'Flash', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await filters.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Flash Edit');
  await filters.getByRole('button', { name: 'Standard', exact: true }).click();
  await expect(rows.first()).toContainText('Standard Edit');
  await filters.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(rows.first()).toContainText('Standard Generate');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await filters.getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(menu.getByText('No Models Match These Filters.')).toBeVisible();
});
