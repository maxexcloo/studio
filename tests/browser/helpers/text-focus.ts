import { expect, type Page } from '@playwright/test';
import { studioUi } from './ui';

/**
 * The on-screen keyboard, emulated as iOS Safari has it: only the visual
 * viewport shrinks (composer.spec.ts does the same). Call before goto, then
 * `raiseKeyboard(page, 336)`.
 */
export async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    const state = { height: innerHeight };
    for (const [key, read] of Object.entries({ height: () => state.height, offsetLeft: () => 0, offsetTop: () => 0, scale: () => 1, width: () => innerWidth })) Object.defineProperty(viewport, key, { get: read });
    Object.defineProperty(window, 'visualViewport', { get: () => viewport });
    Object.assign(window, { keyboard: (height: number) => { state.height = innerHeight - height; viewport.dispatchEvent(new Event('resize')); } });
  });
}

export async function raiseKeyboard(page: Page, height: number) {
  await page.evaluate((value) => (window as unknown as { keyboard: (height: number) => void }).keyboard(value), height);
}

/** Focuses a Create field with the keyboard up, checks only it shows above the keyboard, then Done. */
export async function focusedOnly(page: Page, label: 'Prompt' | 'Negative Prompt') {
  const ui = studioUi(page);
  const sheet = await ui.openComposer();
  const field = sheet.getByRole('textbox', { name: label, exact: true });
  // Where Create's top rests, once it has stopped moving: the focused box lines up with it.
  let sheetTop = -1;
  await expect.poll(async () => { const y = (await sheet.boundingBox())!.y; const still = Math.abs(y - sheetTop) < 0.1; sheetTop = y; return still; }, { intervals: [150] }).toBe(true);
  const normal = await sheet.locator(`.composer-prompt-field${label === 'Prompt' ? ':not(.is-negative)' : '.is-negative'}`).evaluate((node) => { const style = getComputedStyle(node); return { radius: style.borderTopLeftRadius, fill: style.backgroundColor }; });
  await field.focus();
  await raiseKeyboard(page, 336);
  await field.pressSequentially('A lighthouse on a cliff at dusk', { delay: 5 });
  const visible = await page.evaluate(() => innerHeight - 336);
  const wrapper = sheet.locator('.composer-prompt-field.is-text-focused');
  await expect(wrapper).toHaveCount(1);
  // Only the field: no other prompt, no rows, no footer, no handle.
  for (const hidden of ['.create-options', '.phone-sheet-foot', '.phone-sheet-grab']) await expect(sheet.locator(hidden)).toBeHidden();
  await expect(sheet.locator('.composer-prompt-field:not(.is-text-focused)')).toBeHidden();
  // It fills the room above the keyboard, with the text and its actions in it.
  await expect.poll(async () => { const box = (await wrapper.boundingBox())!; return box.height > visible * 0.8 && box.y + box.height <= visible + 1; }).toBe(true);
  // The normal prompt box (its border, corners and fill), its top where Create's top was, the screen's
  // width less a margin; the text runs its full width under the actions, never beside them.
  const focusedBox = (await wrapper.boundingBox())!;
  expect(Math.abs(focusedBox.y - sheetTop)).toBeLessThanOrEqual(1);
  expect(focusedBox.width).toBeGreaterThanOrEqual(await page.evaluate(() => innerWidth) - 20);
  const look = await wrapper.evaluate((node) => { const style = getComputedStyle(node); return { border: parseFloat(style.borderTopWidth), colour: style.borderTopColor, radius: style.borderTopLeftRadius, fill: style.backgroundColor }; });
  expect(look.border).toBeGreaterThanOrEqual(1);
  expect(look.colour).not.toBe('rgba(0, 0, 0, 0)');
  expect(look.radius).toBe(normal.radius);
  expect(look.fill).toBe(normal.fill);
  const text = await field.evaluate((node) => { const style = getComputedStyle(node); const tools = node.parentElement!.querySelector('.composer-field-tools')!.getBoundingClientRect(); const own = node.getBoundingClientRect(); return { width: own.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), textTop: own.top + parseFloat(style.paddingTop), toolsBottom: tools.bottom }; });
  expect(text.width).toBeGreaterThan(focusedBox.width - 40);
  expect(text.textTop).toBeGreaterThanOrEqual(text.toolsBottom);
  await expect(field).toBeFocused();
  const inside = async (box: { y: number; height: number } | null) => Boolean(box) && box!.y >= 0 && box!.y + box!.height <= visible + 1;
  expect(await inside(await field.boundingBox())).toBe(true);
  const clear = wrapper.getByRole('button', { name: label === 'Prompt' ? 'Clear Prompt' : 'Clear Negative Prompt', exact: true });
  expect(await inside(await clear.boundingBox())).toBe(true);
  const done = wrapper.getByRole('button', { name: 'Done', exact: true });
  const box = await done.boundingBox();
  expect(await inside(box)).toBe(true);
  expect(box!.height).toBeGreaterThanOrEqual(43.9);
  // Nothing scrolls under it.
  expect(await sheet.locator('.phone-sheet-body').evaluate((body) => body.scrollHeight - body.clientHeight)).toBeLessThanOrEqual(1);
  await done.click();
  await raiseKeyboard(page, 0);
  await expect(wrapper).toHaveCount(0);
  await expect(field).not.toBeFocused();
  await expect(sheet.locator('.phone-sheet-foot')).toBeVisible();
  await expect(field).toHaveValue(/A lighthouse on a cliff at dusk$/);
}
