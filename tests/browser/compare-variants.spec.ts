import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('variant comparisons stay hidden in Details and gallery selection', async ({ page }) => {
  const item = { id: 'hidden-compare', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'), type: 'image', status: 'done', prompt: 'Comparison fixture', settings: { profileId: 'mock-flux-schnell', seed: '12' } };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  await ui.openViewer(page.locator('[data-tile-id]').first()); await ui.showDetails();
  await expect(page.getByRole('button', { name: 'Compare Variants', exact: true })).toHaveCount(0);
  await ui.closeViewer();
  await ui.enterSelection();
  await page.locator('[data-tile-id] .tile').first().click();
  await expect(ui.selectionBar.getByRole('button', { name: /Compare/ })).toHaveCount(0);
});
