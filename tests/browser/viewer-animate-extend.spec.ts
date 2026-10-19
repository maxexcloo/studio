import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#527b8f"/></svg>');
const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '1', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);
const image = { id: 'viewer-photo', url: picture, filename: 'photo.png', type: 'image', status: 'done', prompt: 'A quiet lake below a mountain', createdAt: '2026-01-02T00:00:00Z', width: 1024, height: 1024 };
const clip = { id: 'viewer-clip', url: '/viewer-clip.mp4', filename: 'clip.mp4', type: 'video', status: 'done', prompt: 'A boat drifts across the lake', createdAt: '2026-01-01T00:00:00Z', width: 64, height: 64 };

async function capture(page: Page, { h3 = true } = {}) {
  const models = await (await page.request.get('/api/models')).json();
  const profile = { ...models.profiles[0], id: 'animation-h3', kind: 'video', family: 'minimax_h3', label: 'MiniMax H3', ready: true, mediaInputs: [{ id: 'first-frame', kind: 'image' }], defaults: { width: 1344, height: 768, frames: 124, fps: 24, steps: 20, cfg: 6 } };
  await page.route('**/api/models', (route) => route.fulfill({ json: { ...models, profiles: h3 ? [...models.profiles, profile] : models.profiles.filter((candidate: any) => candidate.family !== 'minimax_h3') } }));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [image, clip], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/viewer-clip.mp4*', (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
  const references: Record<string, any>[] = [];
  await page.route('**/api/reference-assets/from-gallery', (route) => {
    const body = route.request().postDataJSON();
    references.push(body);
    return route.fulfill({ json: { asset: { id: body.frame ? `gallery:${body.galleryItemId}:last-frame` : `gallery:${body.galleryItemId}` } } });
  });
  const generated: Record<string, any>[] = [];
  await page.route('**/api/generate', (route) => {
    const body = route.request().postDataJSON();
    generated.push(body);
    return route.fulfill({ json: { jobId: body.clientJobId, items: [] } });
  });
  return { profile, references, generated };
}

async function openTile(page: Page, isMobile: boolean, id: string, kind: 'Images' | 'Videos') {
  await page.goto('/');
  if (kind === 'Videos') await page.locator(isMobile ? '.phone-mode-select' : '.gallery-generation-mode').getByRole('button', { name: /^Videos?$/ }).click();
  await page.locator(`[data-tile-id="${id}"] .tile`).click();
  return page.getByRole('dialog', { name: 'Image Viewer', exact: true });
}

test('the image viewer animates its picture from the first frame', async ({ page, isMobile }) => {
  const { profile, references, generated } = await capture(page);
  const viewer = await openTile(page, isMobile, image.id, 'Images');
  await expect(viewer.getByRole('button', { name: 'Animate', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Animate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Animate', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status').last()).toHaveText('1 photo selected.');
  const prompt = dialog.getByRole('textbox', { name: 'Animation Prompt 1' });
  expect(await prompt.inputValue()).toContain('Water flows');
  await dialog.getByRole('button', { name: 'Queue 1 Animation', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  expect(references).toEqual([{ galleryItemId: image.id }]);
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ kind: 'video', profileId: profile.id, count: 1, referenceAssets: [{ slot: 'first-frame', assetId: `gallery:${image.id}` }] });
  expect(generated[0].prompt).toContain(image.prompt);
});

test('the video viewer extends a video from its last frame with its prompt', async ({ page, isMobile }) => {
  const { profile, references, generated } = await capture(page);
  const viewer = await openTile(page, isMobile, clip.id, 'Videos');
  await expect(viewer.getByRole('button', { name: 'Animate', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Extend Video', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Extend Video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extend Video', exact: true });
  await expect(dialog).toBeVisible();
  const prompt = dialog.getByRole('textbox', { name: 'Extension Prompt 1' });
  await expect(prompt).toHaveValue(clip.prompt);
  await prompt.fill('The boat reaches the far shore.');
  await dialog.getByRole('button', { name: 'Queue 1 Extension', exact: true }).click();
  await expect(dialog.getByRole('status').last()).toHaveText('1 of 1 extension queued. Find them in Video.');
  expect(references).toEqual([{ galleryItemId: clip.id, frame: 'last' }]);
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ kind: 'video', profileId: profile.id, count: 1, prompt: 'The boat reaches the far shore.', referenceAssets: [{ slot: 'first-frame', assetId: `gallery:${clip.id}:last-frame` }] });
});

test('the viewer offers neither action without a first-frame video profile', async ({ page, isMobile }) => {
  await capture(page, { h3: false });
  const viewer = await openTile(page, isMobile, image.id, 'Images');
  await expect(viewer.locator('.viewer-canvas img.generation-result')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Animate', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Extend Video', exact: true })).toHaveCount(0);
});
