import { expect, type Page } from '@playwright/test';
import { studioUi } from './ui';

// The on-screen keyboard is emulated by shrinking the viewport to the room above it.
const KEYBOARD_UP = { width: 390, height: 480 };

export async function focusedOnly(page: Page, label: 'Prompt' | 'Negative Prompt') {
  const ui = studioUi(page);
  const sheet = await ui.openComposer();
  await page.setViewportSize(KEYBOARD_UP);
  const field = sheet.getByRole('textbox', { name: label, exact: true });
  await field.focus();
  await field.pressSequentially('A lighthouse on a cliff at dusk', { delay: 5 });
  const wrapper = sheet.locator('.composer-prompt-field.is-text-focused');
  await expect(wrapper).toHaveCount(1);
  // Only the field: no other prompt, no rows, no footer, no handle.
  for (const hidden of ['.create-options', '.phone-sheet-foot', '.phone-sheet-grab']) await expect(sheet.locator(hidden)).toBeHidden();
  await expect(sheet.locator('.composer-prompt-field:not(.is-text-focused)')).toBeHidden();
  // It fills the visible height, with the text and its actions in view.
  await expect.poll(async () => (await wrapper.boundingBox())!.height).toBeGreaterThan(KEYBOARD_UP.height * 0.75);
  await expect(field).toBeInViewport();
  await expect(field).toBeFocused();
  const clear = wrapper.getByRole('button', { name: label === 'Prompt' ? 'Clear Prompt' : 'Clear Negative Prompt', exact: true });
  await expect(clear).toBeInViewport();
  const done = wrapper.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeInViewport();
  const box = (await done.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  // Nothing scrolls under it.
  expect(await sheet.locator('.phone-sheet-body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBeLessThanOrEqual(1);
  await done.click();
  await expect(wrapper).toHaveCount(0);
  await expect(field).not.toBeFocused();
  await expect(sheet.locator('.phone-sheet-foot')).toBeVisible();
  await expect(field).toHaveValue(/A lighthouse on a cliff at dusk$/);
}

