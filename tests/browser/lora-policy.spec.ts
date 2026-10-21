import { expect, test } from '@playwright/test';
import { expectPickerView, pickerSearch, pickerView, studioUi } from './helpers/ui';

test('optional LoRAs show unverified variants and expose full published strength bounds', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  Object.assign(base, { family: 'boogu', baseModel: 'boogu_edit.safetensors', recipe: { modelLabel: 'Boogu Edit Test', conditioning: 'Generate', label: 'Standard', adapters: [] }, options: { ...base.options, loras: ['slider.safetensors', 'excluded.safetensors', 'unknown.safetensors'] } });
  models.loras = base.options.loras;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: {
    'slider.safetensors': { title: 'Published Slider', families: ['boogu'], base: 'Boogu', triggers: [], compatibility: { baseModels: ['boogu_base.safetensors'] }, strengthRange: { min: -3, max: 10, step: 0.05 } },
    'excluded.safetensors': { title: 'Excluded Conditioning', families: ['boogu'], base: 'Boogu', triggers: [], compatibility: { conditionings: ['Reference'], unlisted: 'other' } },
    'unknown.safetensors': { title: 'Unknown Effect', families: [], base: '', triggers: [] },
  } } }));
  await page.goto('/');
  const composer = await studioUi(page).openComposer();
  await composer.getByRole('button', { name: /^LoRAs/ }).click();
  // The views, Stacks, Clear and search sit in the surface's heading (UI-PATTERNS › Pickers).
  const picker = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  // Search stays behind its icon until asked for.
  await expect(picker.getByRole('textbox', { name: 'Search LoRAs', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Search LoRAs', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Manage Stack', exact: true })).toHaveCount(0);
  await expect(picker.getByText('Uses file metadata.', { exact: false })).toHaveCount(0);
  await expectPickerView(picker, 'This Model');
  await expect(picker.locator('.lora-option-preview')).toHaveCount(0);
  await expect(picker.getByText('Compatibility has not been verified for this model variant.', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('Excluded Conditioning', { exact: true })).toHaveCount(0);
  await expect(picker.getByText('Unknown Effect', { exact: true }).first()).toBeVisible();
  // This Model is one section, the model family's LoRAs: no Suggested or Favourites heading of its own.
  await expect(picker.locator('.lora-picker-heading')).toHaveCount(1);
  await expect(picker.getByText('Suggested', { exact: true })).toHaveCount(0);
  // The search icon follows the views, before Stacks and Clear.
  const views = (await picker.locator('.picker-heading-tools > .picker-controls, .dropdown-trigger.picker-view').first().boundingBox())!;
  const searchIcon = (await picker.getByRole('button', { name: 'Search LoRAs', exact: true }).boundingBox())!;
  expect(searchIcon.x).toBeGreaterThanOrEqual(views.x + views.width - 1);
  await pickerView(picker, 'All');
  await expect(picker.getByText('Excluded Conditioning', { exact: true }).first()).toBeVisible();
  // Shown under All Models, an incompatible LoRA says why and can't be added.
  const excluded = picker.getByRole('checkbox', { name: 'Select Excluded Conditioning', exact: true });
  await expect(excluded).toBeDisabled();
  await expect(picker.getByText('This LoRA does not support the selected model variant.', { exact: true }).first()).toBeVisible();
  await pickerView(picker, 'This Model');
  await expect(picker.getByText('Excluded Conditioning', { exact: true })).toHaveCount(0);
  const slider0 = picker.getByRole('checkbox', { name: 'Select Published Slider', exact: true });
  await slider0.click();
  // A pick shows the amber tick in place, as in Models; its number and strength are in the Selected view.
  await expect(slider0.locator('.selected-tick:not(.is-off)')).toHaveCount(1);
  await expect(slider0.locator('.picker-order')).toHaveCount(0);
  await expect(page.getByLabel('Published Slider Strength Value', { exact: true })).toHaveCount(0);
  await pickerView(picker, /^Selected 1 of/);
  const value = page.getByLabel('Published Slider Strength Value', { exact: true }).filter({ visible: true });
  await value.fill('10');
  await value.press('Enter');
  await expect(value).toHaveValue('10.00');
  const slider = page.getByLabel('Published Slider Strength', { exact: true }).filter({ visible: true });
  await expect(slider).toHaveAttribute('min', '-3');
  await expect(slider).toHaveAttribute('max', '10');
  await value.press('ArrowUp');
  await expect(value).toHaveValue('10.00');
  await value.fill('-3');
  await value.press('Enter');
  await expect(value).toHaveValue('-3.00');
  await value.press('ArrowDown');
  await expect(value).toHaveValue('-3.00');
});

