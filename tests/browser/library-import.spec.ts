import { expect, test, type Locator, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * Library › Import with a mocked API: a Civitai LoRA link becomes a graded
 * record with its files, Download Missing queues them in one tap and the
 * Downloads page shows them running; paid files stay unavailable with the
 * reason; a failed link goes to the status pill and stays in the history.
 */

async function openLibrary(page: Page) {
  const ui = studioUi(page);
  if (await ui.isPhone()) {
    await ui.openMore();
    await page.getByRole('menuitem', { name: 'Library', exact: true }).click();
  } else {
    await ui.prompt.click();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
  }
  return page.getByRole('dialog', { name: 'Library' });
}
const section = (dialog: Locator, name: string) => dialog.getByRole('navigation', { name: 'Library Sections' }).getByRole('button', { name: new RegExp(`^${name}`) });
const statusPill = (page: Page) => page.locator('[data-status-message]');

const sha = 'a'.repeat(64);
const loraResource = {
  role: 'lora', name: 'Watercolour Style', version: 'V2', supported: true, status: 'missing', note: '',
  want: { file: 'watercolour-v2.safetensors', folder: 'loras', sha256: sha, bytes: 228_000_000, source: { provider: 'civitai', modelId: 9, versionId: 20, url: 'https://civitai.com/models/9?modelVersionId=20' } }
};
const loraRecord = {
  id: 'imp-lora01', createdAt: '2026-10-21T10:00:00.000Z', by: 'admin', origin: 'ui', state: 'needs-files',
  input: { kind: 'civitai-model', url: 'https://civitai.com/models/9?modelVersionId=20' },
  title: 'Watercolour Style', version: 'V2', baseModel: 'Krea 2', modelType: 'LORA',
  links: { civitaiCom: 'https://civitai.com/models/9?modelVersionId=20', civitaiRed: 'https://civitai.red/models/9?modelVersionId=20' },
  resources: [loraResource], offers: [],
  grade: { value: 'partial', reasons: ['Watercolour Style isn’t installed'], missingFields: [] },
  results: { catalogueKeys: ['loras/watercolour-v2.safetensors'] }
};
const paidRecord = {
  ...loraRecord, id: 'imp-paid01', createdAt: '2026-10-21T09:00:00.000Z', title: 'Paid Style', version: 'V3', input: { kind: 'civitai-model', url: 'https://civitai.com/models/9' },
  resources: [{ ...loraResource, name: 'Paid Style', version: 'V3', supported: false, status: 'unavailable', want: { ...loraResource.want, file: 'paid-v3.safetensors' }, unavailable: { reason: 'paid', note: 'Downloads cost 500 Buzz on Civitai.', freeAlternative: { versionId: 20, name: 'V2', url: 'https://civitai.com/models/9?modelVersionId=20' } } }],
  grade: { value: 'partial', reasons: ['Paid Style is paid on Civitai'], missingFields: [] }
};
const noDownloads = { ok: true, active: null, queued: [], recent: [], paused: [] };

test('a Civitai LoRA link is graded, lists its missing file and downloads it in one tap', async ({ page }) => {
  let history: unknown[] = [paidRecord];
  let downloads: Record<string, unknown> = noDownloads;
  let queued: unknown = null;
  await page.route('**/api/library/imports', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { ok: true, imports: history } });
    expect(route.request().postDataJSON()).toEqual({ url: loraRecord.input.url });
    history = [loraRecord, ...history];
    return route.fulfill({ json: { ok: true, import: loraRecord } });
  });
  await page.route('**/api/library/imports/imp-lora01', (route) => route.fulfill({ json: { ok: true, import: queued ? { ...loraRecord, state: 'downloading', resources: [{ ...loraResource, status: 'downloading', downloadId: 'civitai:20:31' }] } : loraRecord } }));
  await page.route('**/api/library/imports/imp-paid01', (route) => route.fulfill({ json: { ok: true, import: paidRecord } }));
  await page.route('**/api/library/imports/imp-lora01/download', async (route) => {
    queued = route.request().postDataJSON();
    downloads = { ...noDownloads, active: { id: 'civitai:20:31', file: 'watercolour-v2.safetensors', folder: 'loras', label: 'Watercolour Style', status: 'downloading', receivedBytes: 57_000_000, totalBytes: 228_000_000 } };
    await route.fulfill({ json: { ok: true, queued: 1, failures: [], import: { ...loraRecord, state: 'downloading', resources: [{ ...loraResource, status: 'downloading', downloadId: 'civitai:20:31', progress: { receivedBytes: 0, totalBytes: 228_000_000 } }] } } });
  });
  await page.route('**/api/models/downloads', (route) => route.request().method() === 'GET' ? route.fulfill({ json: downloads }) : route.fallback());
  await page.goto('/');
  const dialog = await openLibrary(page);

  // Import opens first: one field, then the history with each import's grade.
  await expect(dialog.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  await expect(section(dialog, 'Import')).toHaveAttribute('aria-current', 'page');
  await expect(dialog.getByRole('navigation', { name: 'Library Sections' }).getByRole('button')).toHaveText(['Import', 'Images', 'LoRAs', 'Models', 'Downloads']);
  const paidRow = dialog.getByRole('button', { name: /Paid Style/ });
  await expect(paidRow).toContainText('Partial');

  await dialog.getByLabel('Link', { exact: true }).fill(loraRecord.input.url);
  await dialog.locator('form').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(statusPill(page).filter({ hasText: 'Imported. Its catalogue entry is written' })).toBeVisible();

  // The record: grade and reasons, both Civitai links, then Files with status, size and source.
  await expect(dialog.getByRole('heading', { name: 'Watercolour Style', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Grade')).toContainText('Partial');
  await expect(dialog.getByLabel('Grade')).toContainText('Watercolour Style isn’t installed');
  await expect(dialog.getByRole('link', { name: 'View Watercolour Style on civitai.com' })).toHaveAttribute('href', loraRecord.links.civitaiCom);
  await expect(dialog.getByRole('link', { name: 'View Watercolour Style on civitai.red' })).toHaveAttribute('href', loraRecord.links.civitaiRed);
  const file = dialog.locator('.library-resource').filter({ hasText: 'watercolour-v2.safetensors' });
  await expect(file).toContainText('LoRAs · V2 · 228 MB · Civitai');
  await expect(file).toContainText('Missing');
  await expect(dialog.locator('.set-note').filter({ hasText: 'Its catalogue entry is written' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Download Missing', exact: true }).click();
  await expect.poll(() => queued).toEqual({});
  await expect(statusPill(page).filter({ hasText: 'Missing file queued' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download Missing', exact: true })).toHaveCount(0);
  await expect(file).toContainText(/Downloading/);

  // Back to Import, then Downloads: the file runs with the shared bar and Cancel.
  await dialog.locator('.library-back').click();
  await expect(dialog.getByRole('button', { name: /Watercolour Style/ })).toBeVisible();
  await section(dialog, 'Downloads').click();
  const running = dialog.locator('.set-group').filter({ has: page.getByRole('heading', { name: 'Running', exact: true }) });
  await expect(running.locator('.library-download')).toContainText('Watercolour Style');
  await expect(running.locator('.library-download')).toContainText('25%');
  await expect(running.locator('.set-progress')).toBeVisible();
  await expect(running.getByRole('button', { name: 'Cancel watercolour-v2.safetensors' })).toBeVisible();
  const box = await dialog.evaluate((element) => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth }));
  expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
});

test('paid files show as unavailable with the reason and a free version, and never offer a download', async ({ page }) => {
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [paidRecord] } }));
  await page.route('**/api/library/imports/imp-paid01', (route) => route.fulfill({ json: { ok: true, import: paidRecord } }));
  await page.goto('/');
  const dialog = await openLibrary(page);
  await dialog.getByRole('button', { name: /Paid Style/ }).click();
  const file = dialog.locator('.library-resource').filter({ hasText: 'paid-v3.safetensors' });
  await expect(file).toContainText('Unavailable · Paid');
  await expect(file).toContainText('Downloads cost 500 Buzz on Civitai.');
  await expect(file.getByRole('link', { name: 'Free version: V2' })).toHaveAttribute('href', 'https://civitai.com/models/9?modelVersionId=20');
  await expect(dialog.getByLabel('Grade')).toContainText('Paid Style is paid on Civitai');
  await expect(dialog.getByRole('button', { name: 'Download Missing', exact: true })).toHaveCount(0);
  await expect(file.getByRole('button')).toHaveCount(0);
});

test('a link that can’t be imported says why in the status pill and stays in the history', async ({ page }) => {
  const failed = { ...loraRecord, id: 'imp-fail01', state: 'failed', title: '', input: { kind: 'hf-repo', url: 'https://huggingface.co/org/gated' }, resources: [], error: 'This repository is gated or private. Accept its terms on Hugging Face and add a token to the deployment.', grade: { value: 'partial', reasons: ['This repository is gated or private.'], missingFields: [] }, results: { catalogueKeys: [] } };
  let history: unknown[] = [];
  await page.route('**/api/library/imports', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { ok: true, imports: history } });
    history = [failed];
    return route.fulfill({ json: { ok: true, import: failed } });
  });
  await page.goto('/');
  const dialog = await openLibrary(page);
  await expect(dialog.getByText('No Imports Yet', { exact: true })).toBeVisible();
  await dialog.getByLabel('Link', { exact: true }).fill(failed.input.url);
  await dialog.locator('form').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(statusPill(page).filter({ hasText: 'This repository is gated or private.' })).toBeVisible();
  const row = dialog.getByRole('button', { name: /huggingface\.co\/org\/gated/ });
  await expect(row).toContainText('Failed');
  await expect(dialog.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
});

