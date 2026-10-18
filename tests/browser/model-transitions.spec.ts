import { expect, test, type Page } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#699b88"/></svg>');
const asset = (id: string, privateAsset = false) => ({ id, name: `${id}.png`, source: privateAsset ? 'vault' : 'upload', privacyDomain: privateAsset ? 'vault' : 'gallery', galleryItemId: privateAsset ? id : undefined, url: picture, thumbnailUrl: picture, mime: 'image/png', width: 96, height: 96, size: 1, createdAt: '' });
const slot = (id: string, follows?: string) => ({ id, kind: 'image', role: 'reference', label: id === 'reference' ? 'Reference Image' : 'Second Reference', min: 0, max: 1, required: false, ...(follows ? { follows } : {}) });

async function prepare(page: Page, phone: boolean, hidden = false) {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.kind === 'image');
  const image = (id: string, label: string, inputs: any[], negative = true) => ({ ...base, id, label, displayName: label, mediaInputs: inputs, capabilities: { ...base.capabilities, cfg: true, denoise: true, negativePrompt: negative, startImage: inputs.length > 0 }, constraints: { ...base.constraints, cfg: { min: 0, max: 20, step: 0.1 }, denoise: { min: 0, max: 1, step: 0.01 } } });
  const two = image('transition-two', 'Two References', [slot('reference'), slot('second', 'reference')]);
  const one = image('transition-one', 'One Reference', [slot('reference')]);
  const zero = image('transition-zero', 'Text Only Zero Defaults', [], false);
  zero.defaults = { ...zero.defaults, cfg: 0, denoise: 0, width: 320, height: 448, steps: 9 };
  models.profiles = [two, one, zero, ...models.profiles.filter((profile: any) => profile.kind === 'video')];
  models.defaults.imageModel = two.id;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', (route) => {
    const privateShelf = new URL(route.request().url()).searchParams.get('source') === 'hidden';
    return route.fulfill({ json: { items: privateShelf ? [asset('private-reference', true)] : [asset('first-reference'), asset('second-reference')], nextCursor: '' } });
  });
  if (hidden) {
    await page.route('**/api/privacy/status', (route) => route.fulfill({ json: { enabled: true, unlocked: true, passkeys: [], vault: { unlocked: true, revision: 1 } } }));
    await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [], revision: 1, hasMore: false } }));
  }
  const requests: any[] = [];
  await page.route('**/api/generate', (route) => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Captured transition payload' } }); });
  await page.goto('/');
  await open(page, phone);
  return requests;
}

async function open(page: Page, phone: boolean, hidden = false) {
  if (phone) {
    if (!await page.locator('.phone-create').isVisible()) await page.locator('.phone-create-open').click();
  } else await page.getByRole('textbox', { name: hidden ? 'Prompt (Hidden)' : 'Prompt', exact: true }).focus();
}

async function choose(page: Page, phone: boolean, name: string) {
  if (phone) {
    await page.locator('.phone-create').getByRole('button', { name: 'Browse Models', exact: true }).click();
    await page.locator('.phone-model-option').filter({ hasText: name }).first().click();
  } else {
    await page.locator('.zen-prompt .model-trigger').click();
    await page.getByRole('option').filter({ hasText: name }).first().click();
  }
}

async function attach(page: Page, name: string) {
  await page.locator('.ref-add').first().click();
  await page.getByRole('button', { name: `${name}.png`, exact: true }).click();
  await expect(page.locator('.reference-popover')).toHaveCount(0);
}

test('model changes preserve text, apply zero defaults and discard incompatible references', async ({ page, isMobile }) => {
  const requests = await prepare(page, isMobile);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Keep this scene');
  await page.getByRole('textbox', { name: 'Negative Prompt', exact: true }).fill('Keep these exclusions');
  await attach(page, 'first-reference');
  await attach(page, 'second-reference');
  await expect(page.locator('.ref-thumb')).toHaveCount(2);
  await choose(page, isMobile, 'One Reference');
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  await expect(page.locator('.ref-thumb')).toHaveAttribute('aria-label', /first-reference/);
  await choose(page, isMobile, 'Two References');
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  await choose(page, isMobile, 'Text Only Zero Defaults');
  await expect(page.locator('.ref-thumb')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Keep this scene');
  await page.locator(isMobile ? '.phone-create' : '.zen-prompt').locator('.composer-submit-actions button').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ profileId: 'transition-zero', cfg: 0, denoise: 0, width: 320, height: 448, steps: 9, referenceAssets: [] });
  expect(requests[0]).not.toHaveProperty('negative');
  if (isMobile) await expect(page.locator('.phone-create')).toHaveCount(0);
  await open(page, isMobile);
  await choose(page, isMobile, 'Two References');
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue('Keep these exclusions');
});

test('a late library selection cannot attach an asset after changing model', async ({ page, isMobile }) => {
  await prepare(page, isMobile);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [{ ...asset('pending-selection'), source: 'generation', galleryItemId: 'generated-image' }], nextCursor: '' } }));
  await page.route('**/api/reference-assets/from-gallery', async (route) => { await pending; await route.fulfill({ json: { asset: asset('late-selection') } }); });
  await page.locator('.ref-add').first().click();
  const requested = page.waitForRequest('**/api/reference-assets/from-gallery');
  await page.getByRole('button', { name: 'pending-selection.png', exact: true }).click();
  await requested;
  await page.keyboard.press('Escape');
  await choose(page, isMobile, 'One Reference');
  await choose(page, isMobile, 'Two References');
  const completed = page.waitForResponse('**/api/reference-assets/from-gallery');
  release();
  await completed;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.ref-thumb')).toHaveCount(0);
});

test('Hidden references never overwrite the saved Gallery reference when reloading', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The desktop case verifies the shared draft serialisation.');
  await prepare(page, false, true);
  await attach(page, 'first-reference');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('heiss-ui-draft') || '{}').startImageId)).toBe('first-reference');
  await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Show Hidden', exact: true }).click();
  await open(page, false, true);
  await attach(page, 'private-reference');
  await page.getByRole('textbox', { name: 'Prompt (Hidden)', exact: true }).fill('Private prompt must remain in memory');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('heiss-ui-draft') || '{}');
    return { id: draft.startImageId, name: draft.startImageName, references: draft.referenceAssets?.map((item: any) => item.asset.id) };
  })).toEqual({ id: 'first-reference', name: 'first-reference.png', references: ['first-reference'] });
  expect(await page.evaluate(() => localStorage.getItem('heiss-ui-draft'))).not.toContain('Private prompt must remain in memory');
  await page.reload();
  await open(page, false);
  await expect(page.locator('.ref-thumb')).toHaveAttribute('aria-label', /first-reference/);
});
