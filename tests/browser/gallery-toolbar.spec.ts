import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test.use({ launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), ignoreDefaultArgs: ['--hide-scrollbars'] } });

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const items = Array.from({ length: 8 }, (_, index) => ({ id: `toolbar-${index}`, url: picture, filename: `toolbar-${index}.png`, type: 'image', status: 'done', prompt: 'Toolbar picture', model: 'Flux', settings: { workflow: 'Portrait', loras: [{ name: 'Film' }] }, createdAt: '2026-01-01T00:00:00Z', width: 512, height: 512 }));

// A narrow or short window with a mouse keeps the full studio; a touch screen that size is a phone.
test.describe('with a mouse', () => {
  test.use({ hasTouch: false });
  test('gallery tools expand independently and clear every active filter', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Phone gallery tools use the compact header.');
    await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.goto('/');
    const toolbar = page.locator('.gallery-toolbar');
    const search = page.getByRole('textbox', { name: 'Search Gallery', exact: true });
    const clear = toolbar.getByRole('button', { name: 'Clear Search', exact: true });
    const filters = toolbar.getByRole('button', { name: 'Gallery Filters', exact: true });
    const select = toolbar.getByRole('button', { name: 'Select', exact: true });
    const grouping = toolbar.getByRole('button', { name: 'Auto-Grouping', exact: true });
    await expect(search).toHaveCount(0);
    await expect(clear).toHaveCount(0);
    await expect(grouping).toBeVisible();
    await expect(select).toHaveAttribute('aria-expanded', 'false');
    await expect(select).toBeEnabled();
    expect(await select.evaluate(n => getComputedStyle(n).opacity)).toBe('1');
    await expect(toolbar.getByRole('group', { name: 'Gallery Mode' }).getByRole('button', { name: 'Images', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await filters.click();
    const filterTools = toolbar.getByRole('group', { name: 'Gallery Filters', exact: true });
    await expect(filterTools.getByRole('button', { name: 'Starred', exact: true })).toBeVisible();
    await expect.poll(() => filterTools.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Filter By Model' }).scrollIntoViewIfNeeded();
    expect(await page.getByRole('main').evaluate(n => n.scrollLeft)).toBe(0);
    await expect(toolbar.getByRole('button', { name: 'Search Gallery', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Filter By Model' }).click();
    await page.getByRole('option', { name: 'Flux', exact: true }).click();
    await expect(clear).toHaveCount(0);
    await expect(search).toHaveCount(0);
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: 'Clear Filters', exact: true }).click();
    await expect(clear).toHaveCount(0);
    if (!await search.count()) await toolbar.getByRole('button', { name: 'Search Gallery', exact: true }).click();
    await search.fill('picture');
    await expect(search).toBeFocused();
    expect((await page.locator('.gallery-search').boundingBox())!.width).toBeLessThanOrEqual(260);
    await clear.click();
    await select.click();
    await expect(toolbar.getByRole('button', { name: 'Stop Selecting' })).toHaveAttribute('aria-expanded', 'true');
    await expect(toolbar.getByRole('button', { name: 'Stop Selecting' })).toHaveText('0 Selected');
    await toolbar.getByRole('button', { name: 'Select All' }).click();
    await expect(toolbar.getByRole('status')).toHaveText('8 Selected');
    const centred = await toolbar.locator('.gallery-selection-actions button').evaluateAll(buttons => buttons.every(button => { const a = button.getBoundingClientRect(), b = button.querySelector('svg')!.getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 0.5 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 0.5; }));
    expect(centred).toBe(true);
    // The view toggles step aside while selecting, so every selection action has room.
    await expect(grouping).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Stop Selecting' }).click();
    await expect(grouping).toBeVisible();
    for (const width of [1440, 900, 640]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await toolbar.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
      await expect(grouping).toBeInViewport();
      await expect(select).toBeInViewport();
    }
  });
});

test('size and aspect filters reach the server and clear with the others', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone filters are covered by the compact header test.');
  const queries: string[] = [];
  await page.route('**/api/gallery?*', route => { queries.push(new URL(route.request().url()).search); return route.fulfill({ json: { items, revision: 1, hasMore: false } }); });
  // Clearing restores the unfiltered page from cache, which only syncs through the delta route.
  await page.route('**/api/gallery/delta?*', route => { queries.push(new URL(route.request().url()).search); return route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }); });
  await page.goto('/');
  const toolbar = page.locator('.gallery-toolbar');
  await toolbar.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Filter By Size', exact: true }).click();
  // Short fixed lists need no search field; the bands say exactly where they start and end.
  await expect(page.getByRole('textbox', { name: /^Search/ }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '1K–1.5K (1025–1536 px)', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Up to 1K (1024 px or less)', exact: true }).click();
  await expect.poll(() => queries.some((query) => query.includes('size=up-to-1k'))).toBe(true);
  await toolbar.getByRole('button', { name: 'Filter By Aspect Ratio', exact: true }).click();
  await page.getByRole('option', { name: 'Other', exact: true }).click();
  await expect.poll(() => queries.some((query) => query.includes('size=up-to-1k') && query.includes('aspect=other'))).toBe(true);
  await expect(toolbar.getByRole('button', { name: 'Filter By Size', exact: true })).toHaveText('Up to 1K');
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await toolbar.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  }
  await toolbar.getByRole('button', { name: 'Clear Filters', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Filter By Size', exact: true })).toHaveText('Size');
  await expect.poll(() => queries.at(-1)?.includes('size=') ?? true).toBe(false);
});

test('empty search dismisses outside while active queries and filters stay open', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop search expansion.');
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Search Gallery', exact: true });
  const outside = page.getByRole('group', { name: 'Gallery Mode' }).getByRole('button', { name: 'Images', exact: true });
  await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
  await outside.click();
  await expect(search).toHaveCount(0);
  await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
  await search.fill('picture');
  await outside.click();
  await expect(search).toHaveValue('picture');
  await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Filter By Model' }).click();
  await page.getByRole('option', { name: 'Flux', exact: true }).click();
  await outside.click();
  await page.keyboard.press('Escape');
  const panel = page.getByRole('group', { name: 'Gallery Filters', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Filter By Model' })).toHaveText('Flux');
  const controls = await panel.locator('button, select').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { width: b.width, height: b.height }; }));
  expect(controls.every(n => n.width >= 40 && n.height === 40), JSON.stringify(controls)).toBe(true);
  await expect.poll(() => panel.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await outside.click();
  await expect(search).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Filter By Model' })).toHaveText('Flux');
  await panel.getByRole('button', { name: 'Clear Filters', exact: true }).click();
  await outside.click();
  await expect(panel).toHaveCount(0);
});


test('search closes without resizing in steps and retains its input while it fades', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone’s shared search row is checked in phone-dock.spec.ts.');
  await page.goto('/');
  // The phone's search overlay fades from its close button; the full studio's field folds into its trigger
  // at once (widths never animate, UI-PATTERNS › Motion) while the field fades.
  const phone = await studioUi(page).isPhone();
  const opener = page.getByRole('button', { name: 'Search Gallery', exact: true });
  await opener.click();
  const field = page.locator('.gallery-search input');
  await expect(field).toBeEnabled();
  await page.waitForTimeout(400);
  const frames = await page.evaluate(async mobile => {
    const pill = document.querySelector<HTMLElement>('.gallery-search')!;
    const input = pill.querySelector('input')!;
    const bar = document.querySelector<HTMLElement>('.phone-searchbar');
    const sample = () => ({ width: pill.getBoundingClientRect().width, height: pill.getBoundingClientRect().height, opacity: Number(getComputedStyle(bar || pill).opacity), retained: input.isConnected, disabled: input.disabled });
    const values = [sample()];
    const close = document.querySelector<HTMLButtonElement>(mobile ? '.gallery-query-close' : '.gallery-search-trigger')!;
    close.click();
    const start = performance.now();
    await new Promise<void>(resolve => { function frame() { values.push(sample()); if (performance.now() - start < 450) requestAnimationFrame(frame); else resolve(); } requestAnimationFrame(frame); });
    return values;
  }, phone);
  expect(frames.slice(1).some(n => n.retained && n.disabled)).toBe(true);
  if (phone) {
    expect(frames.some(n => n.opacity > 0 && n.opacity < 1)).toBe(true);
    await expect(page.locator('.phone-searchbar')).toHaveCount(0);
  } else {
    expect(frames.some(n => n.width > 50 && n.width < frames[0].width - 2)).toBe(false);
    expect(Math.max(...frames.map(n => n.height)) - Math.min(...frames.map(n => n.height))).toBeLessThanOrEqual(0.5);
    await expect(field).toBeDisabled();
  }
});

// A narrow or short window with a mouse keeps the full studio; a touch screen that size is a phone.
test.describe('with a mouse', () => {
  test.use({ hasTouch: false });
  test('compact studio keeps active search and every filter inside the viewport', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Full studio compact desktop layout.');
    await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Search Gallery', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).fill('picture');
    await page.getByRole('button', { name: 'Gallery Filters', exact: true }).click();
    const panel = page.getByRole('group', { name: 'Gallery Filters', exact: true });
    await panel.getByRole('button', { name: 'Filter By Model' }).click();
    await page.getByRole('option', { name: 'Flux', exact: true }).click();
    await page.waitForTimeout(400);
    for (const control of [page.getByRole('textbox', { name: 'Search Gallery', exact: true }), page.getByRole('button', { name: 'Clear Search', exact: true }), ...await panel.locator('button, select').all()]) await expect(control).toBeInViewport();
    await expect.poll(() => panel.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    expect(await page.getByRole('main').evaluate(n => n.scrollLeft)).toBe(0);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
    expect((await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(48);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect.poll(() => panel.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    const narrow = await panel.boundingBox();
    expect(narrow!.x).toBeGreaterThanOrEqual(0);
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(640);
    expect((await page.getByRole('textbox', { name: 'Search Gallery', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(48);
    const gallery = await page.locator('.virtual-gallery').boundingBox();
    expect(gallery!.y).toBeGreaterThanOrEqual(narrow!.y + narrow!.height + 12);
  });
});


test('custom gallery filters support keyboard selection and dismiss only their own menu', async ({ page }) => {
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  await studioUi(page).openFilters();
  const trigger = page.getByRole('button', { name: 'Filter By Model', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  // Several can be picked: Enter toggles the focused value and the menu stays open until Escape.
  await expect(page.getByRole('option', { name: 'Flux', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Flux');
  await expect(page.getByRole('option', { name: 'Flux', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Model Filter', exact: true })).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('group', { name: 'Gallery Filters', exact: true })).toBeVisible();
  await trigger.click();
  await page.locator('main').click({ position: { x: 2, y: 450 } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveText('Flux');
});


test('grouping uses the same glass shell and inset action states as Search and Select', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Full studio action shells.');
  await page.addInitScript(() => localStorage.setItem('studio-prefs', JSON.stringify({ stackRuns: false })));
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  const toolbar = page.locator('.gallery-toolbar');
  const grouping = toolbar.getByRole('button', { name: 'Auto-Grouping', exact: true });
  const shell = toolbar.locator('.gallery-action-shell').first();
  const search = toolbar.locator('.gallery-search-trigger');
  const select = toolbar.locator('.gallery-select-toggle');
  const state = node => node.evaluate(n => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { background: s.background, border: s.border, radius: s.borderRadius, shadow: s.boxShadow, colour: s.color, width: r.width, height: r.height }; });
  await page.mouse.move(0, 500);
  expect(await state(shell)).toEqual(await state(toolbar.locator('.gallery-search')));
  expect(await state(grouping)).toEqual(await state(search));
  expect(await state(grouping)).toEqual(await state(select));
  expect(await grouping.locator('svg').evaluate(n => n.getBoundingClientRect().width)).toBe(16);
  await toolbar.screenshot({ path: testInfo.outputPath('desktop-default.png') });
  await grouping.hover();
  await page.waitForTimeout(200);
  const hover = await state(grouping);
  await toolbar.screenshot({ path: testInfo.outputPath('desktop-hover.png') });
  await select.hover();
  await page.waitForTimeout(200);
  expect(await state(select)).toEqual(hover);
  await grouping.click();
  await page.mouse.move(0, 500);
  await page.waitForTimeout(400);
  // Grouping on is a pressed button.
  expect(await grouping.evaluate(n => getComputedStyle(n).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  const shellBackground = await shell.evaluate(n => getComputedStyle(n).backgroundColor);
  await page.keyboard.press('Tab');
  await grouping.focus();
  const focus = await grouping.evaluate(n => ({ outline: getComputedStyle(n).outline, offset: getComputedStyle(n).outlineOffset }));
  await select.focus();
  expect(await select.evaluate(n => ({ outline: getComputedStyle(n).outline, offset: getComputedStyle(n).outlineOffset }))).toEqual(focus);
  await select.click();
  await page.mouse.move(0, 500);
  await page.waitForTimeout(400);
  // "N Selected" is plain text beside its X, on the same glass as the other shells.
  expect(await select.evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await toolbar.locator('.gallery-management').evaluate(n => getComputedStyle(n).backgroundColor)).toBe(shellBackground);
  await toolbar.screenshot({ path: testInfo.outputPath('desktop-selected.png') });
});

test('the search’s clear X is a round plain icon button', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The full studio’s search field.');
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  await page.locator('.gallery-search-trigger').click();
  await page.keyboard.type('abc');
  const close = page.getByRole('button', { name: 'Clear Search', exact: true });
  await close.hover();
  const box = await close.boundingBox();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  await page.mouse.move(0, 500);
  await expect.poll(() => close.evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('search keeps a neutral shell without a selected input highlight', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'The phone’s shared search row is checked in phone-dock.spec.ts.');
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  // The phone searches in an overlay; the full studio searches in its toolbar beside the filters and Select.
  const phone = await studioUi(page).isPhone();
  const opener = page.getByRole('button', { name: 'Search Gallery', exact: true });
  await opener.click();
  const tools = page.locator(phone ? '.phone-searchbar' : '.gallery-toolbar');
  const input = tools.getByRole('textbox', { name: 'Search Gallery', exact: true });
  const search = tools.locator('.gallery-search');
  const filters = tools.locator('.gallery-filter-anchor');
  const border = node => node.evaluate(n => { const s = getComputedStyle(n); return { colour: s.borderColor, width: s.borderWidth, style: s.borderStyle }; });
  await expect(input).toBeFocused();
  if (!phone) expect(await border(search)).toEqual(await border(filters));
  expect(await input.evaluate(n => getComputedStyle(n).outlineStyle)).toBe('none');
  await expect(input).toHaveAttribute('placeholder', 'Search');
  await input.fill('picture');
  await search.hover();
  if (!phone) expect(await border(search)).toEqual(await border(filters));
  if (!phone) {
    await tools.getByRole('button', { name: 'Select', exact: true }).click();
    expect(await border(search)).toEqual(await border(tools.locator('.gallery-management')));
  }
  await input.focus();
  await tools.screenshot({ path: testInfo.outputPath('search-focus-border.png') });
  await tools.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await expect(input).toHaveCount(0);
  if (phone) await expect(page.locator('.phone-searchbar')).toHaveCount(0);
  await opener.click();
  await expect(input).toBeFocused();
  if (!phone) expect(await border(search)).toEqual(await border(filters));
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});


test('filter options scroll independently and have a compact local search', async ({ page }) => {
  const many = Array.from({ length: 45 }, (_, index) => ({ ...items[0], id: `filter-${index}`, model: `Model ${String(index).padStart(2, '0')}` }));
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: many, revision: 1, hasMore: false } }));
  await page.goto('/');
  await studioUi(page).openFilters();
  await expect(page.getByRole('button', { name: 'Filter By Workflow', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter By Model', exact: true }).click();
  const menu = page.locator('.gallery-filter-menu');
  const list = page.getByRole('listbox', { name: 'Model Filter', exact: true });
  const search = page.getByRole('textbox', { name: 'Search Models', exact: true });
  // Search waits behind its icon beside the title until asked for.
  await expect(search).toHaveCount(0);
  await menu.getByRole('button', { name: 'Search Models', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(list.getByRole('option')).toHaveCount(45);
  await page.waitForTimeout(250);
  const before = await menu.boundingBox();
  await list.evaluate(node => { node.scrollTop = 250; });
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(200);
  await page.waitForTimeout(100);
  const after = await menu.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
  await search.fill('model 32');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option', { name: 'Model 32', exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill('not in this list');
  await expect(menu.getByRole('status')).toHaveText('No Matches');
  // The open field carries its own Close Search: it clears the query and folds the field away.
  await menu.getByRole('button', { name: 'Close Search', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(45);
  await expect(search).toHaveCount(0);
  await menu.getByRole('button', { name: /^Search / }).click();
  await search.fill('model 32');
  await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Filter By Model' })).toHaveText('Model 32');
  // Picking several keeps the menu open until Escape.
  await expect(menu).toBeVisible();
  await search.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('selection dims only unselected media and keeps the right-hand action order', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Full studio toolbar; media styles are shared with the phone selection mode.');
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.goto('/');
  const toolbar = page.locator('.gallery-toolbar');
  const grouping = toolbar.getByRole('button', { name: 'Auto-Grouping', exact: true });
  const select = toolbar.getByRole('button', { name: 'Select', exact: true });
  expect((await grouping.boundingBox())!.x).toBeLessThan((await select.boundingBox())!.x);
  await select.click();
  const tiles = page.locator('button.tile');
  const opacity = node => node.locator('.generation-surface').evaluate(n => Number(getComputedStyle(n).opacity));
  await expect.poll(() => opacity(tiles.first())).toBe(.65);
  await tiles.first().click();
  await expect.poll(() => opacity(tiles.first())).toBe(1);
  expect(await opacity(tiles.nth(1))).toBe(.65);
  // "1 Selected" is plain text: no fill, outline or ring once the pointer moves off, even after a click focused it.
  const count = toolbar.getByRole('button', { name: 'Stop Selecting', exact: true });
  await expect(count).toHaveText('1 Selected');
  await count.focus();
  await page.mouse.move(0, 500);
  await expect.poll(() => count.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.boxShadow]; })).toEqual(['rgba(0, 0, 0, 0)', 'none']);
  await toolbar.getByRole('button', { name: 'Stop Selecting', exact: true }).click();
  await expect.poll(() => opacity(tiles.nth(1))).toBe(1);
});


test('video gallery actions run from playback through grouping to Select', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Full studio toolbar.');
  const videos = items.map(item => ({ ...item, type: 'video' }));
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: videos, revision: 1, hasMore: false } }));
  await page.goto('/');
  const toolbar = page.locator('.gallery-toolbar');
  await toolbar.getByRole('group', { name: 'Gallery Mode', exact: true }).getByRole('button', { name: 'Videos', exact: true }).click();
  const play = toolbar.getByRole('button', { name: /^Grid Autoplay:/ });
  const group = toolbar.getByRole('button', { name: 'Auto-Grouping', exact: true });
  const select = toolbar.getByRole('button', { name: 'Select', exact: true });
  const status = toolbar.getByRole('button', { name: 'Hide Failed & Queued', exact: true });
  await expect(play).toBeVisible();
  // The view controls in their one order (UI-PATTERNS): Auto-Grouping, Grid Autoplay, Hide Failed & Queued, then Select.
  expect((await group.boundingBox())!.x).toBeLessThan((await play.boundingBox())!.x);
  expect((await play.boundingBox())!.x).toBeLessThan((await status.boundingBox())!.x);
  expect((await status.boundingBox())!.x).toBeLessThan((await select.boundingBox())!.x);
  // One toggle hides failed and queued outputs, remembered like the other view controls.
  await expect(status).toHaveAttribute('aria-pressed', 'false');
  await status.click();
  await expect(status).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studio-prefs') || '{}'))).toMatchObject({ showFailedItems: false, hideQueuedItems: true });
});

// UI-PATTERNS › Buttons & Icon Bars: tooltips open away from their bar's edge.
test.describe('tooltips with a mouse', () => {
  test.use({ hasTouch: false });
  test('top bar labels open below, bottom bar labels above', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Phones show no hover labels.');
    await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.goto('/');
    const tooltip = page.locator('.studio-tooltip');
    const search = page.locator('.gallery-toolbar').getByRole('button', { name: 'Search Gallery', exact: true });
    await search.hover();
    // Radix repeats the content in a visually hidden copy for screen readers; the first is the label.
    const searchLabel = tooltip.filter({ hasText: /^Search$/ }).first();
    await expect(searchLabel).toBeVisible();
    await page.waitForTimeout(250);
    const [button, label] = [await search.boundingBox(), await searchLabel.boundingBox()];
    expect(label!.y).toBeGreaterThanOrEqual(button!.y + button!.height);
    expect(Math.abs((label!.x + label!.width / 2) - (button!.x + button!.width / 2))).toBeLessThan(2);
    await page.mouse.move(700, 500);
    await expect(searchLabel).toHaveCount(0);
    const settings = page.locator('.studio-dock').getByRole('button', { name: 'Settings', exact: true });
    await settings.hover();
    const settingsLabel = tooltip.filter({ hasText: /^Settings$/ }).first();
    await expect(settingsLabel).toBeVisible();
    await page.waitForTimeout(250);
    const [dock, dockLabel] = [await settings.boundingBox(), await settingsLabel.boundingBox()];
    expect(dockLabel!.y + dockLabel!.height).toBeLessThanOrEqual(dock!.y);
  });
});
