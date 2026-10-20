import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const item = { id: 'details-0', url: picture, type: 'image', status: 'done', prompt: 'A lighthouse at dusk, copied whole', model: 'flux1-schnell.safetensors', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '123', sampler: 'euler' } };

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// A ready first-frame video profile, so Animate and Extend Video are on offer.
test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const video = models.profiles.find((profile: { kind: string }) => profile.kind === 'video');
  models.profiles.push({ ...video, id: 'mock-h3', family: 'minimax_h3', ready: true, mediaInputs: [{ id: 'start', kind: 'image', required: true, min: 1, max: 1 }] });
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
});

test('a video’s Details offer Extend Video in name order', async ({ page }) => {
  const clip = { ...item, id: 'details-video', type: 'video', url: '/details-video.mp4', thumbnailUrl: picture };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [clip] : [], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/details-video.mp4*', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.switchMode('video');
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-video"]'));
  await ui.showDetails();
  const names = await viewer.getByRole('group', { name: 'Reuse', exact: true }).locator('.viewer-action-grid button').allInnerTexts();
  expect(names.map((name) => name.trim())).toEqual(['Copy Prompt', 'Extend Video', 'Use Prompt', 'Use Settings']);
});

test('Details lists its actions in name order and Generation Settings without a box, and Copy Prompt copies', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  await ui.showDetails();
  const actions = viewer.getByRole('group', { name: 'Reuse', exact: true });
  const names = await actions.locator('.viewer-action-grid button').allInnerTexts();
  expect(names.map((name) => name.trim())).toEqual(['Animate', 'Copy Prompt', 'Use Prompt', 'Use Settings']);
  // Copy Prompt sits straight above Use Settings.
  const copy = actions.getByRole('button', { name: 'Copy Prompt', exact: true });
  const settings = actions.getByRole('button', { name: 'Use Settings', exact: true });
  // Measured once the panel has finished coming in.
  await expect.poll(async () => {
    const [copyBox, settingsBox] = [await copy.boundingBox(), await settings.boundingBox()];
    const gap = settingsBox!.y - (copyBox!.y + copyBox!.height);
    return gap >= 0 && gap < 12 && copyBox!.x >= settingsBox!.x - 1 && copyBox!.x + copyBox!.width <= settingsBox!.x + settingsBox!.width + 1;
  }).toBe(true);
  // Generation Settings: a label like Prompt's, no box and no Copy as Text.
  const side = viewer.locator('.viewer-side');
  await expect(side.getByRole('region', { name: 'Generation Settings' })).toBeVisible();
  await expect(side.locator('.settings-disclosure')).toHaveCount(0);
  await expect(side.getByText('Copy as Text')).toHaveCount(0);
  expect(await side.locator('.detail-settings').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.prompt);
  if (phone) await expect(page.getByText('Prompt copied')).toBeVisible();
});

test('a phone copies the prompt from its viewer bar, with a toast', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  test.skip(!await ui.isPhone(), 'The viewer bar is the phone’s.');
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  const bar = viewer.getByRole('navigation', { name: 'Image actions', exact: true });
  const copy = bar.getByRole('button', { name: /Copy Prompt/ });
  if (!await copy.count()) test.skip(true, 'This bar has no room for Copy Prompt.');
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.prompt);
  await expect(page.getByText('Prompt copied')).toBeVisible();
});
