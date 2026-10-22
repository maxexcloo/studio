import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockGallery, pickerView, studioUi } from './helpers/ui';

/*
 * Batch fixes 117–123 and 130 (UI-PATTERNS › Pickers, Composer, Motion). The
 * flashes are caught by sampling every animation frame, as
 * desktop-stability.spec.ts does, so a jump that settles again still fails.
 */

const picture = (fill: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${fill}"/></svg>`);
const asset = (id: string, index: number) => ({ id, source: 'generation', name: `${id}.png`, url: picture(`#4${index}7e7b`), thumbnailUrl: picture(`#4${index}7e7b`), mime: 'image/png', width: 80, height: 80, size: 10, createdAt: '' });
const library = Array.from({ length: 8 }, (_, index) => asset(`library-${index}`, index));
const slots = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index ? `reference_${index + 1}` : 'reference', kind: 'image', role: 'reference', label: index ? `Reference ${index + 1}` : 'Reference Image', min: 0, max: 1, required: false, ...(index ? { follows: index > 1 ? `reference_${index}` : 'reference' } : {}) }));
const startSlot = [{ id: 'reference', kind: 'image', role: 'start', label: 'Start image', min: 1, max: 1, required: true }];

/** Serves the models with image models taking three references and video models one start image, as live. */
async function prepare(page: Page, change: (models: any) => void = () => {}) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.mediaInputs = profile.kind === 'video' ? startSlot : slots(3);
  change(models);
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: library, nextCursor: '' } }));
  return models;
}

