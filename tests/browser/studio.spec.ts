import { expect, test, type Page } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = Array.from({ length: 80 }, (_, index) => ({ id: `image-${index}`, url: `${picture}#${index}`, filename: `image-${index}.png`, type: 'image', status: 'done', prompt: `Image ${index}`, model: 'flux1-schnell.safetensors', createdAt: new Date(Date.now() - index * 60000).toISOString(), width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '0' } }));
const videos = images.map((item, index) => ({ ...item, id: `video-${index}`, type: 'video' }));

function controls(page: Page, phone: boolean) {
  const mode = page.locator(phone ? '.phone-mode-select' : '.gallery-generation-mode');
  return {
    mode,
    scroller: page.locator(phone ? '.phone-gallery' : '.stage-gallery'),
    switchMode: async (value: 'image' | 'video') => {
      await mode.getByRole('button', { name: value === 'video' ? 'Video' : 'Image', exact: true }).click();
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? videos : images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('image and video keep their own scroll positions through repeated switches', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  const { mode, scroller, switchMode } = controls(page, isMobile);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  if (isMobile) {
    await expect(page.locator('.phone-gallery .phone-generation-mode')).toHaveCount(0);
    await expect(mode.locator('select')).toHaveCount(0);
    await expect(mode.getByRole('button')).toHaveCount(2);
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const selector = await mode.boundingBox();
      const prompt = await page.locator('.phone-create-open').boundingBox();
      const pill = await page.locator('.phone-create-pill').boundingBox();
      for (const button of await mode.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      expect(selector!.height).toBeGreaterThanOrEqual(44);
      expect(selector!.x + selector!.width).toBeLessThanOrEqual(prompt!.x);
      expect(selector!.y).toBeCloseTo(prompt!.y, 0);
      expect(selector!.y).toBeGreaterThan(viewport.height / 2);
      expect(prompt!.width).toBeGreaterThan(100);
      expect(pill!.x + pill!.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: testInfo.outputPath(`mode-picker-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await mode.getByRole('button', { name: 'Image', exact: true }).focus();
    await expect(mode.getByRole('button', { name: 'Image', exact: true })).toBeFocused();
  } else expect(await mode.evaluate((element) => Boolean(element.closest('main')))).toBe(true);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1700 })); element.scrollTo({ top: 1700, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1600);
  const imageTop = await scroller.evaluate((element) => element.scrollTop);
  await switchMode('video');
  await expect(page.locator('[data-tile-id^="video-"]').first()).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await scroller.evaluate((element) => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 900 })); element.scrollTo({ top: 900, behavior: 'instant' }); });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(800);
  const videoTop = await scroller.evaluate((element) => element.scrollTop);
  for (let index = 0; index < 3; index++) {
    await switchMode('image');
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(imageTop, 0);
    await switchMode('video');
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(videoTop, 0);
  }
});

test('swipes move through previews and generation details stay accessible', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-tile-id]').first().click();
  const summary = page.locator('.viewer-profile-summary');
  if (!isMobile) {
    await expect(summary).toBeVisible();
    expect(await summary.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
    await summary.locator('strong').dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString().length || 0)).toBeGreaterThan(0);
  }
  const canvas = page.locator('.viewer-canvas');
  await expect(canvas).toBeVisible();
  if (isMobile) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(summary).toBeHidden();
      const info = await page.getByRole('button', { name: 'Details', exact: true }).boundingBox();
      const close = await page.getByRole('button', { name: 'Close Viewer', exact: true }).boundingBox();
      expect(info!.x).toBeGreaterThan(viewport.width / 2);
      expect(close!.x - info!.x - info!.width).toBeCloseTo(8, 0);
      expect(info!.y).toBeCloseTo(close!.y, 0);
      expect(info!.height).toBeCloseTo(close!.height, 0);
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

for (const kind of ['image', 'video']) {
  test(`reference proportions reach generation in ${kind} mode`, async ({ page, isMobile }) => {
    const models = await (await page.request.get('/api/models')).json();
    for (const profile of models.profiles) if (profile.kind === 'video') profile.mediaInputs = [{ id: 'start', kind: 'image', role: 'start', label: 'Start Image', required: false, min: 0, max: 1 }];
    await page.route('**/api/models', (route) => route.fulfill({ json: models }));
    const reference = { id: `reference-${kind}`, source: 'upload', name: 'Aspect Reference', url: picture, thumbnailUrl: picture, mime: 'image/png', width: kind === 'image' ? 900 : 1600, height: kind === 'image' ? 1600 : 900, size: 1, createdAt: '', privacyDomain: 'gallery' };
    await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [reference], hasMore: false, nextCursor: '' } }));
    let body: Record<string, any> | null = null;
    await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
    await page.goto('/');
    await controls(page, isMobile).switchMode(kind as 'image' | 'video');
    await openComposer(page, isMobile);
    await page.getByRole('button', { name: 'Add Start Image', exact: true }).click();
    await page.getByRole('button', { name: 'Aspect Reference', exact: true }).click();
    await expect(page.locator('.reference-popover')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Follow the reference framing');
    const generate = isMobile ? page.locator('.phone-create').getByRole('button', { name: kind === 'video' ? 'Generate Video' : 'Generate', exact: true }) : page.getByRole('button', { name: 'Generate', exact: true });
    await generate.click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.kind).toBe(kind);
    expect(body!.width / body!.height).toBeCloseTo(reference.width / reference.height, 1);
    expect(body!.referenceAssets[0].assetId).toBe(reference.id);
  });
}

for (const selection of ['empty', 'previous', 'manual']) {
  const existingReference = selection !== 'empty';
  test(`reusing an image then switching to video ${selection === 'manual' ? 'respects a new manual selection during loading' : existingReference ? 'replaces an old primary reference' : 'uses the output and its proportions'}`, async ({ page, isMobile }) => {
    const models = await (await page.request.get('/api/models')).json();
    const video = models.profiles.find((profile: any) => profile.kind === 'video');
    const referenceVideo = { ...video, id: 'reference-video', mediaInputs: [{ id: 'start', kind: 'image', role: 'start', label: 'Start Image', min: 0, max: 1, required: false }, { id: 'end', kind: 'image', role: 'end', label: 'End Image', follows: 'start', min: 0, max: 1, required: false }] };
    models.profiles.push(referenceVideo);
    if (existingReference) models.defaults.videoModel = referenceVideo.id;
    await page.route('**/api/models', (route) => route.fulfill({ json: models }));
    const reference = { id: 'reused-output', source: 'gallery', galleryItemId: images[0].id, name: 'Reused Output', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 900, height: 1600, size: 1, createdAt: '', privacyDomain: 'gallery' };
    const previous = { ...reference, id: 'previous-reference', name: 'Previous Reference', width: 1600, height: 900 };
    const manual = { ...previous, id: 'manual-reference', name: 'Manual Replacement' };
    let resolves = 0;
    let releaseReference!: () => void;
    const referenceReady = new Promise<void>((resolve) => { releaseReference = resolve; });
    await page.route('**/api/reference-assets/from-gallery', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ galleryItemId: images[0].id });
      resolves++;
      await referenceReady;
      await route.fulfill({ json: { asset: reference } });
    });
    await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [previous, manual], hasMore: false, nextCursor: '' } }));
    let body: Record<string, any> | null = null;
    await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
    await page.goto('/');
    if (existingReference) {
      await controls(page, isMobile).switchMode('video');
      await openComposer(page, isMobile);
      await page.getByRole('button', { name: 'Add Start Image', exact: true }).click();
      await page.getByRole('button', { name: previous.name, exact: true }).click();
      await page.getByRole('button', { name: 'Add End Image', exact: true }).click();
      await page.getByRole('button', { name: previous.name, exact: true }).click();
      if (isMobile) await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
      await controls(page, isMobile).switchMode('image');
    }
    await page.locator(`[data-tile-id="${images[0].id}"]`).click();
    if (isMobile) await page.getByRole('button', { name: 'Reuse', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Use these settings', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.viewer-stage')).toHaveCount(0);
    }
    if (existingReference) {
      if (isMobile) await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
      await controls(page, isMobile).switchMode('video');
      await openComposer(page, isMobile);
    } else await page.locator('.composer-mode-select').getByRole('button', { name: 'Video', exact: true }).click();
    await expect.poll(() => resolves).toBe(1);
    const pendingGenerate = isMobile ? page.locator('.phone-create').getByRole('button', { name: 'Generate Video', exact: true }) : page.getByRole('button', { name: 'Loading the reused image', exact: true });
    await expect(pendingGenerate).toBeDisabled();
    if (selection === 'manual') {
      await page.getByRole('button', { name: `Change start image, currently ${previous.name}`, exact: true }).click();
      await page.getByRole('button', { name: manual.name, exact: true }).click();
    }
    releaseReference();
    const expected = selection === 'manual' ? manual : reference;
    await expect(page.getByRole('button', { name: `Change start image, currently ${expected.name}`, exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Animate the image');
    const generate = isMobile ? page.locator('.phone-create').getByRole('button', { name: 'Generate Video', exact: true }) : page.getByRole('button', { name: 'Generate', exact: true });
    await generate.click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.kind).toBe('video');
    expect(body!.profileId).toBe(referenceVideo.id);
    expect(body!.referenceAssets).toEqual([{ slot: 'start', assetId: expected.id }, ...(existingReference ? [{ slot: 'end', assetId: previous.id }] : [])]);
    expect(body!.width / body!.height).toBeCloseTo(expected.width / expected.height, 1);
    expect(resolves).toBe(1);
  });
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
  const { scroller, switchMode } = controls(page, isMobile);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  for (const kind of ['image', 'video']) {
    await switchMode(kind as 'image' | 'video');
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
    await switchMode(kind === 'image' ? 'video' : 'image');
    const completion = page.waitForResponse('**/api/jobs/browser-job');
    done = true;
    await completion;
    await expect(page.locator('[data-tile-id="completed-browser-job"]')).toHaveCount(0);
  }
  await switchMode('image');
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
  const { switchMode } = controls(page, isMobile);
  await switchMode('video');
  await expect(page.getByRole('button', { name: /Video (offline|is offline)/ })).toBeVisible();
  await switchMode('image');
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

test('Fast and Quality filters retain all reference variants and All clears them', async ({ page, isMobile }) => {
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
  await expect(controls(page, isMobile).mode.getByRole('button', { name: 'Video', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  await expect(filters.getByRole('group', { name: 'Use', exact: true })).toHaveCount(0);
  await expect(rows.first()).toContainText('Flash Edit');
  await filters.getByRole('button', { name: 'Quality', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Standard Edit');
  await expect(rows.last()).toContainText('Standard Generate');
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
  await controls(page, isMobile).switchMode('video');
  await openComposer(page, isMobile);
  if (isMobile) await page.locator('.phone-create .phone-row').filter({ hasText: 'MiniMax H3' }).click();
  else await page.locator('.model-trigger').first().click();
  await expect(rows).toHaveCount(2);
  await expect(filters.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);
  await expectSingleRow();
  await expect(filters.getByRole('button', { name: 'Non-Reference', exact: true })).toHaveCount(0);
  await expect(filters.getByRole('button', { name: 'Reference', exact: true })).toHaveCount(0);
  await expect(filters.getByRole('button', { name: 'Fast', exact: true })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Quality', exact: true })).toBeVisible();
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
  const selectedRow = rows.filter({ hasText: 'Model 01' }).first();
  await expect(selectedRow.locator('.model-selection-tick')).toHaveCount(1);
  expect(await selectedRow.evaluate((row) => row.firstElementChild?.classList.contains('model-selection-tick'))).toBe(true);
  const tick = await selectedRow.locator('.model-selection-tick').boundingBox();
  const text = await selectedRow.locator(isMobile ? ':scope > span' : '.model-copy').boundingBox();
  expect(tick!.x + tick!.width).toBeLessThan(text!.x);
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
  await menu.getByRole('button', { name: 'Quality', exact: true }).click();
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

test('attaching a reference activates that mode’s controls without losing the image picker', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
    profile.mediaInputs = [{ id: 'reference', kind: 'image', label: 'Start Image', role: 'start', required: false, min: 0, max: 1 }];
    profile.imageModes = {
      generate: { capabilities: { ...profile.capabilities, negativePrompt: false, denoise: false }, defaults: profile.defaults },
      reference: { capabilities: { ...profile.capabilities, negativePrompt: true, denoise: true }, defaults: profile.defaults }
    };
  }
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  const reference = { id: 'mode-reference', source: 'upload', name: 'Mode Reference', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 1024, height: 1024, size: 1, createdAt: '', privacyDomain: 'gallery' };
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [reference], hasMore: false, nextCursor: '' } }));
  const requests: Record<string, any>[] = [];
  await page.route('**/api/generate', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'Test request captured' } });
  });
  await page.goto('/');
  await openComposer(page, isMobile);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A scene');
  await page.getByRole('textbox', { name: 'Negative Prompt', exact: true }).fill('blur');
  const generate = () => isMobile ? page.locator('.phone-create').getByRole('button', { name: 'Generate', exact: true }) : page.getByRole('button', { name: 'Generate', exact: true });
  await generate().click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).not.toHaveProperty('negative');
  await openComposer(page, isMobile);
  await page.getByRole('button', { name: 'Add Start Image', exact: true }).click();
  await page.getByRole('button', { name: 'Mode Reference', exact: true }).click();
  await expect(page.locator('.reference-popover')).toHaveCount(0);
  await generate().click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].negative).toBe('blur');
  expect(requests[1].referenceAssets).toEqual([{ slot: 'reference', assetId: reference.id }]);
});
