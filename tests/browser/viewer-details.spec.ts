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

test('Details shows each prompt with Copy, Settings without a box, and a footer of Copy Prompts · Copy Settings over Edit · Rerun', async ({ page }) => {
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
  await expect(prompt.getByRole('button', { name: 'Use Prompt', exact: true })).toHaveCount(0);
  const footer = side.getByRole('group', { name: 'Details Actions', exact: true });
  expect((await footer.getByRole('button').allInnerTexts()).map((name) => name.trim())).toEqual(['Copy Prompts', 'Copy Settings', 'Edit', 'Rerun']);
  // Edit and Rerun are equal-weight buttons, neither a faded ghost.
  const [edit, rerun] = [footer.getByRole('button', { name: 'Edit', exact: true }), footer.getByRole('button', { name: 'Rerun', exact: true })];
  expect(Math.abs((await edit.boundingBox())!.width - (await rerun.boundingBox())!.width)).toBeLessThan(2);
  // On the phone Info closes Details: one close, and the bar doesn't repeat the footer.
  if (phone) {
    await expect(side.getByRole('button', { name: 'Close Details', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('navigation', { name: 'Image Actions', exact: true }).getByRole('button', { name: 'Rerun', exact: true })).toHaveCount(0);
  }
  await expect(side.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  expect(await side.locator('.detail-settings').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  await prompt.getByRole('button', { name: 'Copy Prompt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.prompt);
  if (phone) await expect(page.locator('.status-message').filter({ hasText: 'Prompt copied' })).toBeVisible();
});

test('Details names each LoRA by its catalogue title, with its strength small and the file in its tooltip', async ({ page }) => {
  const withLoras = { ...item, id: 'details-loras', settings: { ...item.settings, loras: [{ name: 'loras/pawg_krea2.safetensors', strength: 0.8, enabled: true }, { name: 'soft_light-v3.safetensors', strength: 1, enabled: true }] } };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [withLoras], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: { 'loras/pawg_krea2.safetensors': { title: 'PAWG Krea 2', families: [], triggers: [] } } } }));
  await page.goto('/');
  const ui = studioUi(page);
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-loras"] .tile'));
  await ui.showDetails();
  const list = viewer.getByRole('list', { name: 'LoRAs' });
  const names = list.locator('.detail-lora-name');
  await expect(names).toHaveText(['PAWG Krea 2', 'Soft Light V3']);
  await expect(names.first()).toHaveAttribute('title', 'pawg_krea2.safetensors');
  await expect(list.locator('.detail-lora-strength')).toHaveText(['0.80', '1.00']);
  await expect(list).not.toContainText('.safetensors');
});
