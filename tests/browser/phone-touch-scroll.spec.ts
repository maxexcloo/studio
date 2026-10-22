import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = (height: number) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${height}"><rect width="512" height="${height}" fill="#527b8f"/></svg>`);
const items = Array.from({ length: 80 }, (_, index) => {
  const height = [768, 512, 896, 640][index % 4];
  return { id: `touch-${index}`, url: picture(height), filename: `touch-${index}.png`, type: 'image', status: 'done', prompt: `Touch test ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 80 - index)).toISOString(), width: 512, height };
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

/** A real finger drag up the screen, through Chromium's touch input rather than a scripted scroll. */
async function swipeUp(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const x = 200, from = 640, to = 260;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * step) / 10 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const scrollTop = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollTop);

async function expectScrolls(page: Page, how: 'touch' | 'wheel') {
  const before = await scrollTop(page);
  if (how === 'touch') await swipeUp(page);
  else { await page.mouse.move(200, 500); await page.mouse.wheel(0, 400); }
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 100);
}

test('the phone gallery scrolls by touch and wheel, also after the viewer and Create close', async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Phone touch scrolling through Chromium touch input.');
  await page.goto('/');
  const ui = studioUi(page);
  await expect(page.locator('[data-tile-id="touch-0"]')).toBeVisible();
  // Nothing on the phone's main screen stops the document from scrolling.
  await expectScrolls(page, 'touch');
  await expectScrolls(page, 'wheel');

  // Once the fling settles, tap the tile in the middle of the screen.
  await page.waitForTimeout(800);
  await page.touchscreen.tap(100, 450);
  await expect(ui.viewer).toBeVisible();
  await ui.closeViewer();
  await page.waitForTimeout(300);
  await expectScrolls(page, 'touch');

  await ui.openComposer();
  await ui.closeComposer();
  await page.waitForTimeout(300);
  await expectScrolls(page, 'touch');
});

/** A one-finger drag between two points on the screen. */
async function drag(page: Page, x: number, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * step) / 8 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('on the phone a swipe up opens Details and a swipe down closes them, then the viewer', async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Phone touch through Chromium touch input.');
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openViewer(page.locator('[data-tile-id="touch-0"]'));
  const details = page.locator('.viewer-side');
  const canvas = await page.locator('.viewer-canvas').boundingBox();
  const middle = canvas!.y + canvas!.height / 2;
  await drag(page, 200, middle + 60, middle - 140);
  await expect(details).toBeVisible();
  const sheet = await details.boundingBox();
  await drag(page, 200, sheet!.y + 30, sheet!.y + 200);
  await expect(details).toBeHidden();
  await expect(ui.viewer).toBeVisible();
  await page.waitForTimeout(450);
  await drag(page, 200, middle - 100, middle + 120);
  await expect(ui.viewer).toBeHidden();
});
