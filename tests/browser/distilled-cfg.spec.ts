import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

// Distilled profiles run at their own guidance (capabilities.cfg false): CFG 3 on Tesserafine Fast made photo-negative images.
test('a distilled profile hides CFG in Advanced Settings and never sends one', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  base.capabilities = { ...base.capabilities, cfg: false };
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  let body: Record<string, unknown> | null = null;
  await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Captured' } }); });
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await composer.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced Settings', exact: true });
  await expect(advanced.getByText('Sampler', { exact: true })).toBeVisible();
  await expect(advanced.getByText('Prompt Strength (CFG)', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(advanced).toHaveCount(0);
  await ui.prompt.fill('A lighthouse at dusk');
  await ui.generate.click();
  await expect.poll(() => body).not.toBeNull();
  expect(body).not.toHaveProperty('cfg');
});
