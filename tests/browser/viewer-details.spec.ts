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
  // Only what was set: zero numbers stay, switched-off flags and absent inputs don't.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('guidance: 0');
  for (const unset of ['autoResizeInputs', 'startImageId', 'Negative:']) expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(unset);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  for (const output of ['forbidden-output.png', 'outputWidth', 'Timing', 'Queue:', 'Active:', 'Generated:', 'Output:', '2026-01-01']) expect(copied).not.toContain(output);
  for (const input of ['Profile ID: mock-flux-schnell', 'guidance: 0', 'workflow-input.json', 'input-reference']) expect(copied).toContain(input);
  await expect(side.getByRole('button', { name: 'Copy Settings', exact: true })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  // On the phone Info closes Details: one close, and the bar doesn't repeat the footer.
  if (phone) {
    await expect(side.getByRole('button', { name: 'Close Details', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('navigation', { name: 'Image Actions', exact: true }).getByRole('button', { name: 'Recreate', exact: true })).toHaveCount(0);
  }
  await expect(side.getByRole('region', { name: 'Generation Details', exact: true })).toBeVisible();
  const settings = side.locator('.detail-settings');
  const timingRows = [['Active', '14s'], ['Total', '30s'], ['Queue', '15s'], ['Setup', '3s'], ['Sampling', '10s'], ['Finishing', '1s']];
  for (const [label, value] of timingRows) {
    await expect(settings.getByText(label, { exact: true })).toBeVisible();
    await expect(settings.getByText(value, { exact: true })).toBeVisible();
  }
  // Active leads, then Total, Queue and the run's phases; no "(Est.)".
  const timingSection = settings.locator('.detail-section').filter({ has: page.getByRole('heading', { name: 'Timing', exact: true }) });
  expect((await timingSection.locator('.detail-grid > :nth-child(odd)').allInnerTexts()).map((label) => label.trim())).toEqual(timingRows.map(([label]) => label));
  await expect(settings.locator('.detail-note')).toHaveCount(0);
  // Prompt, Model, Settings and Output (the picture and its file together), then Timing; rows read alphabetically.
  expect(await settings.locator('.detail-heading').allInnerTexts()).toEqual(['Model', 'Settings', 'Output', 'Timing']);
  const output = settings.locator('.detail-section').filter({ has: page.getByRole('heading', { name: 'Output', exact: true }) });
  const labels = (await output.locator('.detail-grid > :nth-child(odd)').allInnerTexts()).map((label) => label.trim());
  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  expect(labels).toEqual(expect.arrayContaining(['File', 'Generated', 'Size']));
  // The output's type says nothing the picture doesn't.
  expect(labels).not.toContain('Type');
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
  // The file name is in the tooltip only; the information panel has no File line.
  await expect(list).not.toContainText('pawg_krea2.safetensors');
  // Copy gives the files and strengths, so the text can rebuild the run.
  await viewer.locator('.viewer-side').getByRole('group', { name: 'Details Actions', exact: true }).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('LoRAs:\nloras/pawg_krea2.safetensors · 0.80\nsoft_light-v3.safetensors · 1.00');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('PAWG Krea 2');
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
  // View Source is one icon per host, never a text pill.
  await expect(viewer.locator('.lora-sources a')).toHaveText(['', '']);
  expect(await viewer.locator('.lora-sources a').evaluateAll(links => {
    const [com, red] = links.map(link => link.getBoundingClientRect());
    return com.right <= red.left + 0.1;
  })).toBe(true);

});


test('the viewer title is always shown and concise', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone viewer keeps its title in the top row.');
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page); const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  await ui.hideDetails();
  const summary = viewer.locator('.viewer-profile-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('512 × 512 · 4 Steps');
  await expect(summary).not.toContainText('CFG');
  await expect(summary).not.toContainText('Seed');
  await ui.showDetails();
  await expect(viewer.getByRole('button', { name: 'Image Text', exact: true })).toHaveCount(0);
  await expect(summary).toBeVisible();
});

test('the phone viewer title sits in the top row and Details opens under it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone viewer.');
  const second = { ...item, id: 'details-1' };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item, second], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page); const viewer = await ui.openViewer(page.locator('[data-tile-id="details-0"] .tile'));
  const summary = viewer.locator('.viewer-profile-summary');
  await expect(summary).toBeVisible();
  // The position, then the size and steps, on its second line.
  await expect(summary.locator('span')).toContainText(/^[12] \/ 2 · /);
  await expect(summary.locator('span')).toContainText('512 × 512 · 4 Steps');
  const info = viewer.getByRole('button', { name: 'Info', exact: true });
  const star = viewer.getByRole('button', { name: /^(Star|Unstar)$/ });
  const centre = async (locator: typeof info) => { const box = (await locator.boundingBox())!; return box.y + box.height / 2; };
  expect(Math.abs(await centre(summary) - await centre(info))).toBeLessThan(2);
  expect((await summary.boundingBox())!.x + (await summary.boundingBox())!.width).toBeLessThanOrEqual((await star.boundingBox())!.x);
  await ui.showDetails();
  // The title stays in its row; Details starts under the icons.
  expect(Math.abs(await centre(summary) - await centre(info))).toBeLessThan(2);
  const infoBox = (await info.boundingBox())!;
  const side = (await viewer.locator('.viewer-side').boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(infoBox.y + infoBox.height);
  expect(side.y).toBeLessThan(infoBox.y + infoBox.height + 16);
  // Info's pressed state is the accent, with no white disc.
  await expect.poll(() => info.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(255, 154, 82)');
});
