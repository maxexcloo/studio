import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const done = (index: number) => ({ id: `bulk-image-${index}`, url: picture, filename: `${index}.png`, type: 'image', status: 'done', prompt: 'A calm landscape', model: 'flux1-schnell.safetensors', createdAt: new Date(Date.UTC(2026, 0, 1) - index * 60000).toISOString(), width: 512, height: 512 });
const items = [done(0), done(1), { ...done(2), id: 'bulk-failed', status: 'error', url: '', filename: 'Out of memory' }];

test('select-mode actions use bulk wording, never one item’s copy', async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  await expect(page.locator('[data-tile-id="bulk-image-0"] .tile')).toBeVisible();
  await ui.enterSelection();
  // Select All and Select Failed, each with its own name (and icon).
  await expect(page.getByRole('button', { name: 'Select Failed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select All', exact: true }).click();
  await expect(page.locator('.tile.is-selected')).toHaveCount(3);
  const bar = phone ? page.getByRole('navigation', { name: 'Selected Items', exact: true }) : page.getByRole('group', { name: 'Gallery Management', exact: true });
  const names = async () => bar.locator('button').evaluateAll((buttons) => buttons.map((button) => ({ name: button.getAttribute('aria-label') || button.textContent?.trim() || '', title: button.getAttribute('title') || '' })));
  await expect.poll(async () => (await names()).map((entry) => entry.name)).toEqual(expect.arrayContaining([
    phone ? expect.stringMatching(/^(Share|Download) Selected/) : 'Download Selected as a Zip',
    'Retry Selected', 'Star Selected', 'Delete Selected'
  ]));
  // Animate is for one picture at a time: select mode offers no bulk Animate, on either layout.
  expect((await names()).map((entry) => entry.name)).not.toContain('Animate Selected');
  for (const { name, title } of await names()) {
    expect(`${name} ${title}`, name).not.toMatch(/This Image|From This|this image/);
  }
  // Visible names stay one word.
  if (!phone) await expect(bar.getByRole('button', { name: 'Star Selected', exact: true })).toHaveText('Star');
  if (phone) {
    // Selecting swaps the top bar's contents: the same bar, the same height, its icon buttons.
    const top = page.locator('.phone-bar');
    await expect(top).toHaveCount(1);
    const topRow = (await top.locator('.phone-bar-row').boundingBox())!;
    const selectAll = (await page.getByRole('button', { name: /^Select (All|None)$/ }).boundingBox())!;
    expect(selectAll.width).toBe(44);
    expect(selectAll.height).toBe(44);
    // The bottom action bar is as tall as the top bar's row.
    const bottom = (await bar.boundingBox())!;
    expect(Math.round(bottom.height)).toBe(Math.round(topRow.height));
  }
});