/** Samples, every frame, the boxes of what `selector` matches inside `scope` (a CSS selector). */
async function watchBoxes(page: Page, scope: string, selector: string) {
  await page.evaluate(({ scope, selector }) => {
    const frames: string[] = [];
    const sample = () => {
      const root = document.querySelector(scope);
      frames.push([...(root?.querySelectorAll<HTMLElement>(selector) || [])].map((element) => {
        const box = element.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${getComputedStyle(element).opacity},${getComputedStyle(element).visibility}`;
      }).join(' | '));
      (window as any).__boxFrame = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__boxes = frames;
  }, { scope, selector });
}

async function stopBoxes(page: Page) {
  return page.evaluate(() => { cancelAnimationFrame((window as any).__boxFrame); return (window as any).__boxes as string[]; });
}

const settle = (page: Page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)));

/**
 * Opens and closes a desktop chooser's search: the views and Close keep their
 * boxes on every frame; the rest of the heading (Stacks, Clear) gives way to
 * the field and comes back after, and the search icon stays where it was.
 */
async function swapSearch(page: Page, surface: string, searchLabel: string) {
  const head = `${surface} .reference-popover-head`;
  const fixed = ':scope .picker-controls, :scope .reference-popover-close';
  const icon = page.locator(head).getByRole('button', { name: searchLabel, exact: true });
  await settle(page);
  const iconBefore = (await icon.boundingBox())!;
  const rest = page.locator(`${head} .picker-heading-rest`);
  for (const step of ['open', 'close']) {
    await watchBoxes(page, head, fixed);
    await icon.click();
    await settle(page);
    const frames = await stopBoxes(page);
    expect(frames.length, step).toBeGreaterThan(5);
    expect(new Set(frames).size, `${step}: the views and Close kept their boxes on every frame`).toBe(1);
    expect(frames[0].split(' | ')).toHaveLength(2);
    const box = (await icon.boundingBox())!;
    expect(Math.abs(box.x - iconBefore.x), `${step}: the search icon stays in place`).toBeLessThanOrEqual(0.5);
    if (step === 'open') {
      await expect(icon).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`${head} .picker-search-field.is-swap input`)).toBeFocused();
      if (await rest.count()) {
        await expect(rest).toHaveCSS('opacity', '0');
        expect(await rest.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
      }
    } else {
      await expect(icon).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator(`${head} .picker-search-field`)).toHaveCount(0);
      if (await rest.count()) {
        await expect(rest).toHaveCSS('opacity', '1');
        expect(await rest.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
      }
    }
  }
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'The desktop composer, gallery toolbar and chooser headings.');

  // 117: compact, Generate is its arrow; expanded, its arrow and its name. The accessible name stays.
  test('the compact composer shows Generate as its icon and the expanded one names it', async ({ page }) => {
    await page.goto('/');
    const ui = studioUi(page);
    const generate = page.locator('.zen-prompt .generate');
    await expect(page.locator('.zen-prompt')).not.toHaveClass(/is-expanded/);
    await expect(generate).toHaveAccessibleName('Generate');
    await expect(generate.locator('.generate-label')).toBeHidden();
    const compact = (await generate.boundingBox())!;
    expect(Math.abs(compact.width - compact.height)).toBeLessThanOrEqual(1);
    await ui.openComposer();
    await expect(page.locator('.zen-prompt')).toHaveClass(/is-expanded/);
    await expect(generate).toHaveText('Generate');
    expect((await generate.boundingBox())!.width).toBeGreaterThan(compact.width + 20);
  });

  // 118: the filters open and fold as the search does, over several frames; instant with reduced motion.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`the gallery filters open and fold like the search (${reducedMotion === 'reduce' ? 'at once with reduced motion' : 'animated'})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await mockGallery(page, [{ id: 'one', url: picture('#497e7b'), thumbnailUrl: picture('#497e7b'), filename: 'one.png', type: 'image', status: 'done', prompt: 'One', createdAt: new Date().toISOString(), width: 80, height: 80 }]);
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Gallery Filters', exact: true });
    const widths = async () => {
      await page.evaluate(() => {
        const frames: number[] = [];
        const sample = () => { const panel = document.querySelector('.gallery-filter-panel'); frames.push(panel ? Math.round(panel.getBoundingClientRect().width) : -1); (window as any).__panelFrame = requestAnimationFrame(sample); };
        sample();
        (window as any).__panel = frames;
      });
      await trigger.click();
      await settle(page);
      return page.evaluate(() => { cancelAnimationFrame((window as any).__panelFrame); return (window as any).__panel as number[]; });
    };
    const opening = (await widths()).filter((width) => width >= 0);
    const full = opening[opening.length - 1];
    expect(full).toBeGreaterThan(100);
    const between = (frames: number[]) => frames.filter((width) => width > 0 && width < full - 4).length;
    // It grows through in-between widths rather than appearing at once (or at once, with reduced motion).
    if (reducedMotion === 'reduce') expect(between(opening)).toBe(0);
    else expect(between(opening)).toBeGreaterThanOrEqual(2);
    const closing = await widths();
    expect(closing[closing.length - 1]).toBe(-1);
    if (reducedMotion === 'reduce') expect(between(closing)).toBe(0);
    else expect(between(closing)).toBeGreaterThanOrEqual(2);
  });

  // 121, 123: References, LoRAs and Models search alike: the field takes the place of the controls after the views.
  test('the References chooser search swaps in place of the heading controls', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await studioUi(page).openComposer();
    await page.getByRole('button', { name: 'Add References', exact: true }).click();
    // A pick brings Clear, which must give way to the field and come back.
    await page.locator('.reference-popover .reference-tile-select').first().click();
    await expect(page.locator('.reference-popover').getByRole('button', { name: 'Clear Selection', exact: true })).toBeVisible();
    await swapSearch(page, '.reference-popover', 'Search Library');
  });

  test('the LoRA chooser search swaps in place of the heading controls', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const composer = await studioUi(page).openComposer();
    await composer.getByRole('button', { name: /^LoRAs/ }).click();
    await expect(page.getByRole('dialog', { name: 'LoRAs', exact: true })).toBeVisible();
    await swapSearch(page, '.composer-loras', 'Search LoRAs');
  });

  test('the Model chooser search swaps in place of the heading controls', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await studioUi(page).openModelPicker();
    await swapSearch(page, '.model-menu', 'Search Models');
  });

  // 122: All, Favourites, Fast and Quality are one choice.
  test('the Model chooser views are one choice', async ({ page }) => {
    await page.goto('/');
    const menu = await studioUi(page).openModelPicker();
    const filters = menu.getByRole('group', { name: 'Filter Models', exact: true });
    const pressed = () => filters.locator('button[aria-pressed="true"]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') || button.textContent));
    expect(await pressed()).toEqual(['All']);
    await filters.getByRole('button', { name: 'Favourites', exact: true }).click();
    expect(await pressed()).toEqual(['Favourites']);
    await filters.getByRole('button', { name: 'Fast', exact: true }).click();
    expect(await pressed()).toEqual(['Fast']);
    await filters.getByRole('button', { name: 'Quality', exact: true }).click();
    expect(await pressed()).toEqual(['Quality']);
    await filters.getByRole('button', { name: 'Quality', exact: true }).click();
    expect(await pressed()).toEqual(['All']);
  });
});

