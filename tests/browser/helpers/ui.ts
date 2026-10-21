import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The studio's common actions, in whichever layout the page shows.
 *
 * The phone studio and the full studio still place these differently. This is
 * the one place that knows how, so specs read the same in both layouts and the
 * responsive merge only has to update these helpers. The layout comes from the
 * page, not the Playwright project, so resized and tablet pages take the path
 * they actually show.
 */
export function studioUi(page: Page) {
  // Hidden too: a modal opened from the composer hides it from the accessibility tree, yet it stays the composer.
  const composer = page.getByRole('dialog', { name: 'Create', exact: true, includeHidden: true }).or(page.getByRole('region', { name: 'Create', exact: true, includeHidden: true }));
  const galleryMode = page.getByRole('group', { name: 'Gallery Mode', exact: true });
  const more = page.getByRole('menu', { name: 'Menu', exact: true });
  const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
  // The model picker has no shared role yet: a pop-up over Create on the phone, a popover menu in the full studio.
  const modelPicker = page.locator('.phone-model-pop, .model-menu');

  /** Whether the page shows the phone studio. */
  async function isPhone() {
    await expect(page.locator('.phone-shell, .app-shell')).toHaveCount(1);
    return (await page.locator('.phone-shell').count()) > 0;
  }

  /** Opens the phone's More sheet; the full studio has no such sheet. */
  async function openMore() {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(more).toBeVisible();
    return more;
  }

  /**
   * Waits until the phone's Create sheet is gone or open and still; a closing
   * sheet stays in the page while it slides away. Its spring advances at most
   * one short step a frame, so a busy machine stretches it well past a second.
   */
  async function composerSettled() {
    // A sheet that finishes closing between the count and the measurement would leave the evaluation waiting for it; the short timeout lets the next poll see it gone.
    await expect.poll(async () => {
      if (!await composer.count()) return 'gone';
      return composer.evaluate((element) => new Promise<string>((resolve) => {
        const top = element.getBoundingClientRect().top;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const now = element.getBoundingClientRect().top;
          resolve(!element.isConnected ? 'gone' : now !== top ? `moving ${top} to ${now}` : now >= innerHeight / 2 ? `low at ${now}` : 'open');
        }));
      }), undefined, { timeout: 1000 }).catch((error: Error) => error.message.split('\n')[0]);
    }, { timeout: 15000 }).toMatch(/^(gone|open)$/);
  }

  /** Opens the creation controls: the phone's Create sheet, or the full studio's expanded box. */
  async function openComposer() {
    if (await isPhone()) {
      await composerSettled();
      if (!await composer.count()) await page.locator('.phone-create-open').click();
    } else await composer.getByRole('textbox', { name: /^Prompt/ }).focus();
    await expect(composer).toBeVisible();
    return composer;
  }

  /** Closes the phone's Create sheet. The full studio's box never covers the gallery, so stays. */
  async function closeComposer() {
    if (!await isPhone() || !await composer.count()) return;
    // A pop-up over Create (Model, References, LoRAs, Size, Advanced) closes first with Escape.
    for (let step = 0; step < 3 && await page.locator('.phone-sheet.phone-create:is(.is-covered, .is-overlaid)').count(); step++) await page.keyboard.press('Escape');
    if (!await composer.isVisible()) return;
    await composer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(composer).toHaveCount(0);
  }

  async function openModelPicker() {
    await openComposer();
    await modelTrigger.click();
    await expect(modelPicker).toBeVisible();
    return modelPicker;
  }

  async function openSizeMenu() {
    await openComposer();
    await sizeTrigger.click();
    await expect(sizeMenu).toBeVisible();
    return sizeMenu;
  }

  const modelTrigger = composer.locator('.phone-model-browse, .model-trigger');
  const sizeMenu = page.getByRole('dialog', { name: 'Size', exact: true });
  const sizeTrigger = composer.getByRole('button', { name: /^(Aspect Ratio$|Size:)/ });

  return {
    composer,
    galleryMode,
    isPhone,
    modelPicker,
    modelTrigger,
    more,
    openComposer,
    closeComposer,
    composerSettled,
    openModelPicker,
    openMore,
    openSizeMenu,
    sizeMenu,
    sizeTrigger,
    viewer,

    /** The scrolling gallery: the page's only main landmark in both layouts. */
    gallery: page.getByRole('main'),
    /** What scrolls the gallery: its pane in the full studio, the document on the phone (so a tap on iOS's status bar reaches the top). */
    scroller: page.locator('main.stage-gallery').or(page.locator('html:has(.phone-shell)')),
    generate: composer.getByRole('button', { name: 'Generate', exact: true }),
    negativePrompt: composer.getByRole('textbox', { name: 'Negative Prompt', exact: true, includeHidden: true }),
    prompt: composer.getByRole('textbox', { name: 'Prompt', exact: true }),
    /** The model rows: buttons in the phone pop-up, options in the full studio's listbox. */
    modelOptions: modelPicker.locator('.model-pop-pick, [role="option"]'),
    selectionBar: page.getByRole('navigation', { name: 'Selected Items', exact: true }).or(page.getByRole('group', { name: 'Gallery Management', exact: true })),

    async switchMode(kind: 'image' | 'video') {
      await galleryMode.getByRole('button', { name: kind === 'video' ? /^Videos?$/ : /^Images?$/ }).click();
    },

    async chooseModel(name: string | RegExp) {
      await openModelPicker();
      await modelPicker.locator('.model-pop-pick, [role="option"]').filter({ hasText: name }).first().click();
    },

    /** Opens a tile's actions: a long press on the phone, a right click in the full studio. */
    async openItemActions(tile: Locator) {
      if (await isPhone()) {
        // A long press selects; the select bar holds the actions.
        await tile.dispatchEvent('contextmenu');
        const bar = page.getByRole('navigation', { name: 'Selected Items', exact: true });
        await expect(bar).toBeVisible();
        return bar;
      }
      await tile.click({ button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      return menu;
    },

    /** Starts selecting gallery items, from More on the phone or the gallery toolbar. */
    async enterSelection() {
      if (await isPhone()) {
        // The phone has no Select button in its top bar: a long press on a tile, or Menu › Select.
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
      } else await page.getByRole('group', { name: 'Gallery Management', exact: true }).getByRole('button', { name: 'Select', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop Selecting' })).toBeVisible();
    },

    /** Opens the gallery filters, from the phone header or the gallery toolbar. */
    async openFilters() {
      const phone = await isPhone();
      await page.getByRole('button', { name: phone ? 'Open Gallery Filters' : 'Gallery Filters', exact: true }).click();
      const filters = page.getByRole('group', { name: 'Gallery Filters', exact: true });
      await expect(filters).toBeVisible();
      return filters;
    },

    /**
     * Opens Settings: from the top bar's Menu on the phone.
     */
    async openSettings() {
      if (await isPhone()) {
        await openMore();
        await more.getByRole('menuitem', { name: 'Settings', exact: true }).click();
        return;
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    },

    /** Stops everything running: the running count's menu on the phone, the dock's Stop chip on the desktop. */
    async stopAll() {
      if (await isPhone()) {
        await page.locator('.phone-running-inline').click();
        await page.getByRole('menuitem', { name: /^Stop All \(\d+\)$/ }).click();
      } else await page.locator('.dock-chip.is-cancel').filter({ hasText: /Stop/i }).click();
    },

    /** The viewer's Recreate (an exact rerun): in its action bar, on the phone and the desktop. */
    async reuseButton() {
      // With Details open, Recreate is in its footer and the bar leaves it out.
      if (await page.locator('.viewer-side').count()) return page.locator('.viewer-side').getByRole('group', { name: 'Details Actions', exact: true }).getByRole('button', { name: 'Recreate', exact: true });
      const actions = await isPhone() ? viewer.getByRole('navigation', { name: 'Image Actions', exact: true }) : viewer.getByRole('toolbar', { name: 'Image Actions', exact: true });
      return actions.getByRole('button', { name: 'Recreate', exact: true });
    },

    /** Closes Details: its own Close on the desktop, Info (pressed) on the phone. */
    async hideDetails() {
      const details = page.locator('.viewer-side');
      if (!await details.count()) return;
      if (await isPhone()) await viewer.getByRole('button', { name: 'Info', exact: true }).click();
      else await details.getByRole('button', { name: 'Close Details', exact: true }).click();
      await expect(details).toHaveCount(0);
    },

    /** Shows the viewer's Details, from Info. */
    /** Opens Details with Info; on the desktop Info then makes way for the panel's own Close. */
    async showDetails() {
      const details = page.locator('.viewer-side');
      if (!await details.count()) await viewer.getByRole('button', { name: 'Info', exact: true }).click();
      await expect(details).toBeVisible();
    },

    async openViewer(tile: Locator) {
      await tile.click();
      await expect(viewer).toBeVisible();
      return viewer;
    },

    /** Closes the viewer from its own close control: in the corner on touch layouts, in the dock otherwise. */
    async closeViewer() {
      await viewer.getByRole('button', { name: /^Close( Viewer)?$/ }).filter({ visible: true }).first().click();
      await expect(viewer).toHaveCount(0);
    },
  };
}

/** Opens a picker's compact search (PickerTools) and returns its field. */
export async function pickerSearch(scope: Locator, name: string, role: 'textbox' | 'searchbox' | 'combobox' = 'textbox') {
  const field = scope.getByRole(role, { name, exact: true });
  if (!(await field.isVisible())) await scope.getByRole('button', { name, exact: true }).click();
  await expect(field).toBeVisible();
  return field;
}

/**
 * Chooses a picker view (UI-PATTERNS › Pickers): a tab in the desktop heading,
 * or a row of the heading dropdown in a phone pop-up ("LoRAs · This Model").
 * On the desktop an open search covers the views, so it is closed first.
 * `name` matches the tab's accessible name ("This Model", /^Selected 1 of/).
 */
export async function pickerView(surface: Locator, name: string | RegExp) {
  const exact = typeof name === 'string';
  const tab = surface.getByRole('button', { name, exact }).or(surface.getByRole('tab', { name, exact }));
  // A desktop search covers the heading's views; Close Search (which clears the query) gives them back.
  const cover = surface.locator('.picker-search-field.is-cover .picker-search-close');
  if (!await tab.count() && await cover.count()) await cover.click();
  if (await tab.count()) { await tab.first().click(); return; }
  // The heading's views are the shared Dropdown; its menu floats on the page.
  const trigger = surface.locator('.dropdown-trigger.picker-view');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await surface.page().locator('.dropdown-menu').getByRole('option', { name, exact }).click();
  await expect(surface.page().locator('.dropdown-menu')).toHaveCount(0);
}

/** Whether a view is the one showing, on either device. */
export async function expectPickerView(surface: Locator, name: string) {
  const tab = surface.getByRole('button', { name, exact: true }).or(surface.getByRole('tab', { name, exact: true }));
  if (await tab.count()) {
    await expect.poll(async () => (await tab.first().getAttribute('aria-pressed')) || (await tab.first().getAttribute('aria-selected'))).toBe('true');
    return;
  }
  await expect(surface.locator('.dropdown-trigger.picker-view')).toContainText(name);
}

/**
 * Serves the gallery from `items` (or a function of the request URL, for
 * modes, searches and pages) with an empty delta, so the list stays as given.
 * The shape most specs mock by hand.
 */
export async function mockGallery(page: Page, items: object[] | ((url: URL) => { items: object[]; hasMore?: boolean; nextCursor?: string; totalApprox?: number } | object[])) {
  await page.route('**/api/gallery?*', (route) => {
    const url = new URL(route.request().url());
    const result = typeof items === 'function' ? items(url) : items;
    const body = Array.isArray(result) ? { items: result, hasMore: false } : { hasMore: false, ...result };
    return route.fulfill({ json: { revision: 1, ...body } });
  });
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
}
