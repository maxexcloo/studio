import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#527b8f"/></svg>');
const item = { id: 'dock-0', url: picture, type: 'image', status: 'done', prompt: 'Dock order', createdAt: '2026-01-01T00:00:00Z', width: 1024, height: 1024 };

test('the desktop dock reads zoom, then copy to delete, then details', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The dock is the full studio’s; the phone has its bar.');
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const viewer = await studioUi(page).openViewer(page.locator('[data-tile-id="dock-0"] .tile'));
  const dock = viewer.locator('.viewer-dock');
  // Each control's name, and "|" for each divider, in the order they sit.
  const order = await dock.evaluate((element) => [...element.querySelectorAll('button, a, .viewer-divider')]
    .filter((node) => !(node as HTMLElement).closest('.viewer-dock-close') && (node as HTMLElement).offsetParent)
    .map((node) => node.classList.contains('viewer-divider') ? '|' : node.getAttribute('aria-label')));
  expect(order).toEqual(['Zoom Out', 'Image Zoom Percentage', 'Zoom In', '|', 'Copy Image', 'Download', 'Star', 'Smart upscale', 'Delete from Gallery', '|', 'Toggle Details']);
  await expect(dock.getByRole('button', { name: 'Use as Reference Image' })).toHaveCount(0);
});
