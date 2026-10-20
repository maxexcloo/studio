import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const item = { id: 'share-0', url: picture, type: 'image', status: 'done', prompt: 'Share placement', createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512 };

for (const shares of [true, false]) test(`phones share${shares ? ' instead of downloading' : ', or download where they can’t share files'}; the desktop downloads and never shares`, async ({ page }) => {
  // The browser's share sheet, taking files or not.
  await page.addInitScript((files) => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data?: { files?: File[] }) => files || !data?.files });
  }, shares);
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const viewer = await ui.openViewer(page.locator('[data-tile-id="share-0"] .tile'));
  const share = viewer.getByRole('button', { name: 'Share', exact: true }).filter({ visible: true });
  const download = viewer.getByRole('link', { name: /^(Download|Save)$/ }).or(viewer.getByRole('button', { name: /^(Download|Save)$/ })).filter({ visible: true });
  await expect(viewer.getByRole('button', { name: /^(Star|Unstar)$/ }).filter({ visible: true }).first()).toBeVisible();
  if (phone) {
    await expect(share).toHaveCount(shares ? 1 : 0);
    await expect(download).toHaveCount(shares ? 0 : 1);
  } else {
    await expect(share).toHaveCount(0);
    await expect(download).toHaveCount(1);
    await ui.closeViewer();
    await page.locator('[data-tile-id="share-0"] .tile').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(0);
  }
});
