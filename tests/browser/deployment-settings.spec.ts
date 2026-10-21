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
    { key: 'HEISS_ENABLE_INPAINT', label: 'Inpainting', description: 'Painting over part of a reference image.', value: true, defaultOn: true, applies: 'restart', source: 'default', locked: false }
  ],
  integrations: { civitai: { token: { set: true, editable: false }, presets: true }, huggingFace: { token: { set: false, editable: true } } },
  storage: { outputs: 'studio', source: 'default', locked: false, workerToken: true, multiUser: true }
};

test('deployment settings show sources, keep locked values read-only and save the rest', async ({ page }) => {
  await page.route('**/api/settings/deployment', (route) => route.fulfill({ json: settings }));
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
  // Upscale Status is its own group at the end of Workers, and no longer in Studio.
  await expect(dialog.locator('#settings-panel .list-section-title').last()).toHaveText('Upscale');
  await expect(dialog.locator('.set-row').filter({ hasText: 'Upscale Status' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Studio', exact: true }).click();
  await expect(dialog.locator('#settings-panel .list-section-title')).toHaveText(['Features', 'Gallery', 'General', 'Generation', 'Sharing']);
  await expect(dialog.getByText('Upscale Status', { exact: true })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Defaults', exact: true })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Default Image Profile' })).toContainText('FLUX.1 Schnell');
  // LoRAs, Cloud Models and presets are access-profile features now: no Catalogue switches here.
  await expect(dialog.getByRole('heading', { name: 'Catalogue', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('switch')).toHaveCount(0);

  // Integrations share the Models page.
  await expect(dialog.locator('.set-row').filter({ hasText: 'Output Storage' })).toContainText('Studio Media');
  await expect(dialog.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Civitai' })).toContainText('On');
});

test('rows that only leave Studio show plain links, sorted where a list has no other order', async ({ page }) => {
  await page.goto('/');
  await studioUi(page).openSettings();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'About', exact: true }).click();
  const credits = dialog.locator('.set-group').filter({ has: page.getByRole('heading', { name: 'Credits', exact: true }) });
  await expect(credits.locator('.list-row-label')).toHaveText(['ComfyUI', 'HEISS UI', 'J-AI Studio by Jasper', 'Radiance']);
  for (const name of ['ComfyUI', 'HEISS UI', 'J-AI Studio', 'Radiance']) {
    const link = credits.getByRole('link', { name, exact: true });
    await expect(link).toHaveClass(/set-link/);
    await expect(link).not.toHaveClass(/btn/);
  }
  await expect(dialog.getByRole('link', { name: 'Changelog', exact: true })).toHaveClass(/set-link/);
  await dialog.getByRole('button', { name: 'Maintenance', exact: true }).click();
  await expect(dialog.locator('#settings-panel .list-section-title')).toHaveText(['Clean Up', 'Help', 'Reset']);
  const help = dialog.locator('.set-row').filter({ hasText: 'Troubleshooting' }).getByRole('link', { name: 'Open', exact: true });
  await expect(help).toHaveClass(/set-link/);
  await expect(help).toHaveAttribute('target', '_blank');
});
