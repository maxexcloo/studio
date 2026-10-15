import { expect, test } from '@playwright/test';

test('Normal instances hide the preset library on desktop and phone', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  await page.route('**/api/models', async (route) => {
    await route.fulfill({ json: { ...models, features: { ...models.features, presets: false } } });
  });
  await page.goto('/');
  await expect(page.locator('.phone-create-open, .gallery-generation-mode').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Image & Model Library', exact: true })).toHaveCount(0);
});

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#527b8f"/><circle cx="256" cy="250" r="110" fill="#a3c0b0"/></svg>');
const preset = {
  id: '42', galleryItemId: 'civitai:42', name: 'Civitai 42', sourceUrl: 'https://civitai.com/images/42', thumbnailUrl: picture,
  creator: 'Example Artist', baseModel: 'Flux.1', prompt: 'A watercolour landscape at dawn', negative: 'blur',
  resources: [{ versionId: 17, name: 'Flux Schnell', type: 'Checkpoint', folder: 'checkpoints', file: 'flux1-schnell.safetensors', supported: true, localName: 'flux1-schnell.safetensors', profileId: 'mock-flux-schnell', status: 'installed', weight: null }, { versionId: 19, name: 'Film Grain', type: 'LORA', folder: 'loras', file: 'film_grain_35mm.safetensors', supported: true, localName: 'film_grain_35mm.safetensors', status: 'installed', weight: 0 }],
  settings: { width: 768, height: 1024, steps: 4, cfg: 1, seed: '0', sampler: 'euler', scheduler: 'simple' }, warnings: []
};

test('import, reopen and apply image settings on desktop and phone', async ({ page, isMobile }, testInfo) => {
  let saved: typeof preset[] = [];
  await page.route('**/api/presets', (route) => route.fulfill({ json: { ok: true, presets: saved, downloads: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } }));
  await page.route('**/api/presets/import', async (route) => { saved = [preset]; await route.fulfill({ json: { ok: true, preset } }); });
  await page.route('**/api/presets/resolve', (route) => route.fulfill({ json: { ok: true, preset: saved[0] || preset } }));
  await page.route('**/api/library/downloads', (route) => route.fulfill({ json: { downloads: [], access: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Image & Model Library', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Image & Model Library' });
  await dialog.getByLabel('Image Link').fill('https://civitai.com/images/42');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByText('A watercolour landscape at dawn', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Installed', { exact: true })).toHaveCount(2);
  await expect(dialog.getByLabel('Preset Name')).toHaveCount(0);
  await expect(dialog.getByLabel('Use With Model')).toHaveCount(0);
  await expect(dialog.getByText(/Civitai Access|managed at the computer/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Civitai 42/ })).toBeVisible();
  await dialog.getByRole('button', { name: /Civitai 42/ }).click();
  await expect(dialog.getByRole('button', { name: 'Use Settings', exact: true })).toBeEnabled();
  const dimensions = await dialog.evaluate((element) => ({ width: element.getBoundingClientRect().width, viewport: innerWidth, scroll: element.scrollWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.screenshot({ path: testInfo.outputPath('preset-review.png') });
  await dialog.getByRole('button', { name: 'Use Settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let generated: Record<string, unknown> | null = null;
  await page.route('**/api/generate', async (route) => { generated = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { ok: false, error: 'Test request captured' } }); });
  if (isMobile) {
    await page.locator('.phone-create-open').click();
    await page.locator('.phone-create').getByRole('button', { name: 'Generate', exact: true }).click();
  } else await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated!.prompt).toBe(preset.prompt);
  expect(String(generated!.seed)).toBe('0');
  expect(generated!.width).toBe(768);
  expect(generated!.height).toBe(1024);
  expect(generated!.loras).toEqual([{ name: 'film_grain_35mm.safetensors', strength: 0, enabled: true }]);
});

test('missing LoRAs and filename conflicts remain explicit and download errors are recoverable', async ({ page }) => {
  const missing = { ...preset, downloadWarnings: ['Civitai requires access to this resource.'], resources: [...preset.resources, { versionId: 18, name: 'Watercolour Style', type: 'LORA', folder: 'loras', file: 'style.safetensors', supported: true, status: 'missing', localName: '', weight: 0.7 }] };
  await page.route('**/api/presets', (route) => route.fulfill({ json: { presets: [], downloads: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } }));
  await page.route('**/api/presets/import', (route) => route.fulfill({ json: { preset: missing } }));
  await page.route('**/api/library/downloads', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, json: { ok: false, error: 'Civitai requires access to this resource.' } })
    : route.fulfill({ json: { downloads: [], access: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Image & Model Library', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Image & Model Library' });
  await dialog.getByLabel('Image Link').fill('https://civitai.com/images/42');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Use Settings', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Civitai requires access to this resource.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Download Missing Files/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry Missing Files', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Civitai requires access to this resource.');
  await expect(dialog.getByRole('button', { name: 'Use Prompt Only', exact: true })).toBeEnabled();
  await page.route('**/api/presets/resolve', (route) => route.fulfill({ json: { preset: { ...missing, resources: missing.resources.map((item) => item.versionId === 18 ? { ...item, status: 'conflict' } : item) } } }));
  await dialog.getByRole('button', { name: 'Check Again', exact: true }).click();
  await expect(dialog.getByText('Filename Conflict', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Download Missing Files/ })).toHaveCount(0);
});

test('model links preview their destination before download', async ({ page }) => {
  let queued: unknown;
  await page.route('**/api/presets', (route) => route.fulfill({ json: { presets: [], downloads: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } }));
  await page.route('**/api/library/downloads/preview', async (route) => {
    expect(route.request().postDataJSON().folder).toBe('loras');
    await route.fulfill({ json: { file: { id: 'civitai:19:3', file: 'film.safetensors', folder: 'loras', label: 'Film', bytes: 100000000 } } });
  });
  await page.route('**/api/library/downloads', async (route) => {
    if (route.request().method() === 'POST') { queued = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, download: { status: 'queued' } } }); }
    else await route.fulfill({ json: { downloads: [], access: { available: true, backend: 'local', note: 'Downloads enter ComfyUI.' } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Image & Model Library', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Image & Model Library' });
  await dialog.getByRole('radio', { name: 'Models', exact: true }).click();
  await dialog.getByLabel('Model Or LoRA Link').fill('https://civitai.com/models/9?modelVersionId=19');
  await dialog.getByRole('button', { name: 'Preview Download', exact: true }).click();
  await expect(dialog.getByText('film.safetensors', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => queued).toEqual({ id: 'civitai:19:3' });
});
