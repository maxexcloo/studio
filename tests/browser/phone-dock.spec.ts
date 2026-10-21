import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const items = Array.from({ length: 24 }, (_, index) => ({ id: `dock-${index}`, url: picture, filename: `dock-${index}.png`, type: 'image', status: 'done', prompt: 'Dock picture', model: 'Flux', settings: { loras: [{ name: 'Film' }] }, createdAt: new Date(Date.UTC(2026, 0, 1) - index * 60000).toISOString(), width: 512, height: 512 }));

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone dock.');
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

const searchButton = (page) => page.getByRole('button', { name: 'Search Gallery', exact: true });
const filterButton = (page) => page.getByRole('button', { name: 'Open Gallery Filters', exact: true });
const searchField = (page) => page.getByRole('textbox', { name: 'Search Gallery', exact: true });
const filterRow = (page) => page.getByRole('group', { name: 'Gallery Filters', exact: true });

test('the search row opens under the top bar, as tall as its icons and full width', async ({ page }) => {
  await page.goto('/');
  await searchButton(page).click();
  const field = page.locator('.phone-tools-field');
  await expect(field).toBeVisible();
  await page.waitForTimeout(300);
  const icon = (await searchButton(page).boundingBox())!;
  const row = (await field.boundingBox())!;
  expect(Math.abs(row.height - icon.height)).toBeLessThan(1);
  expect(row.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
  // Full width, less its close button.
  expect(row.width).toBeGreaterThan(page.viewportSize()!.width - 80);
});

test('search and filters share one row: opening one collapses the other to its icon', async ({ page }) => {
  await page.goto('/');
  await searchButton(page).click();
  await expect(searchField(page)).toBeVisible();
  await expect(searchButton(page)).toHaveAttribute('aria-expanded', 'true');
  await filterButton(page).click();
  await expect(filterRow(page)).toBeVisible();
  await expect(searchField(page)).toHaveCount(0);
  await expect(searchButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(filterButton(page)).toHaveAttribute('aria-expanded', 'true');
  // The filters keep the desktop's order on one line that scrolls sideways.
  const names = await filterRow(page).locator('.gallery-filter-select:not(.phone-filter-clear)').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
  expect(names).toEqual(['Starred', 'Models', 'LoRAs', 'Size', 'Aspect Ratio']);
  // Then the gallery view controls, as on the desktop (Grid Autoplay only where there are videos), and Clear last.
  const row = await filterRow(page).locator('button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || node.textContent?.trim()));
  expect(row.slice(names.length)).toEqual(['Hide Failed & Queued', 'Auto-Grouping', 'Clear Filters']);
  expect(await filterRow(page).evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto');
  await searchButton(page).click();
  await expect(filterRow(page)).toHaveCount(0);
  await expect(searchField(page)).toBeVisible();
});

test('an applied query or filter tints the collapsed icon with a count', async ({ page }) => {
  await page.goto('/');
  await searchButton(page).click();
  await searchField(page).fill('Dock');
  await expect(searchButton(page)).toHaveClass(/is-active/);
  await filterButton(page).click();
  await filterRow(page).getByRole('button', { name: 'Starred' }).click();
  await filterRow(page).getByRole('button', { name: 'Filter By Model', exact: true }).click();
  await page.getByRole('option', { name: 'Flux', exact: true }).click();
  // Search is collapsed to its icon and still says a query is applied.
  await expect(searchButton(page).locator('.phone-tool-count')).toHaveText('1');
  await expect(filterButton(page).locator('.phone-tool-count')).toHaveText('2');
  expect(await searchButton(page).evaluate((node) => getComputedStyle(node).color)).not.toBe(await page.getByRole('button', { name: 'Menu', exact: true }).evaluate((node) => getComputedStyle(node).color));
});

test('closing the shared row clears the query and every filter', async ({ page }) => {
  await page.goto('/');
  await searchButton(page).click();
  await searchField(page).fill('Dock');
  await filterButton(page).click();
  await filterRow(page).getByRole('button', { name: 'Starred' }).click();
  await page.getByRole('button', { name: 'Clear Filters', exact: true }).click();
  await expect(filterRow(page)).toHaveCount(0);
  await expect(searchButton(page)).not.toHaveClass(/is-active/);
  await expect(filterButton(page)).not.toHaveClass(/is-active/);
  await filterButton(page).click();
  await expect(filterRow(page).getByRole('button', { name: 'Starred' })).toHaveAttribute('aria-pressed', 'false');
  await filterButton(page).click();
  // Its icon and Escape close and clear too.
  await searchButton(page).click();
  await searchField(page).fill('Dock');
  await searchButton(page).click();
  await expect(searchField(page)).toHaveCount(0);
  await searchButton(page).click();
  await expect(searchField(page)).toHaveValue('');
  await searchField(page).fill('Dock');
  await page.keyboard.press('Escape');
  await expect(searchField(page)).toHaveCount(0);
  await expect(searchButton(page)).not.toHaveClass(/is-active/);
});

test('a picker opened from Create pops up over it, one at a time, with Create in view behind', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  const create = page.locator('.phone-sheet.phone-create');
  await page.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced Settings', exact: true });
  await expect(advanced).toHaveClass(/is-pop/);
  // Create stays in view behind it, dimmed and not touchable (UI-PATTERNS › Layering).
  await expect(create).toHaveClass(/is-overlaid/);
  await expect(create).toHaveCSS('pointer-events', 'none');
  await expect(create).toBeVisible();
  // One dimmed page behind, however deep.
  await expect.poll(() => page.locator('.phone-sheet-backdrop:not(.is-nested)').count()).toBe(1);
  // Only one pop-up at a time.
  await expect(page.locator('.reference-popover.is-pop')).toHaveCount(1);
  // Close sits on the right of the pop-up's head.
  const close = advanced.getByRole('button', { name: 'Close Advanced Settings', exact: true });
  const head = (await advanced.locator('.reference-popover-head').boundingBox())!;
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.x + closeBox.width).toBeGreaterThan(head.x + head.width - 16);
  await close.click();
  await expect(advanced).toHaveCount(0);
  await expect(create).not.toHaveClass(/is-overlaid/);
  await expect(page.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible();
});
