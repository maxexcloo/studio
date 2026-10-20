import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

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
  integrations: { civitai: { token: { set: true, editable: false }, presets: true }, huggingFace: { token: { set: false, editable: true } } },
  storage: { outputs: 'studio', source: 'default', locked: false, workerToken: true, multiUser: true }
};

test('deployment settings show sources, keep locked values read-only and save the rest', async ({ page }) => {
  const saved: unknown[] = [];
  await page.route('**/api/settings/deployment', (route) => {
    if (route.request().method() === 'POST') { saved.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, setting: { applies: 'restart' } } }); }
    return route.fulfill({ json: settings });
  });
  await page.goto('/');
  await studioUi(page).openSettings();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Workers', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Image Worker' })).toBeVisible();
  const images = dialog.locator('.set-row').filter({ hasText: 'http://comfyui-image:8188' });
  await expect(images).toContainText('Deployment · Locked');
  await expect(dialog.getByRole('button', { name: 'Edit Images Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Edit Videos Address', exact: true }).click();
  await expect(dialog.getByLabel('Videos ComfyUI Address')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await dialog.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Defaults', exact: true })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Default Image Profile' })).toContainText('FLUX.1 Schnell');
  await expect(dialog.getByRole('switch', { name: 'Grok', exact: true })).toBeDisabled();
  await dialog.getByRole('switch', { name: 'LoRAs', exact: true }).click();
  await expect.poll(() => saved).toContainEqual({ key: 'STUDIO_ENABLE_LORAS', value: false });

  // Integrations share the Models page.
  await expect(dialog.locator('.set-row').filter({ hasText: 'Output Storage' })).toContainText('Studio Media');
  await expect(dialog.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Civitai' })).toContainText('On');
});
