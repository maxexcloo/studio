import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';
import { fakeKeyboard, focusedOnly, raiseKeyboard } from './helpers/text-focus';

test.describe('focused text on the phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'The phone Create sheet.');
  test.beforeEach(async ({ page }) => { await fakeKeyboard(page); });

  test('a focused Prompt shows only itself above the keyboard, and Done puts it back', async ({ page }) => {
    await page.goto('/');
    await focusedOnly(page, 'Prompt');
  });

  test('a focused Negative Prompt shows only itself above the keyboard, and Done puts it back', async ({ page }) => {
    await page.goto('/');
    await focusedOnly(page, 'Negative Prompt');
  });

  test('Back and a blur close the focused field too', async ({ page }) => {
    await page.goto('/');
    const ui = studioUi(page);
    const sheet = await ui.openComposer();
    const field = sheet.getByRole('textbox', { name: 'Prompt', exact: true });
    await field.fill('A quiet harbour');
    await field.focus();
    await raiseKeyboard(page, 336);
    await expect(sheet.locator('.is-text-focused')).toHaveCount(1);
    // The field's own actions keep it open.
    await sheet.locator('.is-text-focused').getByRole('button', { name: 'Select All of the Prompt', exact: true }).click();
    await expect(field).toBeFocused();
    await expect(sheet.locator('.is-text-focused')).toHaveCount(1);
    await page.goBack();
    await expect(sheet.locator('.is-text-focused')).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await field.blur();
    await field.focus();
    await expect(sheet.locator('.is-text-focused')).toHaveCount(1);
    await field.blur();
    await expect(sheet.locator('.is-text-focused')).toHaveCount(0);
    // Without the keyboard (a hardware keyboard) a focused field leaves the sheet as it is.
    await raiseKeyboard(page, 0);
    await field.focus();
    await expect(sheet.locator('.is-text-focused')).toHaveCount(0);
    await expect(sheet.locator('.create-options')).toBeVisible();
  });
});
