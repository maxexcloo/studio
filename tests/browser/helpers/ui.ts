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
  const more = page.getByRole('dialog', { name: 'More', exact: true });
  const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
  // The model picker has no shared role yet: a sheet on the phone, a popover menu in the full studio.
  const modelPicker = page.locator('.phone-model-sheet, .model-menu');

  /** Whether the page shows the phone studio. */
  async function isPhone() {
    await expect(page.locator('.phone-shell, .app-shell, .zen-shell')).toHaveCount(1);
    return (await page.locator('.phone-shell').count()) > 0;
  }

  /** Opens the phone's More sheet; the full studio has no such sheet. */
  async function openMore() {
    await page.getByRole('button', { name: 'More', exact: true }).click();
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
    // A picker opened from Create replaces it; Escape steps back to Create first.
    for (let step = 0; step < 3 && await page.locator('.phone-sheet.phone-create.is-covered').count(); step++) await page.keyboard.press('Escape');
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
    /** The model rows: buttons in the phone sheet, options in the full studio's listbox. */
    modelOptions: modelPicker.locator('.phone-model-option, [role="option"]'),
    selectionBar: page.getByRole('navigation', { name: 'Selected Items', exact: true }).or(page.getByRole('group', { name: 'Gallery Management', exact: true })),

    async switchMode(kind: 'image' | 'video') {
      await galleryMode.getByRole('button', { name: kind === 'video' ? /^Videos?$/ : /^Images?$/ }).click();
    },

    async chooseModel(name: string | RegExp) {
      await openModelPicker();
      await modelPicker.locator('.phone-model-option, [role="option"]').filter({ hasText: name }).first().click();
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
        await more.getByRole('button', { name: 'Select Items', exact: true }).click();
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
     * Opens Settings. The phone reaches them from More when signed in to an
     * account; otherwise only the full studio has Settings, so it switches.
     */
    async openSettings() {
      if (await isPhone()) {
        await openMore();
        const settings = more.getByRole('button', { name: 'Settings', exact: true });
        if (await settings.count()) {
          await settings.click();
          return;
        }
        await more.getByRole('button', { name: /^Use the full studio/ }).click();
        await expect(page.locator('.app-shell, .zen-shell')).toHaveCount(1);
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    },

    /** Stops everything running: More on the phone, the dock's Stop chip in the full studio. */
    async stopAll() {
      if (await isPhone()) {
        await openMore();
        await more.getByRole('button', { name: 'Stop All Generations', exact: true }).click();
      } else await page.locator('.dock-chip.is-cancel').filter({ hasText: /Stop/i }).click();
    },

    /** The viewer's Recreate (an exact rerun): in its action bar, on the phone and the desktop. */
    async reuseButton() {
      const actions = await isPhone() ? viewer.getByRole('navigation', { name: 'Image Actions', exact: true }) : viewer.getByRole('toolbar', { name: 'Image Actions', exact: true });
      return actions.getByRole('button', { name: 'Recreate', exact: true });
    },

    /** Shows the viewer's Details, from Info. */
    async showDetails() {
      const toggle = viewer.getByRole('button', { name: 'Info', exact: true });
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
