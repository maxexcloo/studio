import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="navy"/></svg>');
test('comparison queues independent variants with a fixed seed, then saves a vote and history', async ({ page }) => {
  const base = { id: 'compare-base', jobId: 'base', url: picture, type: 'image', status: 'done', prompt: 'Original light', width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', seed: '321', steps: 4 } };
  const requests: any[] = []; let comparison: any = null;
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [base], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/generate', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { jobId: `variant-${requests.length}` } }); });
  await page.route('**/api/comparisons', async route => {
    if (route.request().method() === 'POST') comparison = { id: 'comparison', createdAt: new Date().toISOString(), seed: '321', vote: null, variants: requests.map((request, i) => ({ jobId: `variant-${i + 1}`, item: { ...base, prompt: request.prompt } })) };
    await route.fulfill({ json: route.request().method() === 'GET' ? { comparisons: comparison ? [comparison] : [] } : comparison });
  });
  await page.route('**/api/comparisons/comparison/vote', route => { comparison.vote = route.request().postDataJSON().jobId; return route.fulfill({ json: comparison }); });
  await page.goto('/'); const ui = studioUi(page); await ui.openViewer(page.locator('[data-tile-id="compare-base"] .tile')); await ui.showDetails();
  await page.getByRole('button', { name: 'Compare Variants', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Compare Variants', exact: true });
  await panel.getByRole('textbox', { name: 'Variant B Prompt' }).fill('Warmer light');
  await panel.getByRole('button', { name: 'Add Variant' }).click();
  await panel.getByRole('button', { name: 'Generate Variants' }).click();
  await expect(panel.getByRole('button', { name: 'Vote for B' })).toBeVisible();
  expect(requests).toHaveLength(3); expect(requests.map(item => item.seed)).toEqual(['321', '321', '321']); expect(requests[1].prompt).toBe('Warmer light');
  await panel.getByRole('button', { name: 'Vote for B' }).click(); await expect(panel.getByRole('button', { name: 'Voted' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('combobox', { name: 'Comparison History' }).locator('option')).toHaveCount(2);
});


test('comparison validates every variant first and never resubmits partially accepted jobs', async ({ page }) => {
  const base = { id: 'compare-validation', jobId: 'base', url: picture, type: 'image', status: 'done', prompt: 'Light', width: 512, height: 512, settings: { profileId: 'mock-flux-schnell', seed: 0 } };
  let submitted = 0;
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [base], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/comparisons', route => route.fulfill({ json: { comparisons: [] } }));
  await page.route('**/api/generate', route => {
    submitted++;
    expect(route.request().postDataJSON().seed).toBe('0');
    return route.fulfill(submitted === 1 ? { json: { jobId: 'accepted' } } : { status: 400, json: { error: 'Worker unavailable' } });
  });
  await page.goto('/'); const ui = studioUi(page);
  await ui.openViewer(page.locator('[data-tile-id="compare-validation"] .tile')); await ui.showDetails();
  await page.getByRole('button', { name: 'Compare Variants', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Compare Variants', exact: true });
  await expect(panel.getByRole('textbox', { name: 'Comparison Seed' })).toHaveValue('0');
  await panel.locator('section').nth(1).locator('summary').click();
  const settings = panel.getByRole('textbox', { name: 'Variant B Settings' });
  const original = await settings.inputValue();
  await settings.fill('[]');
  await panel.getByRole('button', { name: 'Generate Variants' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Settings must be a JSON object.');
  expect(submitted).toBe(0);
  await settings.fill(original);
  await panel.getByRole('button', { name: 'Generate Variants' }).click();
  await expect(panel.getByRole('alert')).toContainText('1 accepted job(s) remain in your gallery; nothing was resubmitted.');
  expect(submitted).toBe(2);
  await expect(panel.getByRole('button', { name: 'Generate Variants' })).toBeEnabled();
});