test('LoRAs and Models list what is installed and catalogued, with provenance, links and a search', async ({ page }) => {
  const items = [
    { key: 'loras/watercolour-v2.safetensors', folder: 'loras', file: 'watercolour-v2.safetensors', kind: 'lora', installed: true, title: 'Watercolour Style', version: 'V2', baseModel: 'Krea 2', families: ['krea2'], role: 'effect', triggers: ['wtrclr'], strength: { default: 0.8 }, links: loraRecord.links, source: { provider: 'civitai', modelId: 9, versionId: 20 }, origin: 'import', bytes: 228_000_000 },
    { key: 'loras/turbo.safetensors', folder: 'loras', file: 'turbo.safetensors', kind: 'lora', installed: true, title: 'Turbo', role: 'acceleration', families: ['flux'], origin: 'seed' },
    { key: 'loras/later.safetensors', folder: 'loras', file: 'later.safetensors', kind: 'lora', installed: false, title: 'Later', origin: 'import' },
    { key: 'vae/ae.safetensors', folder: 'vae', file: 'ae.safetensors', kind: 'vae', installed: true, origin: 'manifest', source: { provider: 'manifest' }, links: { hf: 'https://huggingface.co/org/repo' } },
    { key: 'checkpoints/base.safetensors', folder: 'checkpoints', file: 'base.safetensors', kind: 'checkpoint', installed: true }
  ];
  await page.route('**/api/library/items', (route) => route.fulfill({ json: { ok: true, items } }));
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [] } }));
  await page.goto('/');
  const dialog = await openLibrary(page);
  await section(dialog, 'LoRAs').click();
  const rows = dialog.locator('.library-item');
  await expect(rows).toHaveCount(2);
  const water = rows.filter({ hasText: 'Watercolour Style' });
  await expect(water).toContainText('Effect LoRA · V2 · Krea 2 · 228 MB');
  await expect(water).toContainText('Civitai · Imported');
  await expect(water).toContainText('Trigger Words: wtrclr · Strength 0.8');
  await expect(water.getByRole('link', { name: 'View Watercolour Style on civitai.red' })).toBeVisible();
  await dialog.getByRole('group', { name: 'Family' }).getByRole('button', { name: 'flux', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Acceleration Adapter');
  await dialog.getByRole('group', { name: 'Family' }).getByRole('button', { name: 'All', exact: true }).click();
  await dialog.getByRole('button', { name: 'Search LoRAs', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Search LoRAs' }).fill('water');
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close Search', exact: true }).click();
  await dialog.getByRole('group', { name: 'LoRAs View' }).getByRole('button', { name: 'Catalogue', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Later' })).toContainText('Not Installed');

  await section(dialog, 'Models').click();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'ae.safetensors' })).toContainText('Manifest · From the Manifest');
  await dialog.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'VAE', exact: true }).click();
  await expect(rows).toHaveCount(1);
});
