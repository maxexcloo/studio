import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

const capabilities = [
  { id: 'image', label: 'Image', description: '' },
  { id: 'video', label: 'Video', description: '' },
  { id: 'upscale', label: 'Upscale', description: '' },
  { id: 'models', label: 'Model Library', description: '' }
];
const locked = { id: 'gpu0', name: 'Image GPU', url: 'http://comfyui-image:8188', capabilities: ['image', 'upscale', 'models'], source: 'deployment', locked: true };
const own = { id: 'video-box', name: 'Video Box', url: 'http://video-box:8188', capabilities: ['video'], source: 'studio', locked: false };

/** Settings › Workers with these workers and live states; returns what was saved. */
async function openWorkers(page: Page, workers: object[], live: object[]) {
  const saved: unknown[] = [];
  let list = workers;
  await page.route('**/api/workers', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { workers: Array<Record<string, unknown>> };
      saved.push(body);
      list = [...workers.filter((worker) => (worker as { locked: boolean }).locked), ...body.workers.map((worker, index) => ({ id: worker.id || `new-${index}`, source: 'studio', locked: false, ...worker }))];
    }
    return route.fulfill({ json: { ok: true, workers: list, capabilities, deployment: { variable: '' } } });
  });
  await page.route('**/api/comfy/status', (route) => route.fulfill({ json: { connected: live.some((worker) => (worker as { connected: boolean }).connected), noWorkers: !workers.length, workers: live, backends: {} } }));
  await page.goto('/');
  await studioUi(page).openSettings();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Workers', exact: true }).click();
  return { dialog, saved };
}

test('every worker shows the same rows and actions; only its capabilities differ', async ({ page }) => {
  const { dialog } = await openWorkers(page, [locked, own], [
    { id: 'gpu0', name: 'Image GPU', capabilities: locked.capabilities, default: true, connected: true, device: 'RTX 5090', url: locked.url },
    { id: 'video-box', name: 'Video Box', capabilities: own.capabilities, connected: false, device: '', url: own.url, error: 'Not connected' }
  ]);
  const groups = dialog.locator('.set-worker');
  await expect(groups).toHaveCount(2);
  await expect(dialog.getByRole('heading', { name: 'Image GPU' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Video Box' })).toBeVisible();
  // The same rows, in the same order, for every worker.
  for (const index of [0, 1]) {
    await expect(groups.nth(index).locator('.list-row-label')).toHaveText([/^Address/, 'Capabilities', 'Status', 'Open', 'Restart']);
  }
  await expect(groups.nth(0).locator('.set-row').filter({ hasText: 'Capabilities' })).toContainText('Image · Upscale · Model Library');
  await expect(groups.nth(1).locator('.set-row').filter({ hasText: 'Capabilities' })).toContainText('Video');
  await expect(groups.nth(0).locator('.set-row').filter({ hasText: 'Status' })).toContainText('RTX 5090');
  // Locked by the deployment: Edit stays in its place, off, with the reason.
  await expect(groups.nth(0).getByRole('button', { name: 'Edit Image GPU' })).toBeDisabled();
  await expect(groups.nth(0).locator('.set-row').filter({ hasText: 'Address' })).toContainText('Locked');
  // Offline: Open and Restart stay, off, saying why.
  await expect(groups.nth(1).getByRole('button', { name: 'Open Video Box' })).toBeDisabled();
  await expect(groups.nth(1).getByRole('button', { name: 'Restart Video Box' })).toBeDisabled();
  await expect(groups.nth(1).locator('.set-row').filter({ hasText: 'Restart' })).toContainText('Offline');
  await expect(groups.nth(0).getByRole('link', { name: 'Open Image GPU' })).toHaveAttribute('href', locked.url);
  await expect(groups.nth(0).getByRole('button', { name: 'Restart Image GPU' })).toBeEnabled();
  // No AI Control panel any more.
  await expect(dialog.getByRole('heading', { name: 'AI Control' })).toHaveCount(0);
});

test('Studio’s own workers are added, edited and removed as one draft with Save & Discard', async ({ page }) => {
  const { dialog, saved } = await openWorkers(page, [locked, own], [
    { id: 'gpu0', name: 'Image GPU', capabilities: locked.capabilities, default: true, connected: true, device: 'RTX 5090', url: locked.url },
    { id: 'video-box', name: 'Video Box', capabilities: own.capabilities, connected: true, device: 'RTX 4090', url: own.url }
  ]);
  await dialog.getByRole('button', { name: 'Edit Video Box' }).click();
  const capabilityGroup = dialog.getByRole('group', { name: 'Video Box Capabilities' });
  await capabilityGroup.getByRole('button', { name: 'Upscale', exact: true }).click();
  await expect(capabilityGroup.getByRole('button', { name: 'Upscale', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const save = dialog.getByRole('group', { name: 'Unsaved Changes' });
  await expect(save).toBeVisible();
  await save.getByRole('button', { name: 'Discard' }).click();
  await expect(save).toHaveCount(0);
  expect(saved).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Add Worker', exact: true }).click();
  await dialog.getByLabel('New Worker Name').fill('Upscaler');
  await dialog.getByLabel('Upscaler Address').fill('upscaler:8188');
  const upscaler = dialog.getByRole('group', { name: 'Upscaler Capabilities' });
  await upscaler.getByRole('button', { name: 'Image', exact: true }).click();
  await upscaler.getByRole('button', { name: 'Upscale', exact: true }).click();
  await expect(dialog.locator('.set-worker').filter({ hasText: 'Upscaler' }).locator('.set-row').filter({ hasText: 'Status' })).toContainText('Not Saved');
  await dialog.getByRole('group', { name: 'Unsaved Changes' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saved).toEqual([{ workers: [
    { id: 'video-box', name: 'Video Box', url: 'http://video-box:8188', capabilities: ['video'] },
    { name: 'Upscaler', url: 'upscaler:8188', capabilities: ['upscale'] }
  ] }]);
  await expect(dialog.getByRole('group', { name: 'Unsaved Changes' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Upscaler' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Edit Video Box' }).click();
  await dialog.getByRole('button', { name: 'Remove Video Box' }).click();
  await expect(dialog.getByRole('heading', { name: 'Video Box' })).toHaveCount(0);
  await dialog.getByRole('group', { name: 'Unsaved Changes' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => (saved.at(-1) as { workers: Array<{ name: string }> }).workers.map((worker) => worker.name)).toEqual(['Upscaler']);
});

test('no workers is a clear empty state with a way to add one', async ({ page }) => {
  const { dialog } = await openWorkers(page, [], []);
  await expect(dialog.getByText('No Workers Yet')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add Worker', exact: true })).toBeVisible();
  await expect(dialog.locator('.set-worker')).toHaveCount(0);
});
