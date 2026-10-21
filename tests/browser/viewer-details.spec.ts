import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const item = { id: 'details-0', url: picture, type: 'image', status: 'done', prompt: 'A lighthouse at dusk, copied whole', model: 'flux1-schnell.safetensors', filename: 'forbidden-output.png', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512, durationMs: 30000, timing: { runMs: 14000, queueMs: 15000, setupMs: 3000, samplingMs: 10000, finishMs: 1000 }, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '123', sampler: 'euler', autoResizeInputs: false, guidance: 0, workflow: 'workflow-input.json', referenceAssets: [{ assetId: 'input-reference', slot: 'reference' }], outputWidth: 9999 } };

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

test('Details copies generation inputs, excludes output metadata and keeps per-prompt Copy', async ({ page }) => {
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
  expect((await footer.getByRole('button').allInnerTexts()).map((name) => name.trim())).toEqual(['Copy', 'Recreate']);
  const copy = footer;
  await copy.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(item.prompt);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Seed: 123');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  for (const output of ['forbidden-output.png', 'outputWidth', 'Timing', 'Queue:', 'Active:', 'Generated:', 'Output:', '2026-01-01']) expect(copied).not.toContain(output);
  for (const input of ['Profile ID: mock-flux-schnell', 'autoResizeInputs: false', 'guidance: 0', 'workflow-input.json', 'input-reference']) expect(copied).toContain(input);
  await expect(side.getByRole('button', { name: 'Copy Settings', exact: true })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(side.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  // On the phone Info closes Details: one close, and the bar doesn't repeat the footer.
  if (phone) {
    await expect(side.getByRole('button', { name: 'Close Details', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('navigation', { name: 'Image Actions', exact: true }).getByRole('button', { name: 'Recreate', exact: true })).toHaveCount(0);
  }
  await expect(side.getByRole('region', { name: 'Generation Details', exact: true })).toBeVisible();
  const settings = side.locator('.detail-settings');
  for (const [label, value] of [['Total', '30s'], ['Queue', '15s'], ['Active', '14s'], ['Setup (Est.)', '3s'], ['Sampling (Est.)', '10s'], ['Finishing (Est.)', '1s']]) {
    await expect(settings.getByText(label, { exact: true })).toBeVisible();
    await expect(settings.getByText(value, { exact: true })).toBeVisible();
  }
  // Measured times are explained, and estimates stay marked as estimates.
  await expect(settings.getByText('Active is the worker’s run after queueing. Total also counts queueing, transfer and finishing. Est. rows are estimates.', { exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(await side.locator('.detail-settings').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  await prompt.getByRole('button', { name: 'Copy Prompt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.prompt);
  if (phone) await expect(page.locator('.status-message').filter({ hasText: 'Prompt copied' })).toBeVisible();
});

test('Details names each LoRA by its catalogue title, with its strength small and the file in its tooltip', async ({ page }) => {
  const withLoras = { ...item, id: 'details-loras', settings: { ...item.settings, loras: [{ name: 'loras/pawg_krea2.safetensors', strength: 0.8, enabled: true }, { name: 'soft_light-v3.safetensors', strength: 1, enabled: true }] } };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [withLoras], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: { 'loras/pawg_krea2.safetensors': { title: 'PAWG Krea 2', families: ['krea2'], triggers: ['test-trigger'], description: 'A catalogue description', sourceUrl: 'https://civitai.com/models/123?modelVersionId=456' } } } }));
  await page.goto('/');
  const ui = studioUi(page);
  const viewer = await ui.openViewer(page.locator('[data-tile-id="details-loras"] .tile'));
  await ui.showDetails();
  const list = viewer.getByRole('list', { name: 'LoRAs' });
  const names = list.locator('.detail-lora-name');
  await expect(names).toHaveText(['PAWG Krea 2', 'Soft Light V3']);
  await expect(names.first()).toHaveAttribute('title', 'pawg_krea2.safetensors');
  await expect(list.locator('.detail-lora-strength')).toHaveText(['0.80', '1.00']);
  await expect(list).toContainText('pawg_krea2.safetensors');
});

test('LoRA Details includes its information and both Civitai hosts', async ({ page }) => {
  const withLoras = { ...item, settings: { ...item.settings, loras: [{ name: 'test.safetensors', strength: 0.8, enabled: true }] } };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [withLoras], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/loras/info', route => route.fulfill({ json: { loras: { 'test.safetensors': { title: 'Test Adapter', families: ['krea2'], triggers: [], description: 'Catalogue description', sourceUrl: 'https://civitai.red/models/123?modelVersionId=456' } } } }));
  await page.goto('/');
  const ui = studioUi(page); const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile')); await ui.showDetails();
  await expect(viewer.getByRole('region', { name: 'Test Adapter Information' })).toBeVisible();
  await expect(viewer.getByText('Catalogue description', { exact: true })).toBeVisible();
  for (const host of ['civitai.com', 'civitai.red']) await expect(viewer.getByRole('link', { name: `View Test Adapter on ${host}`, exact: true })).toHaveAttribute('href', `https://${host}/models/123?modelVersionId=456`);
  await expect(viewer.getByRole('region', { name: 'Test Adapter Information' }).getByRole('link')).toHaveCount(0);
  expect(await viewer.locator('.lora-sources a').evaluateAll(links => {
    const [com, red] = links.map(link => link.getBoundingClientRect());
    return com.right <= red.left + 0.1;
  })).toBe(true);

});


test('image text is concise, optional and appears only while Details is open', async ({ page }) => {
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page); const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  await ui.hideDetails();
  await expect(viewer.locator('.viewer-profile-summary')).toHaveCount(0);
  await ui.showDetails();
  const toggle = viewer.getByRole('button', { name: 'Image Text', exact: true });
  const summary = viewer.locator('.viewer-profile-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('512 × 512 · 4 Steps');
  await expect(summary).not.toContainText('CFG');
  await expect(summary).not.toContainText('Seed');
  await toggle.click(); await expect(summary).toHaveCount(0);
  await toggle.click(); await expect(summary).toBeVisible();
  await ui.hideDetails(); await expect(summary).toHaveCount(0);
});
