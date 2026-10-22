import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockGallery } from './helpers/ui';

/*
 * UI-PATTERNS › Phone › Top bar and Buttons & Icon Bars: "Studio" and the
 * status light beside it (the desktop dock's status dot too) never scroll the
 * gallery, and a tap or click leaves nothing behind: no hover or pressed fill,
 * no focus ring (keyboard focus still shows one).
 */

const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#497e7b"/></svg>');
const items = Array.from({ length: 60 }, (_, index) => ({ id: `tap-${index}`, url: svg, thumbnailUrl: svg, filename: `tap-${index}.png`, type: 'image', status: 'done', prompt: `Tap ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 60 - index)).toISOString(), width: 512, height: 640 }));

async function scrolled(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage-gallery');
    return stage && stage.scrollHeight > stage.clientHeight + 1 && getComputedStyle(stage).overflowY !== 'visible' ? stage.scrollTop : document.scrollingElement!.scrollTop;
  });
}

/** What a control looks like now: its fills, ring and shadow. */
const look = (control: Locator) => control.evaluate((element) => {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, image: style.backgroundImage, outline: style.outlineStyle === 'none' ? 'none' : `${style.outlineStyle} ${style.outlineColor}`, shadow: style.boxShadow, border: style.borderColor };
});

test('tapping Studio and its status light keeps the gallery where it is and leaves no fill or ring', async ({ page, isMobile }) => {
  await mockGallery(page, items);
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage-gallery');
    if (stage && stage.scrollHeight > stage.clientHeight + 1 && getComputedStyle(stage).overflowY !== 'visible') stage.scrollTop = 700;
    else document.scrollingElement!.scrollTop = 700;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await scrolled(page);
  expect(before).toBeGreaterThan(100);
  const controls = isMobile
    ? [page.locator('.phone-heading-name'), page.locator('.phone-heading-light')]
    : [page.locator('.studio-dock .comfy-status-dot')];
  for (const control of controls) {
    const rest = await look(control);
    // Held down, the bare light (and the plain name) shows no pressed box either: they have no fill to darken.
    if (isMobile) {
      const box = (await control.boundingBox())!;
      const session = await page.context().newCDPSession(page);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await page.waitForTimeout(150);
      const held = await look(control);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      expect(held.image).toBe(rest.image);
      expect(held.background).toBe(rest.background);
    }
    if (isMobile) await control.tap(); else await control.click();
    // A desktop pointer moves on; a finger has nowhere to go, so its :hover sticks, which must not show.
    if (!isMobile) await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    expect(await scrolled(page)).toBe(before);
    expect(await look(control)).toEqual(rest);
  }
  // Keyboard focus still shows its ring.
  if (!isMobile) {
    const dot = page.locator('.studio-dock .comfy-status-dot');
    // A key press first, so the focus that follows counts as keyboard focus (:focus-visible).
    await page.keyboard.press('Shift');
    await dot.focus();
    await expect(dot).toBeFocused();
    expect((await look(dot)).outline).not.toBe('none');
  }
});

test('phone top and bottom bar buttons keep no hover fill after a tap', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Sticky hover after a tap is a touch screen matter.');
  await mockGallery(page, items);
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  const before = await scrolled(page);
  // The prompt bar's Images | Videos: tapping the mode already shown changes nothing.
  const images = page.locator('.phone-prompt-bar .phone-gallery-mode button[aria-pressed="true"]').first();
  const rest = await look(images);
  await images.tap();
  await page.waitForTimeout(400);
  expect(await look(images)).toEqual(rest);
  expect(await scrolled(page)).toBe(before);
});
