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
        await openMore();
        await more.getByRole('menuitem', { name: 'Select', exact: true }).click();
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
        await page.getByRole('menuitem', { name: 'Stop All Generations', exact: true }).click();
      } else await page.locator('.dock-chip.is-cancel').filter({ hasText: /Stop/i }).click();
    },

    /** The viewer's Rerun (an exact rerun): in its action bar, on the phone and the desktop. */
    async reuseButton() {
      // With Details open, Rerun is in its footer and the bar leaves it out.
      if (await page.locator('.viewer-side').count()) return page.locator('.viewer-side').getByRole('group', { name: 'Details Actions', exact: true }).getByRole('button', { name: 'Rerun', exact: true });
      const actions = await isPhone() ? viewer.getByRole('navigation', { name: 'Image Actions', exact: true }) : viewer.getByRole('toolbar', { name: 'Image Actions', exact: true });
      return actions.getByRole('button', { name: 'Rerun', exact: true });
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
