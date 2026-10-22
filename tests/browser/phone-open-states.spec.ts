import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const settings = { mode: 'image', prompt: 'A lighthouse', model: 'model.safetensors', workflow: 'flux', width: 512, height: 512, steps: 8, seed: '1' };
const items = [
  { id: 'running-1', jobId: 'job-running', type: 'image', status: 'pending', prompt: 'A lighthouse at dusk', createdAt: at(9), width: 512, height: 512, model: 'model.safetensors', settings, progress: { value: 2, max: 8 } },
  { id: 'failed-1', jobId: 'job-failed', type: 'image', status: 'error', prompt: 'A storm at sea', filename: 'Out of memory', createdAt: at(8), width: 512, height: 512, model: 'model.safetensors', settings },
  { id: 'done-1', type: 'image', status: 'done', url: picture, filename: 'done-1.png', prompt: 'A calm harbour', createdAt: at(7), width: 512, height: 512, model: 'model.safetensors', settings },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

for (const id of ['running-1', 'failed-1', 'done-1']) {
  test(`a tap on the ${id.split('-')[0]} tile opens it with its details`, async ({ page }) => {
    await page.goto('/');
    const ui = studioUi(page);
    const tile = page.locator(`[data-tile-id="${id}"] button.tile`);
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(ui.viewer).toBeVisible();
    await expect(page.locator('.viewer-profile-summary')).toBeVisible();
  });
}

test('Try Again replaces the failed item with the new run', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The desktop viewer dock; the phone bar runs the same action.');
  const deleted: string[] = [];
  await page.route('**/api/gallery/failed-1', (route) => { if (route.request().method() === 'DELETE') deleted.push('failed-1'); return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/generate', (route) => route.fulfill({ json: { jobId: 'retry-job', items: [] } }));
  await page.route('**/api/jobs/retry-job*', (route) => route.fulfill({ json: { status: 'running', outputs: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openViewer(page.locator('[data-tile-id="failed-1"]'));
  await page.locator('.viewer-dock').getByRole('button', { name: /Retry|Try Again/ }).first().click();
  await expect(page.locator('[data-tile-id="failed-1"]')).toHaveCount(0);
  await expect.poll(() => deleted).toEqual(['failed-1']);
});
