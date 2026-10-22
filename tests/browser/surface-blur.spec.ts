import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * UI-PATTERNS › Glass: a glass surface blurs what is behind it from the first
 * frame of its entry, on every open, not once its motion settles. Each probe
 * samples every frame from the press until the surface has settled.
 */

/** Starts sampling, every frame, the backdrop filter of the first element matching `selector`. */
async function watch(page: Page, selector: string) {
  await page.evaluate((selector) => {
    const frames: { present: boolean; blur: string; opacity: number }[] = [];
    const sample = () => {
      const surface = document.querySelector<HTMLElement>(selector);
      const style = surface ? getComputedStyle(surface) : null;
      frames.push({ present: Boolean(surface), blur: style ? (style.backdropFilter || (style as any).webkitBackdropFilter || 'none') : 'none', opacity: style ? Number(style.opacity) : 0 });
      (window as any).__blurFrame = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__blur = frames;
  }, selector);
}

/** Stops sampling: how many frames showed the surface, and how many of those without its blur. */
async function unblurred(page: Page) {
  return page.evaluate(() => {
    cancelAnimationFrame((window as any).__blurFrame);
    const frames: { present: boolean; blur: string }[] = (window as any).__blur;
    const shown = frames.filter((frame) => frame.present);
    return { shown: shown.length, unblurred: shown.filter((frame) => !/blur\((?!0px)/.test(frame.blur)).length };
  });
}

async function settle(page: Page) {
  await page.waitForTimeout(450);
}

test('the model chooser blurs from its first frame, every time it opens', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  const surface = (await ui.isPhone()) ? '.phone-model-pop' : '.model-menu';
  for (let open = 0; open < 2; open++) {
    await watch(page, surface);
    await ui.modelTrigger.click();
    await expect(ui.modelPicker).toBeVisible();
    await settle(page);
    const frames = await unblurred(page);
    expect(frames.shown).toBeGreaterThan(3);
    expect(frames).toEqual({ shown: frames.shown, unblurred: 0 });
    await page.keyboard.press('Escape');
    await expect(ui.modelPicker).toHaveCount(0);
  }
});

test('the size menu blurs from its first frame, every time it opens', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone Size list is the pop-up sheet, covered by the model chooser probe.');
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  for (let open = 0; open < 2; open++) {
    await watch(page, '.aspect-menu');
    await ui.openSizeMenu();
    await settle(page);
    const frames = await unblurred(page);
    expect(frames.shown).toBeGreaterThan(3);
    expect(frames).toEqual({ shown: frames.shown, unblurred: 0 });
    await page.keyboard.press('Escape');
    await expect(ui.sizeMenu).toHaveCount(0);
  }
});

test('the phone Create sheet and Menu blur from their first frame', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone sheets and the phone Menu.');
  await page.goto('/');
  const ui = studioUi(page);
  await ui.composerSettled();
  await watch(page, '.phone-sheet.phone-create');
  await page.locator('.phone-create-open').click();
  await expect(ui.composer).toBeVisible();
  await settle(page);
  let frames = await unblurred(page);
  expect(frames.shown).toBeGreaterThan(3);
  expect(frames).toEqual({ shown: frames.shown, unblurred: 0 });
  await ui.closeComposer();
  await watch(page, '.phone-menu');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(ui.more).toBeVisible();
  await settle(page);
  frames = await unblurred(page);
  expect(frames.shown).toBeGreaterThan(3);
  expect(frames).toEqual({ shown: frames.shown, unblurred: 0 });
});

test('a dialog scrim blurs from its first frame', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await expect(page.locator('.phone-shell, .app-shell')).toHaveCount(1);
  await watch(page, '.modal-scrim');
  await ui.openSettings();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await settle(page);
  const frames = await unblurred(page);
  expect(frames.shown).toBeGreaterThan(3);
  expect(frames).toEqual({ shown: frames.shown, unblurred: 0 });
});
