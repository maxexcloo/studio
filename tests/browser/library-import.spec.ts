import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * Library › Import with a mocked API: a Civitai LoRA link becomes a graded
 * record with its files, Download Missing queues them in one tap and the
 * Downloads page shows them running; paid files stay unavailable with the
 * reason; a failed link goes to the status pill and stays in the history.
 * A dropped image shows its recipe, a substitute with Use Exact File, and
 * Use Prompt; a bare image is described by AI (or refused without vision);
 * offers download only when chosen; updates show in LoRAs › Updates and as
 * a dot on the dock icon.
 */

async function openLibrary(page: Page) {
  const ui = studioUi(page);
  if (await ui.isPhone()) {
    await ui.openMore();
    // Update Available adds a count to the menu item ("Library (1)").
    await page.getByRole('menuitem', { name: /^Library( \(\d+\))?$/ }).click();
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

test('an import from chat shows in the history as from chat, with its grade and missing files', async ({ page }) => {
  const fromChat = { ...loraRecord, id: 'imp-chat01', origin: 'chat' };
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [fromChat] } }));
  await page.route('**/api/library/imports/imp-chat01', (route) => route.fulfill({ json: { ok: true, import: fromChat } }));
  await page.route('**/api/models/downloads', (route) => route.fulfill({ json: noDownloads }));
  await page.goto('/');
  const dialog = await openLibrary(page);
  const row = dialog.getByRole('button', { name: /Watercolour Style/ });
  await expect(row).toContainText('From Chat');
  await expect(row).toContainText('1 Missing');
  await expect(row).toContainText('Partial');
  await row.click();
  await expect(dialog.locator('.set-page-head p')).toContainText('From Chat');
  await expect(dialog.getByText('watercolour-v2.safetensors', { exact: true })).toBeVisible();
});

/* ------------------------------------------------------- Image imports */

const pngBytes = fs.readFileSync(new URL('../../server/fixtures/images/a1111.png', import.meta.url));
async function dropImage(page: Page, target: Locator, name = 'fox.png') {
  const dataTransfer = await page.evaluateHandle(({ file, data }) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file, { type: 'image/png' }));
    return transfer;
  }, { file: name, data: pngBytes.toString('base64') });
  await target.dispatchEvent('drop', { dataTransfer });
}
const substituteResource = {
  role: 'checkpoint', name: 'DreamShaper', version: '8', supported: true, matchedBy: 'hash', status: 'substitute', profileId: '', exactInstalled: false,
  want: { file: 'dreamshaper_8.safetensors', folder: 'checkpoints', sha256: 'c'.repeat(64), bytes: 2_000_000_000, source: { provider: 'civitai', url: 'https://civitai.com/models/4384?modelVersionId=128713' } },
  substitute: { file: 'dreamshaper_9.safetensors', folder: 'checkpoints', kind: 'version', reason: 'Version 9 instead of 8' }
};
const imageRecord = {
  id: 'imp-img001', createdAt: '2026-10-21T11:00:00.000Z', by: 'admin', origin: 'ui', state: 'ready', picture: true,
  input: { kind: 'image-file', fileName: 'fox.png', format: 'png' }, title: 'fox',
  preset: { prompt: 'a watercolour fox in a misty forest', negative: 'blurry', settings: { steps: 28, cfg: 6.5, seed: '1234', width: 832, height: 1216, sampler: 'dpmpp_2m' }, warnings: [] },
  recipe: { source: 'a1111', negativeUsed: true, approximate: [], extraProcessing: false },
  resources: [substituteResource, { role: 'lora', name: 'Watercolour Style', status: 'installed', strength: 0.8, matchedBy: 'hash', want: { file: 'watercolour-v2.safetensors', folder: 'loras', sha256: 'a'.repeat(64), bytes: 228_000_000, source: { provider: 'civitai' } } }],
  offers: [], grade: { value: 'close', reasons: ['DreamShaper uses a substitute: Version 9 instead of 8'], missingFields: [] }, results: { catalogueKeys: [] }
};

