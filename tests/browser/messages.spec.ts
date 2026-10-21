import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = Array.from({ length: 6 }, (_, index) => ({ id: `image-${index}`, url: `${picture}#${index}`, filename: `image-${index}.png`, type: 'image', status: 'done', prompt: `Image ${index}`, width: 512, height: 512 }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [] : images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

// One message pattern (UI-PATTERNS › Messages): one pill at a time, questions inline in it, Undo inside it.
test('deleting several items acts at once and Undo follows in the one pill', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const tile = (id: number) => page.locator(`[data-tile-id="image-${id}"] .tile`);
  const pills = page.locator('[data-status-message]').filter({ visible: true });
  await expect(tile(0)).toBeVisible();
  await ui.enterSelection();
  await tile(0).click();
  await tile(1).click();
  await ui.selectionBar.getByRole('button', { name: 'Delete Selected', exact: true }).click();

  // Deleting is undoable, so it acts at once: no question, then Undo in the one pill.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('.modal-scrim')).toHaveCount(0);
  await expect(tile(0)).toHaveCount(0);
  const undo = pills.filter({ hasText: '2 items deleted' });
  await expect(undo).toBeVisible();
  await expect(pills).toHaveCount(1);
  await undo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tile(0)).toBeVisible();
  await expect(tile(1)).toBeVisible();
  await expect(pills).toHaveCount(0);
});

// The phone has one pill for the whole app (UI-PATTERNS › Messages): the top of the screen, centred,
// outside every box and header, over sheets and pop-ups, never over the controls it asks about.
test('the phone shows every message at the top of the screen, over sheets, the viewer and Settings', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone’s status pill.');
  await page.route('**/api/gallery/favorite', (route) => route.fulfill({ status: 403, json: { ok: false, reason: 'origin', error: 'Blocked a request from another website.' } }));
  await page.goto('/');
  const ui = studioUi(page);
  const pill = page.locator('.phone-status [data-status-message]');
  const width = await page.evaluate(() => innerWidth);
  const centred = async () => { const box = (await pill.boundingBox())!; return Math.abs(box.x + box.width / 2 - width / 2) < 1.5 && box.y < 60; };
  const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

  // The main screen: the bar's own row steps aside for it.
  await ui.enterSelection();
  await page.locator('[data-tile-id="image-0"] .tile').click();
  await ui.selectionBar.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  await expect(pill.filter({ hasText: 'deleted' })).toBeVisible();
  expect(await centred()).toBe(true);
  await expect(page.locator('.phone-bar-row.has-message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop Selecting' })).toBeHidden();
  await pill.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pill).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop Selecting' }).click();

  // Over the viewer: a long message wraps whole, and Close stays in reach.
  const viewer = await ui.openViewer(page.locator('[data-tile-id="image-1"] .tile'));
  await viewer.getByRole('button', { name: /^(Star|Unstar)$/ }).filter({ visible: true }).first().click();
  const failure = pill.filter({ hasText: 'Couldn’t save the star: Blocked a request from another website. (HTTP 403, origin)' });
  await expect(failure).toBeVisible();
  expect(await centred()).toBe(true);
  expect(await failure.locator('.status-pill-text').evaluate((text) => text.scrollWidth <= text.clientWidth + 0.5 && text.scrollHeight <= text.clientHeight + 0.5)).toBe(true);
  const close = viewer.getByRole('button', { name: /^Close( Viewer)?$/ }).filter({ visible: true }).first();
  expect(apart((await failure.boundingBox())!, (await close.boundingBox())!)).toBe(true);
  await failure.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await ui.closeViewer();

  // A question in Settings: Cancel and the answer in the pill, its text under it, clear of the button that asked.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Maintenance/ }).first().click();
  const reset = page.locator('#settings-panel').getByRole('button', { name: 'Reset', exact: true });
  await reset.click();
  const question = page.getByRole('alertdialog', { name: 'Reset All Settings?' });
  await expect(question).toBeVisible();
  expect(await centred()).toBe(true);
  expect(apart((await question.boundingBox())!, (await reset.boundingBox())!)).toBe(true);
  expect(apart((await question.locator('.status-pill-panel').boundingBox())!, (await reset.boundingBox())!)).toBe(true);
  // Above Settings, and touching it leaves Settings open.
  expect(await question.evaluate((node) => Number(getComputedStyle(node.closest('.phone-status')!).zIndex))).toBeGreaterThan(await page.locator('.modal-scrim').evaluate((node) => Number(getComputedStyle(node).zIndex)));
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(page.locator('.settings-modal')).toBeVisible();
});
