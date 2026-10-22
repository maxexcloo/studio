import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

// WebKit, the engine iOS uses: a tapped row is never focused, so each pop-up must find its row another way.
test.use({ browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('WebKit: the Model, LoRAs, Size and Advanced pop-ups open on screen at their row and pick on a tap', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'Runs once, from the phone project.');
  await page.goto('/');
  const ui = studioUi(page);
  const sheet = await ui.openComposer();
  const onScreen = async (surface: ReturnType<typeof page.locator>) => {
    await expect.poll(async () => { const box = await surface.boundingBox(); return Boolean(box && box.y >= 0 && box.y + box.height <= 844 && box.height > 100); }).toBe(true);
  };

  await ui.modelTrigger.tap();
  await onScreen(ui.modelPicker);
  const pick = ui.modelOptions.filter({ hasText: 'Illustrious' }).first();
  await pick.tap();
  await expect(ui.modelPicker).toHaveCount(0);
  await expect(ui.modelTrigger).toContainText('Illustrious');

  await sheet.getByRole('button', { name: 'LoRAs', exact: true }).tap();
  const loras = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  await onScreen(loras);
  await loras.getByText('Anime Watercolor').first().tap();
  await page.keyboard.press('Escape');
  await expect(loras).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'LoRAs', exact: true })).not.toContainText('None');

  for (const [row, title] of [[/^Size:/, 'Size'], [/^Advanced Settings$/, 'Advanced Settings']] as const) {
    await sheet.getByRole('button', { name: row }).tap();
    const pop = page.getByRole('dialog', { name: title, exact: true });
    await onScreen(pop);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  }
});