test('a dropped image shows its recipe; a substitute is marked, and Use Exact File swaps it back', async ({ page }) => {
  let history: unknown[] = [];
  let uploaded: { image?: string; name?: string } | null = null;
  let current: Record<string, unknown> = imageRecord;
  let exact: unknown = null;
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: history, vision: { available: true, reason: '' } } }));
  await page.route('**/api/library/imports/image', async (route) => {
    uploaded = route.request().postDataJSON();
    history = [imageRecord];
    await route.fulfill({ json: { ok: true, import: imageRecord } });
  });
  await page.route('**/api/library/imports/imp-img001', (route) => route.fulfill({ json: { ok: true, import: current } }));
  await page.route('**/api/library/imports/imp-img001/picture', (route) => route.fulfill({ body: pngBytes, contentType: 'image/png' }));
  await page.route('**/api/library/imports/imp-img001/exact', async (route) => {
    exact = route.request().postDataJSON();
    current = { ...imageRecord, resources: [{ ...substituteResource, status: 'installed', substitute: undefined, exactInstalled: undefined }, imageRecord.resources[1]], grade: { value: 'exact', reasons: ['Every file is installed and verified, and the prompt and settings are complete'], missingFields: [] } };
    await route.fulfill({ json: { ok: true, import: current } });
  });
  await page.goto('/');
  const dialog = await openLibrary(page);
  await dropImage(page, dialog.locator('form.library-drop'));
  await expect.poll(() => uploaded?.name).toBe('fox.png');
  expect(uploaded!.image!.startsWith('data:image/png;base64,')).toBe(true);
  await expect(statusPill(page).filter({ hasText: 'Imported' })).toBeVisible();

  // The recipe: picture, prompt, negative and settings, read from A1111 metadata.
  await expect(dialog.getByRole('heading', { name: 'fox', exact: true })).toBeVisible();
  await expect(dialog.getByText('A1111 Metadata · PNG · fox.png')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Imported image' })).toBeVisible();
  await expect(dialog.locator('.library-prompt').first()).toContainText('a watercolour fox in a misty forest');
  await expect(dialog.locator('.library-settings')).toContainText('CFG6.5');
  await expect(dialog.getByLabel('Grade')).toContainText('Close');
  await expect(dialog.getByLabel('Grade')).toContainText('DreamShaper uses a substitute: Version 9 instead of 8');

  // The stand-in is marked, with its reason; the exact file can be downloaded, not yet used.
  const model = dialog.locator('.library-resource').filter({ hasText: 'dreamshaper_8.safetensors' });
  await expect(model).toContainText('Substitute');
  await expect(model).toContainText('Using dreamshaper_9.safetensors · Another Version: Version 9 instead of 8');
  await expect(model.getByRole('button', { name: 'Download Exact File dreamshaper_8.safetensors' })).toBeVisible();
  await expect(model.getByRole('button', { name: 'Use Exact File' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Describe with AI' })).toBeEnabled();

  // The exact file lands: Use Exact File swaps it back and the grade rises.
  current = { ...imageRecord, resources: [{ ...substituteResource, exactInstalled: true }, imageRecord.resources[1]] };
  await dialog.getByRole('button', { name: 'Check Again' }).click();
  await model.getByRole('button', { name: 'Use Exact File' }).click();
  await expect.poll(() => exact).toEqual({ index: 0 });
  await expect(statusPill(page).filter({ hasText: 'Using the exact file' })).toBeVisible();
  await expect(model).toContainText('Installed');
  await expect(dialog.getByLabel('Grade')).toContainText('Exact');

  // Use Prompt sends the recorded prompt to the composer.
  await dialog.getByRole('button', { name: 'Use Prompt', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statusPill(page).filter({ hasText: 'Prompt applied' })).toBeVisible();
  if (!await studioUi(page).isPhone()) await expect(studioUi(page).prompt).toHaveValue('a watercolour fox in a misty forest');
});

test('a bare image is described by AI and graded Partial; without vision it says why', async ({ page }) => {
  const described = {
    ...imageRecord, id: 'imp-dsc001', input: { kind: 'described', fileName: 'photo.png', format: 'png' }, title: 'photo', recipe: undefined,
    preset: { prompt: 'a painted fox in fog', negative: '', settings: {} }, suggestion: { profileId: 'flux', profileLabel: 'Flux Dev', model: 'vision-model' },
    resources: [{ role: 'lora', name: 'watercolour-v2.safetensors', status: 'installed', suggested: true, optional: true, unsourced: true, note: 'Suggested by the assistant', want: { file: 'watercolour-v2.safetensors', folder: 'loras', sha256: '' } }],
    grade: { value: 'partial', reasons: ['Described by AI; no recorded settings', 'Suggested profile: Flux Dev'], missingFields: [] }
  };
  let vision = { available: true, reason: '' };
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [], vision } }));
  await page.route('**/api/library/imports/image', (route) => route.fulfill({ json: { ok: true, import: vision.available ? described : { ...imageRecord, id: 'imp-bad001', state: 'failed', error: 'This image has no generation metadata. The assistant model can’t read images.', resources: [] } } }));
  await page.route('**/api/library/imports/imp-dsc001', (route) => route.fulfill({ json: { ok: true, import: described } }));
  await page.route('**/api/library/imports/imp-dsc001/picture', (route) => route.fulfill({ body: pngBytes, contentType: 'image/png' }));
  await page.goto('/');
  let dialog = await openLibrary(page);
  await dialog.getByTestId('library-image-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(statusPill(page).filter({ hasText: 'Described by AI. Check the prompt' })).toBeVisible();
  await expect(dialog.getByText('Described by AI · vision-model · PNG · photo.png')).toBeVisible();
  await expect(dialog.getByLabel('Grade')).toContainText('Partial');
  await expect(dialog.getByLabel('Grade')).toContainText('Described by AI; no recorded settings');
  await expect(dialog.getByLabel('Grade')).toContainText('Suggested profile: Flux Dev');
  await expect(dialog.locator('.library-resource').filter({ hasText: 'watercolour-v2.safetensors' })).toContainText('Suggested');
  await expect(dialog.getByRole('button', { name: 'Use Settings' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Use Prompt', exact: true })).toBeEnabled();

  vision = { available: false, reason: 'The assistant model can’t read images. Choose a vision model in Settings › Models › Integrations.' };
  await page.goto('/');
  dialog = await openLibrary(page);
  await expect(dialog.getByText('Images without metadata can’t be described: The assistant model can’t read images. Choose a vision model in Settings › Models › Integrations.')).toBeVisible();
  await dropImage(page, dialog.locator('form.library-drop'), 'photo.png');
  await expect(statusPill(page).filter({ hasText: 'This image has no generation metadata.' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
});

test('offers list other versions that fit; one downloads only when chosen, paid ones stay refused', async ({ page }) => {
  const offers = [
    { key: 'civitai:21:32', label: 'V2', relation: 'precision', file: 'watercolour-v2-fp8.safetensors', folder: 'loras', bytes: 114_000_000, baseModel: 'Krea 2', variant: 'FP8', url: 'https://civitai.com/models/9?modelVersionId=20', downloadable: true },
    { key: 'civitai:30:41', label: 'V3 Paid', relation: 'newer', file: 'watercolour-v3.safetensors', folder: 'loras', bytes: 228_000_000, baseModel: 'Krea 2', variant: 'SafeTensors', url: 'https://civitai.com/models/9?modelVersionId=30', downloadable: false, unavailable: { reason: 'paid', note: 'Downloads cost 500 Buzz on Civitai.' } }
  ];
  const record = { ...loraRecord, id: 'imp-off001', offers };
  let taken: unknown = null;
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [record] } }));
  await page.route('**/api/library/imports/imp-off001', (route) => route.fulfill({ json: { ok: true, import: record } }));
  await page.route('**/api/library/imports/imp-off001/offers', async (route) => {
    taken = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, queued: 1, failures: [], import: { ...record, offers: [{ ...offers[0], taken: true }, offers[1]] } } });
  });
  await page.goto('/');
  const dialog = await openLibrary(page);
  await dialog.getByRole('button', { name: /Watercolour Style/ }).click();
  const group = dialog.locator('.set-group').filter({ has: page.getByRole('heading', { name: 'Other Versions', exact: true }) });
  await expect(group.locator('.library-offer')).toHaveCount(2);
  const fp8 = group.locator('.library-offer').filter({ hasText: 'watercolour-v2-fp8.safetensors' });
  await expect(fp8).toContainText('Other Precision · V2 · FP8 · Krea 2 · 114 MB');
  const paidOffer = group.locator('.library-offer').filter({ hasText: 'watercolour-v3.safetensors' });
  await expect(paidOffer).toContainText('Unavailable · Paid');
  await expect(paidOffer).toContainText('Downloads cost 500 Buzz on Civitai.');
  await expect(paidOffer.getByRole('button')).toHaveCount(0);
  expect(taken).toBeNull();
  await fp8.getByRole('button', { name: 'Download watercolour-v2-fp8.safetensors' }).click();
  await expect.poll(() => taken).toEqual({ index: 0 });
  await expect(statusPill(page).filter({ hasText: 'watercolour-v2-fp8.safetensors queued' })).toBeVisible();
  await expect(fp8).toContainText('Chosen');
});

