import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
// A picture made in chat and kept in Studio's media storage: its id is its address.
const address = '/comfy/view?filename=chat-image_00001_.png&subfolder=heiss-ui%2Faccounts%2Fabc&type=media';
const item = { id: address, url: address, thumbnailUrl: address.replace('/view', '/thumb'), type: 'image', status: 'done', prompt: 'Star from chat', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512, jobId: 'chat-job', index: 0 };

test('starring in the viewer sends the picture’s id and address, and a refusal says why and puts the star back', async ({ page }) => {
  await page.route('**/comfy/**', (route) => route.fulfill({ body: decodeURIComponent(picture.split(',')[1]), contentType: 'image/svg+xml' }));
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  const sent: { ids: string[]; favorite: boolean }[] = [];
  let refuse = false;
  await page.route('**/api/gallery/favorite', async (route) => {
    sent.push(route.request().postDataJSON());
    if (refuse) await route.fulfill({ status: 403, json: { ok: false, reason: 'origin', error: 'Blocked a request from another website.' } });
    else await route.fulfill({ json: { ok: true, items: [], revision: 2 } });
  });
  await page.goto('/');
  const viewer = await studioUi(page).openViewer(page.locator('[data-tile-id] .tile').first());
  const star = viewer.getByRole('button', { name: /^(Star|Unstar)$/ }).filter({ visible: true }).first();
  await star.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ ids: [address], favorite: true });
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  refuse = true;
  await star.click();
  await expect(page.getByText('Couldn’t save the star: Blocked a request from another website. (HTTP 403, origin)')).toBeVisible();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
});