test('LoRA library offers direct list selection with inline strengths and accessible dismissal', async ({ page }) => {
  await page.route('**/api/loras/library/ops', async route => {
    const library = await page.evaluate(() => JSON.parse(localStorage.getItem('studio-lora-library') || '{}'));
    await route.fulfill({ json: { library } });
  });
  const models = await (await page.request.get('/api/models')).json();
  const profile = models.profiles.find((item: any) => item.id === models.defaults.imageModel);
  profile.options.loras = ['cards-one.safetensors', 'cards-two.safetensors'];
  models.loras = profile.options.loras;
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  await page.route('**/api/loras/info', route => route.fulfill({ json: { loras: {
    'cards-one.safetensors': { title: 'Cards One', families: [], base: '', triggers: ['ink'], description: 'Use for printed card illustrations.', sourceUrl: 'https://example.com/cards' },
    'cards-two.safetensors': { title: 'Cards Two', families: [], base: '', triggers: [] }
  } } }));
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  const phone = await ui.isPhone();
  await composer.getByRole('button', { name: 'LoRAs', exact: true, includeHidden: true }).click();
  const surface = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  // A pop-up over Create on the phone, a popover over the desktop composer.
  await expect(surface).toHaveClass(phone ? /is-pop/ : /composer-loras/);
  await expect.poll(() => surface.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  const picker = surface;
  const search = await pickerSearch(picker, 'Search LoRAs');
  await expect(picker.locator('.lora-option-preview')).toHaveCount(0);
  await expect.poll(() => picker.locator('.lora-picker-items').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
  await search.fill('Cards Two');
  const row = picker.getByRole('checkbox', { name: 'Select Cards Two', exact: true });
  await expect(picker.getByRole('checkbox', { name: 'Select Cards One', exact: true })).toHaveCount(0);
  await row.focus();
  await row.press('Space');
  await expect(row).toHaveAttribute('aria-checked', 'true');
  // Picking doesn't open anything under the row: nothing in the list moves.
  const strength = picker.getByLabel('Cards Two Strength Value', { exact: true });
  await expect(strength).toHaveCount(0);
  await pickerView(picker, /^Selected 1 of/);
  await expect(strength).toBeVisible();
  await strength.fill('1.25');
  await strength.press('Enter');
  await expect(strength).toHaveValue('1.25');
  await expect(row).toHaveAttribute('aria-checked', 'true');
  for (const width of phone ? [390, 320] : [900]) {
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await expect.poll(() => surface.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const children = [...element.querySelectorAll('.lora-library-row, .lora-library-settings, .lora-library-settings input')];
      return children.every(child => { const box = child.getBoundingClientRect(); return box.left >= bounds.left && box.right <= bounds.right + 1; });
    })).toBe(true);
    if (!phone) {
      // Above the button that opened it, start-aligned and kept 8px inside the screen (UI-PATTERNS › Surfaces).
      const opener = ui.composer.getByRole('button', { name: 'LoRAs', exact: true }).first();
      await expect.poll(async () => {
        const trigger = await opener.boundingBox();
        const popover = await surface.boundingBox();
        return popover!.y + popover!.height <= trigger!.y + 1 && Math.abs(popover!.x - Math.min(trigger!.x, width - 8 - popover!.width)) < 1.5 && popover!.x >= 7;
      }).toBe(true);
    }
  }
  await row.click();
  await expect(strength).toHaveCount(0);
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(picker.getByRole('button', { name: 'Manage Stack', exact: true })).toHaveCount(0);
  await pickerView(picker, /^Selected 1 of/);
  await expect(page.getByLabel('Cards Two Strength Value', { exact: true })).toBeVisible();
  // Stacks live in the heading's Stacks dropdown; there is no footer and no Enable All or Disable All.
  await expect(picker.getByRole('button', { name: /^(Enable|Disable) All$/ })).toHaveCount(0);
  // Stacks are a desktop tool; the phone heading leaves them out (Settings › Studio › LoRA Stacks edits them).
  if (phone) await expect(picker.getByRole('combobox', { name: 'Stacks', exact: true })).toHaveCount(0);
  else {
    await picker.getByRole('combobox', { name: 'Stacks', exact: true }).click();
    await page.locator('.dropdown-menu').getByRole('button', { name: 'Save Current as New Stack', exact: true }).click();
    await page.locator('.dropdown-menu').getByRole('textbox', { name: 'Stack Name', exact: true }).fill('Inline Stack');
    await page.locator('.dropdown-menu').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(picker.getByRole('combobox', { name: 'Stacks: Inline Stack', exact: true })).toBeVisible();
  }
  // The search icon stays in the heading, open or not.
  await expect(picker.getByRole('button', { name: 'Search LoRAs', exact: true })).toBeVisible();
  // Each pick turns off and on with its own switch in the Selected view.
  await picker.getByRole('switch', { name: 'Turn Off Cards Two', exact: true }).click();
  await expect(strength).toBeDisabled();
  await expect(picker.locator('.lora-info-panel')).toHaveCount(0);
  await expect(picker.getByText('cards-two.safetensors', { exact: true })).toHaveCount(0);
  await picker.getByRole('switch', { name: 'Turn On Cards Two', exact: true }).click();
  await expect(strength).toBeEnabled();
  // With nothing published about it, an enabled LoRA shows no empty information panel and never its file name.
  await expect(picker.getByRole('region', { name: 'Cards Two Information', exact: true })).toHaveCount(0);
  await expect(picker.getByText('cards-two.safetensors', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await page.locator('.status-message').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  // The query stays across views; clearing it shows every LoRA again.
  if (await search.count()) await search.clear();
  const other = picker.getByRole('checkbox', { name: 'Select Cards One', exact: true });
  const before = await other.boundingBox();
  await other.click();
  // A pick stays where it was clicked; it doesn't jump away from the pointer.
  await expect.poll(async () => Math.abs((await other.boundingBox())!.y - before!.y)).toBeLessThan(2);
  // Browsing, a row is its name and one line of description, as in Models; nothing opens under it.
  await expect(picker.locator('[data-lora-name="cards-one.safetensors"] .lora-option-copy em')).toHaveText('Use for printed card illustrations.');
  await expect(picker.getByRole('region', { name: 'Cards One Information', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('link', { name: 'View Cards One on Source', exact: true })).toHaveAttribute('href', 'https://example.com/cards');
  await expect(other).toHaveAttribute('aria-checked', 'true');
  // Rows never move: the stack order shows in the Selected tab, where they reorder by drag, grip keys or Move.
  const firstRow = await picker.getByRole('checkbox').first().getAttribute('aria-label');
  await expect(picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true })).toHaveCount(0);
  await pickerView(picker, /^Selected 2 of /);
  // In the Selected view an enabled pick shows its information in full, in place of the one-line description.
  await expect(picker.getByRole('region', { name: 'Cards One Information', exact: true })).toBeVisible();
  await expect(picker.getByRole('region', { name: 'Cards One Information', exact: true }).getByText('Use for printed card illustrations.', { exact: true })).toBeVisible();
  await expect(picker.locator('[data-lora-name="cards-one.safetensors"] .lora-option-copy em')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true }).press('ArrowUp');
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Move Cards One Down', exact: true }).click();
  await picker.getByRole('button', { name: 'Move Cards One Up', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true }).dragTo(picker.getByRole('checkbox', { name: 'Select Cards Two', exact: true }));
  await expect(picker.getByRole('button', { name: 'Move Cards Two Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Move Cards One Up', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await pickerView(picker, 'This Model');
  await expect(picker.getByRole('checkbox').first()).toHaveAttribute('aria-label', firstRow!);
  await surface.getByRole('button', { name: 'Close LoRAs', exact: true }).click();
  await expect(surface).not.toBeVisible();
  const open = ui.composer.getByRole('button', { name: 'LoRAs', exact: true, includeHidden: true });
  await open.click();
  await expect(surface).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  // The phone sheet covers its own trigger; the full studio's toggles from it.
  if (!phone) {
    await open.click();
    await expect(surface).not.toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(surface).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(surface).not.toBeVisible();
  await open.click();
  await expect(surface).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(surface).not.toBeVisible();
  if (!phone) {
    await page.setViewportSize({ width: 900, height: 700 });
    await ui.prompt.fill('A detailed landscape\n'.repeat(60));
    await open.click();
    await expect(surface).toBeVisible();
    await expect.poll(() => surface.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    })).toBe(true);
  }
});


test('fine-tunes retain their family, version and format while optional LoRAs filter by architecture', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const original = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  const fineTune = { ...original, family: 'krea2', baseModel: 'tesserafineTurboBF16FP8_v10_3291478.safetensors', label: 'Tesserafine Turbo · Fast · 8 Steps · V1.0 · INT8 ConvRot', displayName: 'Tesserafine Turbo · Fast · 8 Steps · V1.0 · INT8 ConvRot', recipe: { modelLabel: 'Tesserafine Turbo', conditioning: 'Image', label: 'Turbo · 8 Steps', adapters: [] }, loraNote: 'Up to rank 64 in total', options: { ...original.options, loras: ['krea.safetensors', 'flux3.safetensors', 'unknown.safetensors'] } };
  models.profiles = [...models.profiles.filter((profile: any) => profile.kind !== 'image'), fineTune];
  models.loras = fineTune.options.loras;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: {
    'krea.safetensors': { title: 'Krea Effect', families: ['krea2'], base: 'Krea 2', triggers: [] },
    'flux3.safetensors': { title: 'FLUX.3 Effect', families: ['flux3_klein'], base: 'FLUX.3 Klein', triggers: [] },
    'unknown.safetensors': { title: 'Unknown Effect', families: [], base: '', triggers: [] },
  } } }));
  await page.goto('/');
  const ui = studioUi(page);
  const menu = await ui.openModelPicker();
  await expect(menu.getByText('Krea 2', { exact: true })).toBeVisible();
  const row = ui.modelOptions.filter({ hasText: 'Tesserafine Turbo' }).first();
  await expect(row).toContainText('V1.0');
  await expect(row).toContainText('INT8 ConvRot');
  await row.click();
  await ui.composer.getByRole('button', { name: /^LoRAs/ }).click();
  const surface = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  await expect(surface).toHaveClass(await ui.isPhone() ? /is-pop/ : /composer-loras/);
  await expect.poll(() => surface.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  const picker = surface;
  // A profile's LoRA limit shows as a quiet line under the heading (Radiance video's single rank-64 slot).
  await expect(picker.getByText('Up to rank 64 in total', { exact: true })).toBeVisible();
  await expect(picker.getByText('Krea Effect', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('Unknown Effect', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('FLUX.3 Effect', { exact: true })).toHaveCount(0);
  await pickerView(picker, 'All');
  await expect(picker.getByText('FLUX.3 Effect', { exact: true }).first()).toBeVisible();
  // Another family's LoRA is listed with its reason, never added (a Z-Image LoRA on Tesserafine).
  const crossFamily = picker.getByRole('checkbox', { name: 'Select FLUX.3 Effect', exact: true });
  await expect(crossFamily).toBeDisabled();
  await expect(crossFamily).toHaveAttribute('aria-checked', 'false');
  await expect(picker.getByText(/does not support the selected model variant \(made for FLUX\.3 Klein\)/).first()).toBeVisible();
  await pickerView(picker, 'This Model');
  await expect(crossFamily).toHaveCount(0);
});

test('LoRA stacks apply, update, rename and delete from the Stacks menu with Undo, and edit in Settings', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The Stacks menu is a desktop heading tool; the phone has none.');
  await page.route('**/api/loras/library/ops', async route => {
    const library = await page.evaluate(() => JSON.parse(localStorage.getItem('studio-lora-library') || '{}'));
    await route.fulfill({ json: { library } });
  });
  const models = await (await page.request.get('/api/models')).json();
  const profile = models.profiles.find((item: any) => item.id === models.defaults.imageModel);
  profile.options.loras = ['ink.safetensors', 'grain.safetensors'];
  models.loras = profile.options.loras;
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  await page.route('**/api/loras/info', route => route.fulfill({ json: { loras: {
    'ink.safetensors': { title: 'Ink', families: [], base: '', triggers: [] },
    'grain.safetensors': { title: 'Grain', families: [], base: '', triggers: [] },
  } } }));
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await composer.getByRole('button', { name: 'LoRAs', exact: true, includeHidden: true }).click();
  const picker = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  const ink = picker.getByRole('checkbox', { name: 'Select Ink', exact: true });
  const grain = picker.getByRole('checkbox', { name: 'Select Grain', exact: true });
  // The Stacks dropdown's menu floats on the page (Dropdown.tsx); its choices are options, its commands buttons.
  const menu = page.locator('.dropdown-menu');
  const openStacks = async () => { await picker.getByRole('combobox', { name: /^Stacks/ }).click(); await expect(menu).toBeVisible(); };
  await ink.click();
  await openStacks();
  await menu.getByRole('button', { name: 'Save Current as New Stack', exact: true }).click();
  await menu.getByRole('textbox', { name: 'Stack Name', exact: true }).fill('Zebra');
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  await grain.click();
  await openStacks();
  await menu.getByRole('button', { name: 'Save Current as New Stack', exact: true }).click();
  await menu.getByRole('textbox', { name: 'Stack Name', exact: true }).fill('Alpha');
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  // Alphabetical, the one in use ticked.
  await openStacks();
  await expect(menu.getByRole('option')).toHaveText([/^Alpha/, /^Zebra/]);
  await expect(menu.getByRole('option', { name: /^Alpha/ })).toHaveAttribute('aria-selected', 'true');
  // Choosing a stack applies it at once, with Undo.
  await menu.getByRole('option', { name: /^Zebra/ }).click();
  await expect(grain).toHaveAttribute('aria-checked', 'false');
  // The newest host shows the message: the pop-up's heading on the phone (UI-PATTERNS › Messages).
  const undoButton = page.locator('.status-message').getByRole('button', { name: 'Undo', exact: true });
  const undo = async () => { await expect(undoButton).toHaveCount(1); await undoButton.click(); };
  await undo();

  await expect(grain).toHaveAttribute('aria-checked', 'true');
  // Update the stack in use with the current picks, rename it, then delete it with Undo.
  await openStacks();
  await menu.getByRole('option', { name: /^Zebra/ }).click();
  await grain.click();
  await openStacks();
  await menu.getByRole('button', { name: 'Update “Zebra” with Current Picks', exact: true }).click();
  await openStacks();
  await expect(menu.getByRole('option', { name: 'Zebra, 2 LoRAs', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Rename “Zebra”', exact: true }).click();
  await menu.getByRole('textbox', { name: 'Stack Name', exact: true }).fill('Yak');
  await menu.getByRole('button', { name: 'Rename', exact: true }).click();
  await openStacks();
  await menu.getByRole('button', { name: 'Delete “Yak”', exact: true }).click();
  await openStacks();
  await expect(menu.getByRole('option')).toHaveText([/^Alpha/]);
  // Escape closes the menu only; the picker stays open.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(picker).toBeVisible();
  await undo();
  await openStacks();
  await expect(menu.getByRole('option')).toHaveText([/^Alpha/, /^Yak/]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await ui.closeComposer();
  // Settings › Studio › LoRA Stacks: open a stack, change a strength and remove a LoRA, then Save.
  await ui.openSettings();
  await page.getByRole('navigation', { name: 'Settings Sections' }).getByRole('button', { name: 'Studio', exact: true }).click();
  const group = page.locator('.set-group').filter({ has: page.getByRole('heading', { name: 'LoRA Stacks', exact: true }) });
  await group.getByRole('button', { name: /^Yak/ }).click();
  const editor = group.getByRole('group', { name: 'Edit Yak', exact: true });
  await editor.getByRole('spinbutton', { name: 'Ink Strength', exact: true }).fill('0.5');
  await editor.getByRole('button', { name: 'Remove Grain From Yak', exact: true }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(group.getByRole('button', { name: /^Yak/ })).toContainText('1 LoRA');
  const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.includes('studio-lora-library'))!) || '{}').snapshots || {}).flat() as any[]);
  expect(saved.find((stack: any) => stack.name === 'Yak').loras).toEqual([expect.objectContaining({ name: 'ink.safetensors', strength: 0.5 })]);
});