// A mouse that hovers: the projects emulate touch, which turns `(hover: hover)` off.
test.describe('desktop with a hovering pointer', () => {
  test.skip(({ isMobile }) => isMobile, 'Hover is a desktop pointer state.');
  test.use({ hasTouch: false });

  // 119: hovering a reference tile changes only its ring's colour; it never flashes white on the way in.
  test('hovering a reference tile is steady', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await studioUi(page).openComposer();
    await page.getByRole('button', { name: 'Add References', exact: true }).click();
    const tile = page.locator('.reference-popover .reference-tile-select').nth(3);
    await expect(tile).toBeVisible();
    await settle(page);
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x - 30, box.y - 30);
    await tile.evaluate((button) => {
      const frames: string[] = [];
      const sample = () => { const style = getComputedStyle(button); frames.push(`${style.outlineStyle}|${style.outlineColor}`); (window as any).__hoverFrame = requestAnimationFrame(sample); };
      sample();
      (window as any).__hover = frames;
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await settle(page);
    await page.mouse.move(box.x - 30, box.y - 30, { steps: 3 });
    await settle(page);
    const frames: string[] = await page.evaluate(() => { cancelAnimationFrame((window as any).__hoverFrame); return (window as any).__hover; });
    const alpha = (color: string) => { const parts = color.match(/[\d.]+/g)!.map(Number); return parts.length > 3 ? parts[3] : 1; };
    const hovered = Math.max(...frames.map((frame) => alpha(frame.split('|')[1])));
    // The ring is always drawn; only its colour moves, and never past the hover colour (0.1 white).
    expect(new Set(frames.map((frame) => frame.split('|')[0]))).toEqual(new Set(['solid']));
    expect(hovered).toBeLessThanOrEqual(0.2);
    // And it does show on hover.
    expect(hovered).toBeGreaterThan(0.05);
  });
});

// 122 on the phone: the views dropdown is one choice and closes on it.
test('the phone Model chooser views are one choice', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone heading dropdown.');
  await page.goto('/');
  const ui = studioUi(page);
  const menu = await ui.openModelPicker();
  await pickerView(menu, 'Favourites');
  await expect(menu.locator('.dropdown-trigger.picker-view')).toHaveText(/Favourites/);
  await pickerView(menu, 'Fast');
  await expect(menu.locator('.dropdown-trigger.picker-view')).toHaveText(/^\s*Fast\s*$/);
});

/** The reference chooser, opened from the composer's first reference control. */
async function openReferences(page: Page) {
  await page.locator('.composer-reference-slots :is(.ref-group, [data-reference-slot])').first().click();
  const picker = page.locator('.reference-popover');
  await expect(picker).toBeVisible();
  return picker;
}

const tile = (picker: Locator, id: string) => picker.getByRole('button', { name: new RegExp(`^(Selected: )?${id}\\.png$`) });

// 120: a video model's one start image is chosen exactly as an image model's references are.
test('a video model picks its reference with the same chooser as an image model', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  const ui = studioUi(page);
  for (const mode of ['image', 'video'] as const) {
    if (mode === 'video') { await ui.closeComposer(); await ui.switchMode('video'); }
    await ui.openComposer();
    const picker = await openReferences(page);
    const max = mode === 'video' ? 1 : 3;
    await tile(picker, 'library-1').click();
    await expect(tile(picker, 'library-1')).toHaveAttribute('aria-pressed', 'true');
    // Nothing is shut off: a further pick adds (several slots) or swaps in (one slot).
    await expect(picker.locator('.reference-tile-select[aria-disabled="true"]')).toHaveCount(0);
    await tile(picker, 'library-2').click();
    await expect(tile(picker, 'library-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(picker, 'library-1')).toHaveAttribute('aria-pressed', mode === 'video' ? 'false' : 'true');
    await expect(page.locator('.status-message').filter({ hasText: /Take one off/ })).toHaveCount(0);
    // The same Selected n/max view and Clear.
    const picked = mode === 'video' ? 1 : 2;
    await expect(picker.getByRole('button', { name: 'Clear Selection', exact: true })).toBeVisible();
    await pickerView(picker, new RegExp(`^Selected ${picked} of ${max}$`));
    await expect(picker.getByRole('list', { name: 'Selected References' }).getByRole('listitem')).toHaveCount(picked);
    await expect(picker.locator('.reference-selected-number').first()).toHaveText('1');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  }
});

// 130: Steps shows on both devices by the same rule, with the same range.
for (const fixed of [false, true]) {
  test(`Steps follows one rule and range on both devices (${fixed ? 'fixed steps' : 'adjustable steps'})`, async ({ page }) => {
    await prepare(page, (models) => {
      for (const profile of models.profiles) {
        if (profile.kind !== 'image') continue;
        profile.capabilities = { ...profile.capabilities, steps: !fixed };
        profile.constraints = { ...profile.constraints, steps: { min: 1, max: 50 } };
        profile.defaults = { ...profile.defaults, steps: 8 };
      }
    });
    await page.goto('/');
    const composer = await studioUi(page).openComposer();
    const value = composer.getByRole('button', { name: /^Steps: / });
    if (fixed) { await expect(value).toHaveCount(0); return; }
    await value.click();
    const input = composer.getByRole('spinbutton', { name: 'Steps', exact: true });
    // practicalStepRange: 8 recommended gives 1–28, inside the profile's 1–50.
    await expect(input).toHaveAttribute('min', '1');
    await expect(input).toHaveAttribute('max', '28');
    await page.keyboard.press('Escape');
  });
}
