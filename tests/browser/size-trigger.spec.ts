import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

// The Size trigger never cuts its label short, whichever resolution is picked.
for (const width of [1440, 980]) test(`the size trigger fits its label across resolution tiers (${width})`, async ({ page, isMobile }) => {
  await page.setViewportSize({ width, height: 1000 });
  test.skip(isMobile, 'The phone shows Size as a Create row.');
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
    profile.native = { '2k': 'yes', '4k': 'yes' };
    profile.constraints.width = { min: 64, max: 8192, step: 16 };
    profile.constraints.height = { min: 64, max: 8192, step: 16 };
    profile.mediaInputs = [];
    profile.capabilities.startImageRequired = false;
  }
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  const trigger = page.locator('.aspect-trigger');
  const clipped = () => trigger.evaluate((button) => [button, ...button.querySelectorAll<HTMLElement>('.aspect-trigger-label, .aspect-tag')]
    .some((node) => node.scrollWidth > node.clientWidth + 0.5 || (node !== button && node.getBoundingClientRect().right > button.getBoundingClientRect().right - 2)));
  for (const tier of ['2K', '4K', 'Default']) {
    const menu = await ui.openSizeMenu();
    await menu.getByRole('radiogroup', { name: 'Resolution', exact: true }).getByRole('radio', { name: tier, exact: true }).click();
    expect(await clipped(), `${tier} while open`).toBe(false);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(await clipped(), `${tier} after closing`).toBe(false);
  }
});