test('updates show in LoRAs › Updates and as a dot on the Library icon, and download only on Update', async ({ page }) => {
  const update = { state: 'available', note: 'V3 is newer than V2.', latest: { name: 'V3', file: 'watercolour-v3.safetensors', bytes: 228_000_000, downloadable: true } };
  let applied: unknown = null;
  let items = [
    { key: 'loras/watercolour-v2.safetensors', folder: 'loras', file: 'watercolour-v2.safetensors', kind: 'lora', installed: true, title: 'Watercolour Style', version: 'V2', origin: 'import', source: { provider: 'civitai', modelId: 9, versionId: 20 }, update },
    { key: 'loras/turbo.safetensors', folder: 'loras', file: 'turbo.safetensors', kind: 'lora', installed: true, title: 'Turbo', origin: 'seed', update: { state: 'current' } }
  ];
  let checks = 0;
  await page.route('**/api/models**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, features: { ...json.features, libraryUpdates: applied ? 0 : 1 } } });
  });
  await page.route('**/api/library/items', (route) => route.fulfill({ json: { ok: true, items, updates: { checkedAt: '2026-10-21T09:30:00.000Z', available: applied ? 0 : 1 } } }));
  await page.route('**/api/library/imports', (route) => route.fulfill({ json: { ok: true, imports: [] } }));
  await page.route('**/api/library/updates/check', (route) => { checks += 1; return route.fulfill({ json: { ok: true, checkedAt: '2026-10-21T10:00:00.000Z', available: 1, byEntry: {}, applied: {} } }); });
  await page.route('**/api/library/updates/apply', async (route) => {
    applied = route.request().postDataJSON();
    items = [{ ...items[0], applied: { state: 'downloading', note: 'Downloading V3.', to: { file: 'watercolour-v3.safetensors', name: 'V3' } } }, items[1]];
    await route.fulfill({ json: { ok: true, applied: {}, available: 1, byEntry: {} } });
  });
  await page.goto('/');
  const ui = studioUi(page);
  if (await ui.isPhone()) {
    await ui.openMore();
    await expect(page.getByRole('menuitem', { name: 'Library (1)' })).toBeVisible();
    await page.keyboard.press('Escape');
  } else {
    await ui.prompt.click();
    await expect(page.getByRole('button', { name: 'Library', exact: true }).locator('.library-update-dot')).toBeVisible();
  }
  const dialog = await openLibrary(page);
  await section(dialog, 'LoRAs').click();
  const rows = dialog.locator('.library-item');
  await expect(rows.filter({ hasText: 'Watercolour Style' })).toContainText('Update Available');
  await dialog.getByRole('group', { name: 'LoRAs View' }).getByRole('button', { name: /^Updates/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Update Available: V3 · 228 MB');
  await expect(dialog.getByText(/^Checked .+ Studio checks once a day and never downloads an update on its own\.$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Check Updates' }).click();
  await expect(statusPill(page).filter({ hasText: '1 update available' })).toBeVisible();
  expect([checks, applied]).toEqual([1, null]);
  await rows.first().getByRole('button', { name: 'Update Watercolour Style to V3' }).click();
  await expect.poll(() => applied).toEqual({ key: 'loras/watercolour-v2.safetensors', alternative: false });
  await expect(rows.first()).toContainText('Updating…');
  await expect(rows.first()).toContainText('Downloading V3.');
});
