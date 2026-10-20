import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#699b88"/></svg>');
const asset = (id: string) => ({ id, name: `${id}.png`, source: 'upload', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 96, height: 96, size: 1, createdAt: '' });
const slot = (id: string, follows?: string) => ({ id, kind: 'image', role: 'reference', label: id === 'reference' ? 'Reference Image' : 'Second Reference', min: 0, max: 1, required: false, ...(follows ? { follows } : {}) });

async function prepare(page: Page) {
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
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [asset('first-reference'), asset('second-reference')], nextCursor: '' } }));
  const requests: any[] = [];
  await page.route('**/api/generate', (route) => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Captured transition payload' } }); });
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  return { requests, ui };
}

/** The picked pictures: a one-slot model's thumbnail, or the thumbnails in a References button. */
const picked = (page: Page) => page.locator('.ref-thumb, .ref-group-thumbs img');

async function attach(page: Page, name: string) {
  await page.locator('.ref-add').first().click();
  await page.getByRole('button', { name: `${name}.png`, exact: true }).click();
  await expect(page.locator('.reference-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reference-popover')).toHaveCount(0);
}

test('model changes preserve text, apply zero defaults and discard incompatible references', async ({ page }) => {
  const { requests, ui } = await prepare(page);
  await ui.prompt.fill('Keep this scene');
  await ui.negativePrompt.fill('Keep these exclusions');
  await attach(page, 'first-reference');
  await attach(page, 'second-reference');
  await expect(picked(page)).toHaveCount(2);
  await ui.chooseModel('One Reference');
  await expect(picked(page)).toHaveCount(1);
  await expect(page.locator('.ref-thumb')).toHaveAttribute('aria-label', /first-reference/);
  await ui.chooseModel('Two References');
  await expect(picked(page)).toHaveCount(1);
  await ui.chooseModel('Text Only Zero Defaults');
  await expect(picked(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Keep this scene');
  await ui.generate.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ profileId: 'transition-zero', cfg: 0, denoise: 0, width: 320, height: 448, steps: 9, referenceAssets: [] });
  expect(requests[0]).not.toHaveProperty('negative');
  await ui.chooseModel('Two References');
  await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue('Keep these exclusions');
});

test('a late library selection cannot attach an asset after changing model', async ({ page }) => {
  const { ui } = await prepare(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [{ ...asset('pending-selection'), source: 'generation', galleryItemId: 'generated-image' }], nextCursor: '' } }));
  await page.route('**/api/reference-assets/from-gallery', async (route) => { await pending; await route.fulfill({ json: { asset: asset('late-selection') } }); });
  await page.locator('.ref-add').first().click();
  const requested = page.waitForRequest('**/api/reference-assets/from-gallery');
  await page.getByRole('button', { name: 'pending-selection.png', exact: true }).click();
  await requested;
  await page.keyboard.press('Escape');
  await ui.chooseModel('One Reference');
  await ui.chooseModel('Two References');
  const completed = page.waitForResponse('**/api/reference-assets/from-gallery');
  release();
  await completed;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(picked(page)).toHaveCount(0);
});
