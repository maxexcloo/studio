import { expect, test } from '@playwright/test';

const settings = {
  ok: true,
  connections: [
    { backend: 'primary', label: 'Images', key: 'COMFY_URL', value: 'http://comfyui-image:8188', source: 'deployment', locked: true, routes: 'Image workflows and provider-backed video' },
    { backend: 'video', label: 'Videos', key: 'COMFY_VIDEO_URL', value: '', source: 'default', locked: false, routes: 'Uses the image connection' }
  ],
  defaults: {
    image: { key: 'STUDIO_DEFAULT_IMAGE_PROFILE', configured: 'mock-flux-schnell', effective: 'mock-flux-schnell', source: 'deployment', locked: true },
    video: { key: 'STUDIO_DEFAULT_VIDEO_PROFILE', configured: '', effective: 'mock-wan-video', source: 'default', locked: false },
    profiles: [{ id: 'mock-flux-schnell', label: 'FLUX.1 Schnell', kind: 'image', ready: true }, { id: 'mock-wan-video', label: 'Wan Video', kind: 'video', ready: true }]
  },
  catalogue: [
    { key: 'STUDIO_ENABLE_LORAS', label: 'LoRAs', description: 'LoRA browsing.', value: true, defaultOn: true, applies: 'restart', source: 'default', locked: false },
    { key: 'STUDIO_ENABLE_GROK', label: 'Grok', description: 'Grok workflows.', value: false, defaultOn: true, applies: 'restart', source: 'deployment', locked: true }
  ],
  integrations: { civitai: { browsing: false, token: { set: true, editable: false }, presets: true }, huggingFace: { token: { set: false, editable: true } } },
  storage: { outputs: 'studio', source: 'default', locked: false, workerToken: true, multiUser: true }
};

test('deployment settings show sources, keep locked values read-only and save the rest', async ({ page, isMobile }) => {
  const saved: unknown[] = [];
  await page.route('**/api/settings/deployment', (route) => {
    if (route.request().method() === 'POST') { saved.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, setting: { applies: 'restart' } } }); }
    return route.fulfill({ json: settings });
  });
  await page.goto('/');
  if (isMobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: /Use the full studio/ }).click();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Generation Connections' })).toBeVisible();
  const images = dialog.locator('.set-row').filter({ hasText: 'http://comfyui-image:8188' });
  await expect(images).toContainText('Deployment · Locked');
  await expect(dialog.getByRole('button', { name: 'Edit Images Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Edit Videos Address', exact: true }).click();
  await expect(dialog.getByLabel('Videos ComfyUI address')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await dialog.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Model Defaults' })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Default Image Profile' })).toContainText('FLUX.1 Schnell');
  await expect(dialog.getByRole('switch', { name: 'Grok', exact: true })).toBeDisabled();
  await dialog.getByRole('switch', { name: 'LoRAs', exact: true }).click();
  await expect.poll(() => saved).toContainEqual({ key: 'STUDIO_ENABLE_LORAS', value: false });

  await dialog.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Output Storage' })).toContainText('Studio Media');
  await expect(dialog.getByRole('heading', { name: 'Civitai' })).toBeVisible();
});

test('the model manifest reports problems and restores what it can', async ({ page, isMobile }) => {
  const posts: string[] = [];
  const items = [
    { path: 'models/comfyui/loras/good.safetensors', size: 4, status: 'verified' },
    { path: 'models/comfyui/loras/missing.safetensors', size: 4, status: 'missing', restorable: true },
    { path: 'models/comfyui/SEEDVR2/model.safetensors', size: 4, status: 'missing', restoreNote: 'Studio doesn’t download into SEEDVR2' },
    { path: 'models/comfyui/vae/changed.safetensors', size: 4, status: 'mismatch' }
  ];
  await page.route('**/api/models/manifest**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') { posts.push(url.pathname); return route.fulfill({ json: { ok: true, queued: ['models/comfyui/loras/missing.safetensors'], skipped: [] } }); }
    return route.fulfill({ json: { ok: true, source: 'deployment', total: 4, counts: { verified: 1, present: 0, missing: 2, 'wrong-size': 0, mismatch: 1, external: 0 }, restorable: 1, items, verify: { running: false, done: 0, total: 0, current: '', error: '' } } });
  });
  await page.goto('/');
  if (isMobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: /Use the full studio/ }).click();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Model Manifest' })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: '4 Models' })).toContainText('2 missing');
  await expect(dialog.locator('.set-row').filter({ hasText: 'SEEDVR2/model.safetensors' })).toContainText('Studio doesn’t download into SEEDVR2');
  await expect(dialog.locator('.set-row').filter({ hasText: 'vae/changed.safetensors' })).toContainText('Checksum Mismatch');
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => posts).toContain('/api/models/manifest/restore');
});
