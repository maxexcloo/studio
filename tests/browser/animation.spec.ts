import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = ['A quiet lake below a mountain', 'A dog resting in a garden'].map((prompt, index) => ({ id: `animate-${index}`, url: picture, filename: `photo-${index}.png`, type: 'image', status: 'done', prompt, createdAt: `2026-01-0${2 - index}T00:00:00Z`, width: 512, height: 512 }));

async function selectPhotos(page: import('@playwright/test').Page) {
  const ui = studioUi(page);
  await ui.enterSelection();
  await page.getByRole('button', { name: 'Select All Loaded', exact: true }).click();
  await ui.selectionBar.getByRole('button', { name: 'Animate', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('selected photos get editable motion prompts and partial queue retries keep stable IDs', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const profile = { ...models.profiles[0], id: 'animation-h3', kind: 'video', family: 'minimax_h3', label: 'MiniMax H3', ready: true, mediaInputs: [{ id: 'first-frame', kind: 'image' }], defaults: { width: 1344, height: 768, frames: 124, fps: 24, steps: 20, cfg: 6 } };
  await page.route('**/api/models', (route) => route.fulfill({ json: { ...models, profiles: [...models.profiles, profile] } }));
  await page.route('**/api/reference-assets/from-gallery', (route) => {
    const { galleryItemId } = route.request().postDataJSON();
    return route.fulfill({ json: { asset: { id: `ref-${galleryItemId}` } } });
  });
  const requests: Record<string, any>[] = [];
  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 2) await route.fulfill({ status: 503, json: { error: 'Test queue interrupted' } });
    else await route.fulfill({ json: { jobId: body.clientJobId, items: [] } });
  });
  await page.goto('/');
  await selectPhotos(page);
  const dialog = page.getByRole('dialog', { name: 'Animate', exact: true });
  await expect(dialog).toBeVisible();
  const prompts = dialog.getByRole('textbox');
  expect(await prompts.nth(0).inputValue()).toContain(images[0].prompt);
  expect(await prompts.nth(0).inputValue()).toContain('Water flows');
  expect(await prompts.nth(1).inputValue()).toContain('animal breathes');
  await prompts.nth(1).fill('The dog lifts its head and looks towards the camera.');
  expect(requests).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Queue 2 Animations', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Test queue interrupted');
  await expect(dialog.getByRole('button', { name: 'Retry 1 Remaining', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Retry 1 Remaining', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(3);
  expect(requests[0].referenceAssets).toEqual([{ slot: 'first-frame', assetId: 'ref-animate-0' }]);
  expect(requests[1].prompt).toBe('The dog lifts its head and looks towards the camera.');
  expect(requests[2].clientJobId).toBe(requests[1].clientJobId);
  expect(requests[0].clientJobId).not.toBe(requests[1].clientJobId);
  expect(requests.every((body) => body.kind === 'video' && body.profileId === profile.id && body.count === 1)).toBe(true);
});

test('animation review explains when no ready H3 image-to-video profile is available', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  await page.route('**/api/models', (route) => route.fulfill({ json: { ...models, profiles: models.profiles.filter((profile: any) => profile.family !== 'minimax_h3') } }));
  await page.goto('/');
  await selectPhotos(page);
  const dialog = page.getByRole('dialog', { name: 'Animate', exact: true });
  await expect(dialog).toContainText('No ready MiniMax H3 image-to-video model is available.');
  await expect(dialog.getByRole('button', { name: 'Queue 2 Animations', exact: true })).toBeDisabled();
});
