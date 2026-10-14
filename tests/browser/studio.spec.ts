import { expect, test, type Page } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = Array.from({ length: 80 }, (_, index) => ({ id: `image-${index}`, url: `${picture}#${index}`, filename: `image-${index}.png`, type: 'image', status: 'done', prompt: `Image ${index}`, model: 'flux1-schnell.safetensors', createdAt: new Date(Date.now() - index * 60000).toISOString(), width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '0' } }));
const videos = images.map((item, index) => ({ ...item, id: `video-${index}`, type: 'video' }));

function controls(page: Page, phone: boolean) {
  return { mode: page.locator(phone ? '.phone-generation-mode' : '.gallery-generation-mode'), scroller: page.locator(phone ? '.phone-gallery' : '.stage-gallery') };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? videos : images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('image and video keep their own scroll positions through repeated switches', async ({ page, isMobile }) => {
  await page.goto('/');
  const { mode, scroller } = controls(page, isMobile);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  expect(await mode.evaluate((element) => Boolean(element.closest('main')))).toBe(true);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1700 })); element.scrollTo({ top: 1700, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1600);
  const imageTop = await scroller.evaluate((element) => element.scrollTop);
  await mode.getByText('Video', { exact: true }).click();
  await expect(page.locator('[data-tile-id^="video-"]').first()).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 900 })); element.scrollTo({ top: 900, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(800);
  const videoTop = await scroller.evaluate((element) => element.scrollTop);
  for (let index = 0; index < 3; index++) {
    await mode.getByText('Image', { exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(imageTop, 0);
    await mode.getByText('Video', { exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(videoTop, 0);
  }
});

test('swipes move through previews and generation settings stay visible', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-tile-id]').first().click();
  const summary = page.locator('.viewer-profile-summary');
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
  await summary.locator('strong').dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString().length || 0)).toBeGreaterThan(0);
  const canvas = page.locator('.viewer-canvas');
  await expect(canvas).toBeVisible();
  if (isMobile) {
    await summary.locator('strong').evaluate((element) => { element.textContent = 'An exceptionally long model and workflow name that must stay between the viewer controls'; });
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const header = await summary.boundingBox();
      const info = await page.getByRole('button', { name: 'Details', exact: true }).boundingBox();
      const close = await page.getByRole('button', { name: 'Close Viewer', exact: true }).boundingBox();
      const media = await canvas.boundingBox();
      expect(header!.x).toBeGreaterThanOrEqual(info!.x + info!.width);
      expect(header!.x + header!.width).toBeLessThanOrEqual(close!.x);
      expect(header!.y + header!.height).toBeLessThanOrEqual(media!.y);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
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
  else if (!await page.getByRole('heading', { name: 'Generation Settings', exact: true }).isVisible()) await page.keyboard.press('i');
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
    await mode.getByText(kind === 'image' ? 'Image' : 'Video', { exact: true }).click();
    await openComposer(page, isMobile);
    await page.getByRole('textbox', { name: 'Negative Prompt', exact: true }).fill(`Saved ${kind} negative`);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A verification generation');
    await scroller.evaluate((element) => element.scrollTo({ top: 1200, behavior: 'instant' }));
    done = false;
    const posted = page.waitForResponse('**/api/generate');
    if (isMobile) await page.locator('.phone-create').getByRole('button', { name: kind === 'video' ? 'Generate Video' : 'Generate', exact: true }).click();
    else await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await posted;
    expect(body).not.toHaveProperty('negative');
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await mode.getByText(kind === 'image' ? 'Video' : 'Image', { exact: true }).click();
    const completion = page.waitForResponse('**/api/jobs/browser-job');
    done = true;
    await completion;
    await expect(page.locator('[data-tile-id="completed-browser-job"]')).toHaveCount(0);
  }
  await mode.getByText('Image', { exact: true }).click();
  await openComposer(page, isMobile);
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue('Saved image negative');
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
  await page.getByRole('button', { name: 'Add Start Image', exact: true }).click();
  await expect(page.getByText('Images Unavailable')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
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
  await page.getByRole('button', { name: 'Add Start Image', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Add Start Image', exact: true })).toBeFocused();
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
  await mode.getByText('Image', { exact: true }).click();
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
  await page.locator('.settings-modal').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Workflow Gallery', exact: true }).click();
  const workflows = page.locator('.workflow-gallery');
  await expect(workflows).toBeVisible();
  await workflows.locator('.wf-card').filter({ hasText: 'In Use' }).dblclick();
  await expect(workflows).toBeVisible();
  if (!isMobile) expect((await workflows.boundingBox())!.height).toBeGreaterThan(650);

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
    result.profiles.push(...[false, true].map((reference, index) => ({ ...base, id: `video-filter-${index}`, kind: 'video', family: 'minimax_h3', label: `MiniMax H3 · ${reference ? 'Reference' : 'Non-Reference'}`, displayName: '', capabilities: { ...base.capabilities, startImage: true, startImageRequired: reference }, mediaInputs: [{ id: 'reference', kind: 'image', required: reference }] })));
    result.defaults = { ...result.defaults, imageModel: 'filter-0', videoModel: 'video-filter-0' };
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await openComposer(page, isMobile);
  const composerMode = page.locator('.composer-mode-select');
  await composerMode.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(controls(page, isMobile).mode.getByText('Video', { exact: true })).toHaveAttribute(isMobile ? 'aria-checked' : 'aria-pressed', 'true');
  await composerMode.getByRole('button', { name: 'Image', exact: true }).click();
  if (isMobile) await page.locator('.phone-create .phone-row').filter({ hasText: 'Standard Generate' }).click();
  else await page.locator('.model-trigger').first().click();
  const menu = page.locator(isMobile ? '.phone-sheet[aria-label="Model"]' : '.model-menu');
  const rows = menu.locator(isMobile ? '.phone-model-option' : '.model-option');
  const filters = menu.getByRole('group', { name: 'Filter Models' });
  const expectSingleRow = async () => {
    if (isMobile) return;
    const layout = await filters.evaluate((element) => ({
      tops: [...element.querySelectorAll('button')].map((button) => Math.round(button.getBoundingClientRect().top)),
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(new Set(layout.tops).size).toBe(1);
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.width);
  };
  await expect(rows).toHaveCount(4);
  await expectSingleRow();
  await expect(rows.first()).toContainText('Flash Edit');
  await expect(rows.last()).toContainText('Standard Generate');
  await filters.getByRole('button', { name: 'Fast', exact: true }).focus();
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
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  if (isMobile) {
    await menu.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.phone-create')).toHaveCount(0);
  } else await page.locator('.model-trigger').first().click();
  await controls(page, isMobile).mode.getByText('Video', { exact: true }).click();
  await openComposer(page, isMobile);
  if (isMobile) await page.locator('.phone-create .phone-row').filter({ hasText: 'MiniMax H3' }).click();
  else await page.locator('.model-trigger').first().click();
  await expect(rows).toHaveCount(2);
  await expect(filters.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);
  await expectSingleRow();
  await filters.getByRole('button', { name: 'Non-Reference', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Generate');
  await filters.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Animate Image');
});

test('model picker keeps shortcuts in the normal list and supports keyboard selection', async ({ page, isMobile }) => {
  await page.route('**/api/models', async (route) => {
    const result = await (await route.fetch()).json();
    const base = result.profiles.find((profile: any) => profile.kind === 'image');
    result.profiles = Array.from({ length: 28 }, (_, index) => ({ ...base, id: `picker-${isMobile ? 'phone' : 'desktop'}-${index}`, displayName: `Model ${String(index + 1).padStart(2, '0')} · Generate`, label: `Model ${index + 1}`, family: index < 14 ? 'flux' : 'sdxl', variant: index === 27 ? 'raw' : base.variant }));
    result.defaults = { ...result.defaults, imageModel: `picker-${isMobile ? 'phone' : 'desktop'}-0` };
    await route.fulfill({ json: result });
  });
  if (!isMobile) await page.setViewportSize({ width: 900, height: 650 });
  await page.goto('/');
  await openComposer(page, isMobile);
  const open = async () => {
    if (isMobile) await page.locator('.phone-create .phone-row').filter({ hasText: /Model \d/ }).click();
    else await page.locator('.model-trigger').first().click();
  };
  await open();
  const menu = page.locator(isMobile ? '.phone-sheet[aria-label="Model"]' : '.model-menu');
  const rows = menu.locator(isMobile ? '.phone-model-option' : '.model-option');
  await expect(rows).toHaveCount(28);
  await rows.filter({ hasText: 'Model 02' }).click();
  await open();
  await expect(rows).toHaveCount(29);
  await expect(rows.filter({ hasText: 'Model 02' })).toHaveCount(2);
  const shortcut = rows.filter({ hasText: 'Model 02' }).first();
  await shortcut.locator('..').getByRole('button', { name: /Add .*favorites/ }).click();
  await expect(rows.filter({ hasText: 'Model 02' })).toHaveCount(2);
  await expect(menu.locator(isMobile ? '.phone-section' : '.model-menu-label').filter({ hasText: 'Favourites' })).toBeVisible();
  const search = menu.getByRole(isMobile ? 'textbox' : 'combobox', { name: 'Search Models', exact: true });
  await expect(search).toBeVisible();
  if (isMobile) {
    await menu.locator('.phone-sheet-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(search).toBeInViewport();
    await expect(menu.getByRole('button', { name: 'Fast', exact: true })).toBeInViewport();
  } else {
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(15);
    expect(bounds!.y).toBeGreaterThanOrEqual(7);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(885);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(643);
  }
  await search.fill('Model 28');
  await expect(rows).toHaveCount(1);
  const favourite = rows.first().locator('..').getByRole('button', { name: /Add .*favorites/ });
  await favourite.focus();
  await favourite.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: /Remove .*favorites/ }).last()).toHaveAttribute('aria-pressed', 'true');
  if (isMobile) await rows.first().click();
  else await search.press('Enter');
  await expect(menu).toHaveCount(0);
  await open();
  await menu.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows).toHaveCount(30);
  await expect(rows.filter({ hasText: 'Model 28' })).toHaveCount(2);
  await menu.getByRole('button', { name: 'Standard', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(menu.getByText('No Models Match These Filters.')).toHaveCount(0);
  if (!isMobile) {
    await expect(rows.filter({ hasText: 'Model 28' }).first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.model-trigger').first()).toBeFocused();
  }
});


test('composer actions share a row and Clear clears both prompt fields', async ({ page, isMobile }) => {
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [{ id: 'toolbar-reference', source: 'upload', name: 'Test Reference', thumbnailUrl: picture, url: picture, mime: 'image/png', width: 512, height: 512, size: 1, createdAt: '', privacyDomain: 'gallery' }], hasMore: false, nextCursor: '' } }));
  await page.route('**/api/prompts', (route) => route.fulfill({ json: { prompts: [{ text: 'Recent prompt', at: new Date().toISOString(), uses: 1 }], enabled: true } }));
  await page.goto('/');
  await openComposer(page, isMobile);
  const tools = page.locator('.composer-prompt-tools');
  await expect(tools.getByRole('button', { name: 'Recent Prompts' })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Add Start Image', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.move(0, 0);
  const layout = await tools.evaluate((element) => [...element.querySelectorAll('button')].map((button) => ({ top: Math.round(button.getBoundingClientRect().top), height: button.getBoundingClientRect().height, background: getComputedStyle(button).backgroundColor })));
  expect(new Set(layout.map((item) => item.top)).size).toBe(1);
  expect(new Set(layout.map((item) => item.height)).size).toBe(1);
  expect(new Set(layout.map((item) => item.background)).size).toBe(1);
  const promptBox = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const actionBox = await tools.boundingBox();
  const textBox = await promptBox.boundingBox();
  expect(actionBox!.y).toBeGreaterThanOrEqual(textBox!.y + textBox!.height);
  const negativeRowBox = await page.locator('.composer-secondary-row').boundingBox();
  expect(actionBox!.y).toBeGreaterThanOrEqual(negativeRowBox!.y);
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(negativeRowBox!.y + negativeRowBox!.height);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveAttribute('placeholder', 'Prompt');
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveAttribute('placeholder', 'Negative Prompt');
  const fieldBox = await page.locator('.composer-prompt-field').boundingBox();
  expect(textBox!.width).toBeCloseTo(fieldBox!.width, 0);
  const clearBox = await tools.getByRole('button', { name: 'Clear Prompt & Negative' }).boundingBox();
  expect(Math.abs(clearBox!.x + clearBox!.width - textBox!.x - textBox!.width)).toBeLessThan(16);
  const negativeBox = page.getByRole('textbox', { name: 'Negative Prompt', exact: true });
  await expect(page.locator('.composer-mode-select')).toBeVisible();
  await page.waitForTimeout(300);
  const initial = await negativeBox.boundingBox();
  for (const mode of ['Video', 'Image', 'Video', 'Image']) {
    await page.locator('.composer-mode-select').getByRole('button', { name: mode, exact: true }).click();
    await page.waitForTimeout(300);
    const next = await negativeBox.boundingBox();
    expect(next!.height).toBeCloseTo(initial!.height, 0);
    expect(next!.y).toBeCloseTo(initial!.y, 0);
  }

  await tools.getByRole('button', { name: 'Add Start Image', exact: true }).click();
  await page.getByRole('button', { name: 'Test Reference', exact: true }).click();
  await expect(tools.locator('.ref-thumb')).toBeVisible();
  const withReference = await negativeBox.boundingBox();
  expect(withReference!.y).toBeCloseTo(initial!.y, 0);

  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const negative = page.getByRole('textbox', { name: 'Negative Prompt', exact: true });
  await prompt.fill('A photo');
  await negative.fill('Blur');
  await tools.getByRole('button', { name: 'Clear Prompt & Negative' }).click();
  await expect(prompt).toHaveValue('');
  await expect(negative).toHaveValue('');
  await expect(tools.getByRole('button', { name: 'Clear Prompt & Negative' })).toBeDisabled();
});
