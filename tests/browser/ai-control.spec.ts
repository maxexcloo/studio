import { expect, test, type Locator, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

// Studio's own AI Control routes, answered as server/ai-control-routes.js shapes AI Control's replies.
const catalogue = {
  workloads: [
    { profile: 'comfyui-image', label: 'ComfyUI Image', runtime: 'image', kind: 'image', placements: ['0', '1'] },
    { profile: 'comfyui-video', label: 'ComfyUI Video', runtime: 'comfyui-video', kind: 'video', placements: ['0', '1', '0,1'] },
    { profile: 'gemma-31b', label: 'Radiance - Gemma 4 31B', runtime: 'text', kind: 'text', placements: ['0', '1', '0,1'] }
  ],
  runtimeNames: { text: 'Text', image: 'ComfyUI Image', 'comfyui-video': 'ComfyUI Video' }
};
const gpus = [{ device: '0', name: 'Radeon AI PRO R9700', availability: '' }, { device: '1', name: 'Radeon AI PRO R9700', availability: '' }];
const running = (profile: string, devices: string[]) => ({ running: true, profile, devices, health: 'healthy' });
const stopped = { running: false, profile: '', devices: [], health: 'stopped' };
const before = { image: running('comfyui-image', ['0']), text: running('gemma-31b', ['1']), 'comfyui-video': stopped };
const after = { image: running('comfyui-image', ['0']), text: stopped, 'comfyui-video': running('comfyui-video', ['1']) };

async function mockControl(page: Page, { admin = true, configured = true } = {}) {
  const posts: Array<{ path: string; body: unknown }> = [];
  let runtimes: Record<string, unknown> = before;
  if (!admin) await page.route('**/api/accounts/status', (route) => route.fulfill({ json: { ok: true, mode: 'multi-user', signedIn: true, account: { id: 'artist-id', role: 'user', generationProfiles: [], features: {} } } }));
  await page.route('**/api/ai-control**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') posts.push({ path, body: route.request().postDataJSON() });
    if (path === '/api/ai-control') return route.fulfill({ json: { ok: true, configured, admin } });
    if (path === '/api/ai-control/status') return route.fulfill({ json: configured ? { ok: true, configured, admin, status: { updated: '', gpus, runtimes, job: null }, catalogue } : { ok: true, configured: false } });
    if (!admin) return route.fulfill({ status: 403, json: { ok: false, error: 'Only administrators can change what the GPUs run.' } });
    if (path === '/api/ai-control/plan') return route.fulfill({ json: { ok: true, plan: { keep: ['image'], stop: ['text'], start: [{ profile: 'comfyui-video', runtime: 'comfyui-video', devices: ['1'] }], signature: 'f'.repeat(64) } } });
    if (path === '/api/ai-control/apply') return route.fulfill({ status: 202, json: { ok: true, job: { id: 'job1', state: 'running', stage: 'Preparing' } } });
    if (path === '/api/ai-control/jobs/job1') { runtimes = after; return route.fulfill({ json: { ok: true, job: { id: 'job1', state: 'completed', stage: 'Ready' } } }); }
    return route.fulfill({ status: 404, json: { ok: false } });
  });
  return posts;
}

async function openWorkers(page: Page) {
  await page.goto('/');
  await studioUi(page).openSettings();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Workers', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'AI Control', exact: true })).toBeVisible();
  return dialog;
}

const gpuRow = (dialog: Locator, name: string) => dialog.locator('.set-row').filter({ has: dialog.page().getByText(name, { exact: true }) });

/** The phone's own picker on a phone, the studio's select on the desktop. */
async function choose(page: Page, dialog: Locator, label: string, value: string, name: string) {
  if (await studioUi(page).isPhone()) { await dialog.getByLabel(label).selectOption(value); return; }
  await dialog.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('an administrator previews a GPU change, confirms the interruption and follows it in the status pill', async ({ page }) => {
  const posts = await mockControl(page);
  const dialog = await openWorkers(page);
  await expect(gpuRow(dialog, 'GPU 2')).toContainText('Radeon AI PRO R9700 · Ready');
  await choose(page, dialog, 'GPU 2 Workload', 'comfyui-video:1', 'ComfyUI Video');
  // The preview reads inline before anything changes.
  const changes = dialog.getByRole('group', { name: 'Unsaved Changes' });
  await expect(changes).toContainText('Stops Radiance - Gemma 4 31B. Starts ComfyUI Video on GPU 2. Keeps ComfyUI Image.');
  await expect(gpuRow(dialog, 'GPU 2')).toContainText('Now Radiance - Gemma 4 31B');
  expect(posts.map((post) => post.path)).toEqual(['/api/ai-control/plan']);
  expect(posts[0].body).toEqual({ allocation: [{ profile: 'comfyui-image', devices: ['0'] }, { profile: 'comfyui-video', devices: ['1'] }] });

  await changes.getByRole('button', { name: 'Apply', exact: true }).click();
  // The preview above already said what stops: Apply applies at once, with no question.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => posts.find((post) => post.path === '/api/ai-control/apply')?.body).toEqual({ allocation: [{ profile: 'comfyui-image', devices: ['0'] }, { profile: 'comfyui-video', devices: ['1'] }], signature: 'f'.repeat(64) });
  await expect(page.locator('[data-status-message]').filter({ hasText: 'GPU change applied' }).first()).toBeVisible();
  await expect(changes).toHaveCount(0);
  if (!await studioUi(page).isPhone()) await expect(dialog.getByRole('combobox', { name: 'GPU 2 Workload' })).toContainText('ComfyUI Video');
  else await expect(dialog.getByLabel('GPU 2 Workload')).toHaveValue('comfyui-video:1');
});

test('ordinary accounts see what each GPU runs, read only, under Workers', async ({ page }) => {
  const posts = await mockControl(page, { admin: false });
  const dialog = await openWorkers(page);
  await expect(dialog.getByRole('heading', { name: 'Image Worker' })).toHaveCount(0);
  await expect(gpuRow(dialog, 'GPU 1')).toContainText('ComfyUI Image');
  await expect(gpuRow(dialog, 'GPU 2')).toContainText('Radiance - Gemma 4 31B');
  await expect(dialog.getByLabel('GPU 1 Workload')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Restart/ })).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('without AI Control an administrator reads Not Connected', async ({ page }) => {
  await mockControl(page, { configured: false });
  const dialog = await openWorkers(page);
  await expect(dialog.locator('.set-row').filter({ hasText: 'CONTROL_URL' })).toContainText('Not Connected');
});
