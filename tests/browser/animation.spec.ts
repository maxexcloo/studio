import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = ['A quiet lake below a mountain', 'A dog resting in a garden'].map((prompt, index) => ({ id: `animate-${index}`, url: picture, filename: `photo-${index}.png`, type: 'image', status: 'done', prompt, createdAt: `2026-01-0${2 - index}T00:00:00Z`, width: 512, height: 512 }));

/** A photo animates from its own right-click menu; several selected never animate together (batch 5). */
async function animatePhoto(page: import('@playwright/test').Page, id: string) {
  await page.locator(`[data-tile-id="${id}"] .tile`).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Animate' }).click();
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone animates from the viewer’s bar; this checks the desktop’s right-click menu.');
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

test('a photo gets an editable motion prompt and a queue retry keeps its job ID', async ({ page }) => {
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
    if (requests.length === 1) await route.fulfill({ status: 503, json: { error: 'Test queue interrupted' } });
    else await route.fulfill({ json: { jobId: body.clientJobId, items: [] } });
  });
  await page.goto('/');
  // Selecting several offers no Animate: each photo animates on its own.
  await studioUi(page).enterSelection();
  await page.getByRole('button', { name: 'Select All', exact: true }).click();
  await page.locator('[data-tile-id="animate-0"] .tile').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Animate/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('[aria-checked="true"], .is-selected')).toHaveCount(0);
  await animatePhoto(page, 'animate-1');
  const dialog = page.getByRole('dialog', { name: 'Animate', exact: true });
  await expect(dialog).toBeVisible();
  const prompts = dialog.getByRole('textbox');
  await expect(prompts).toHaveCount(1);
  expect(await prompts.nth(0).inputValue()).toContain(images[1].prompt);
  expect(await prompts.nth(0).inputValue()).toContain('animal breathes');
  await prompts.nth(0).fill('The dog lifts its head and looks towards the camera.');
  expect(requests).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Queue 1 Animation', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Test queue interrupted');
  await dialog.getByRole('button', { name: 'Retry 1 Remaining', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2);
  expect(requests[0].referenceAssets).toEqual([{ slot: 'first-frame', assetId: 'ref-animate-1' }]);
  expect(requests[0].prompt).toBe('The dog lifts its head and looks towards the camera.');
  // A retry keeps the job's ID, so it never runs twice.
  expect(requests[1].clientJobId).toBe(requests[0].clientJobId);
  expect(requests.every((body) => body.kind === 'video' && body.profileId === profile.id && body.count === 1)).toBe(true);
});

test('Animate stays out of the menu while no ready H3 image-to-video profile is available', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  await page.route('**/api/models', (route) => route.fulfill({ json: { ...models, profiles: models.profiles.filter((profile: any) => profile.family !== 'minimax_h3') } }));
  await page.goto('/');
  await page.locator('[data-tile-id="animate-0"] .tile').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Rerun' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Animate' })).toHaveCount(0);
});
