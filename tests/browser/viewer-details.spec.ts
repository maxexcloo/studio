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

test('a video offers Extend in place of Animate', async ({ page }) => {
  const clip = { ...item, id: 'details-video', type: 'video', url: '/details-video.mp4', thumbnailUrl: picture };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [clip] : [], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/details-video.mp4*', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.switchMode('video');
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-video"]'));
  await expect(viewer.getByRole('button', { name: 'Extend', exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Animate', exact: true })).toHaveCount(0);
});

test('Details shows each prompt with Copy and Use, Settings without a box, and Reuse · Recreate', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  await expect(viewer.getByRole('button', { name: 'Animate', exact: true })).toBeVisible();
  await ui.showDetails();
  const side = viewer.locator('.viewer-side');
  const prompt = side.getByRole('region', { name: 'Prompt', exact: true });
  await expect(prompt.getByRole('button', { name: 'Copy Prompt', exact: true })).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Use Prompt', exact: true })).toBeVisible();
  const footer = side.getByRole('group', { name: 'Reuse', exact: true });
  expect((await footer.getByRole('button').allInnerTexts()).map((name) => name.trim())).toEqual(['Reuse', 'Recreate']);
  await expect(side.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  expect(await side.locator('.detail-settings').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  // The phone has its own shortcuts at the top.
  await expect(side.getByRole('button', { name: 'Copy Settings', exact: true })).toHaveCount(phone ? 1 : 0);
  await prompt.getByRole('button', { name: 'Copy Prompt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.prompt);
  if (phone) await expect(page.getByText('Prompt copied')).toBeVisible();
});
