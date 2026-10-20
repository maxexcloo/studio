import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

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
  const picker = page.getByRole('group', { name: 'LoRA Library', exact: true });
  await expect(picker.getByRole('textbox', { name: 'Search LoRAs', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Manage Stack', exact: true })).toHaveCount(0);
  await expect(picker.getByText('Uses file metadata.', { exact: false })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'This Model', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('.lora-option-preview')).toHaveCount(0);
  await expect(picker.getByText('Compatibility has not been verified for this model variant.', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('Excluded Conditioning', { exact: true })).toHaveCount(0);
  await expect(picker.getByText('Unknown Effect', { exact: true }).first()).toBeVisible();
  await picker.getByRole('button', { name: 'All Models', exact: true }).click();
  await expect(picker.getByText('Excluded Conditioning', { exact: true }).first()).toBeVisible();
  // Shown under All Models, an incompatible LoRA says why and can't be added.
  const excluded = picker.getByRole('checkbox', { name: 'Select Excluded Conditioning', exact: true });
  await expect(excluded).toBeDisabled();
  await expect(picker.getByText('This LoRA does not support the selected model variant.', { exact: true }).first()).toBeVisible();
  await picker.getByRole('button', { name: 'This Model', exact: true }).click();
  await expect(picker.getByText('Excluded Conditioning', { exact: true })).toHaveCount(0);
  await picker.getByRole('checkbox', { name: 'Select Published Slider', exact: true }).click();
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
    const library = await page.evaluate(() => JSON.parse(localStorage.getItem('heiss-ui-lora-library') || '{}'));
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
  // A sheet on the phone, a popover over the full studio's composer.
  await expect(surface).toHaveClass(phone ? /is-sheet/ : /composer-loras/);
  await expect.poll(() => surface.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  const picker = page.getByRole('group', { name: 'LoRA Library', exact: true });
  const search = picker.getByRole('textbox', { name: 'Search LoRAs', exact: true });
  await expect(search).toBeVisible();
  await expect(picker.locator('.lora-option-preview')).toHaveCount(0);
  await expect.poll(() => picker.locator('.lora-picker-items').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
  await search.fill('Cards Two');
  const row = picker.getByRole('checkbox', { name: 'Select Cards Two', exact: true });
  await expect(picker.getByRole('checkbox', { name: 'Select Cards One', exact: true })).toHaveCount(0);
  await row.focus();
  await row.press('Space');
  await expect(row).toHaveAttribute('aria-checked', 'true');
  const strength = picker.getByLabel('Cards Two Strength Value', { exact: true });
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
      await expect.poll(async () => {
        const composer = await ui.composer.boundingBox();
        const popover = await surface.boundingBox();
        return Math.abs(popover!.width - composer!.width) < 1 && Math.abs(popover!.x - composer!.x) < 1;
      }).toBe(true);
    }
  }
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await expect(strength).toHaveCount(0);
  await row.click();
  await expect(picker.getByRole('button', { name: 'Manage Stack', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cards Two Strength Value', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: /^Save Stack/ }).click();
  await picker.getByRole('textbox', { name: 'Stack Name', exact: true }).fill('Inline Stack');
  await picker.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(picker.getByRole('textbox', { name: 'Search LoRAs', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Disable All', exact: true }).click();
  await expect(strength).toBeDisabled();
  await picker.getByRole('button', { name: 'Enable All', exact: true }).click();
  await expect(strength).toBeEnabled();
  await picker.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await page.locator('.status-message').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await search.clear();
  const other = picker.getByRole('checkbox', { name: 'Select Cards One', exact: true });
  const before = await other.boundingBox();
  await other.click();
  // A pick stays where it was clicked; it doesn't jump away from the pointer.
  await expect.poll(async () => Math.abs((await other.boundingBox())!.y - before!.y)).toBeLessThan(2);
  await picker.getByLabel('Information About Cards One', { exact: true }).click();
  await expect(picker.getByText('Use for printed card illustrations.', { exact: true })).toBeVisible();
  await expect(picker.getByRole('link', { name: 'View Source' })).toHaveAttribute('href', 'https://example.com/cards');
  await expect(other).toHaveAttribute('aria-checked', 'true');
  // Rows never move: the stack order shows in the Selected tab, where they reorder by drag, grip keys or Move.
  const firstRow = await picker.getByRole('checkbox').first().getAttribute('aria-label');
  await expect(picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: /^Selected 2 of / }).click();
  await picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true }).press('ArrowUp');
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Move Cards One Down', exact: true }).click();
  await picker.getByRole('button', { name: 'Move Cards One Up', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Drag Cards One to Reorder', exact: true }).dragTo(picker.getByRole('checkbox', { name: 'Select Cards Two', exact: true }));
  await expect(picker.getByRole('button', { name: 'Move Cards Two Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Move Cards One Up', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Move Cards One Up', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'This Model', exact: true }).click();
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
  const fineTune = { ...original, family: 'krea2', baseModel: 'tesserafineTurboBF16FP8_v10_3291478.safetensors', label: 'Tesserafine Turbo · Fast · 8 Steps · V1.0 · INT8 ConvRot', displayName: 'Tesserafine Turbo · Fast · 8 Steps · V1.0 · INT8 ConvRot', recipe: { modelLabel: 'Tesserafine Turbo', conditioning: 'Image', label: 'Turbo · 8 Steps', adapters: [] }, options: { ...original.options, loras: ['krea.safetensors', 'flux3.safetensors', 'unknown.safetensors'] } };
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
  await expect(menu.getByText('Krea (Fine Tunes)', { exact: true })).toBeVisible();
  const row = ui.modelOptions.filter({ hasText: 'Tesserafine Turbo' }).first();
  await expect(row).toContainText('V1.0');
  await expect(row).toContainText('INT8 ConvRot');
  await row.click();
  await ui.composer.getByRole('button', { name: /^LoRAs/ }).click();
  const surface = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  await expect(surface).toHaveClass(await ui.isPhone() ? /is-sheet/ : /composer-loras/);
  await expect.poll(() => surface.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  const picker = page.getByRole('group', { name: 'LoRA Library', exact: true });
  await expect(picker.getByText('Krea Effect', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('Unknown Effect', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('FLUX.3 Effect', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'All Models', exact: true }).click();
  await expect(picker.getByText('FLUX.3 Effect', { exact: true }).first()).toBeVisible();
  // Another family's LoRA is listed with its reason, never added (a Z-Image LoRA on Tesserafine).
  const crossFamily = picker.getByRole('checkbox', { name: 'Select FLUX.3 Effect', exact: true });
  await expect(crossFamily).toBeDisabled();
  await expect(crossFamily).toHaveAttribute('aria-checked', 'false');
  await expect(picker.getByText(/does not support the selected model variant \(made for FLUX\.3 Klein\)/).first()).toBeVisible();
  await picker.getByRole('button', { name: 'This Model', exact: true }).click();
  await expect(crossFamily).toHaveCount(0);
});
