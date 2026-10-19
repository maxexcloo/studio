import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities = { ...profile.capabilities, negativePrompt: true };
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
});

test('compact creation keeps a one-line prompt and send aligned through expansion', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The full creation box is a desktop layout.');
  await page.goto('/');
  const composer = page.locator('.zen-prompt');
  const prompt = composer.getByRole('textbox', { name: 'Prompt', exact: true });
  const send = composer.getByRole('button', { name: 'Generate', exact: true });
  const model = composer.locator('.model-trigger');
  await expect(model).toBeHidden();
  await expect(composer).not.toHaveClass(/is-expanded/);
  await expect(composer.locator('.composer-field-tools').first()).toBeHidden();
  const compact = await Promise.all([prompt.boundingBox(), send.boundingBox()]);
  expect(compact[0]!.height).toBeCloseTo(compact[1]!.height, 0);
  expect(compact[0]!.y).toBeCloseTo(compact[1]!.y, 0);
  await expect(page.getByRole('group', { name: 'Prompts to start from' })).toHaveCount(0);
  await prompt.fill('A user-written landscape prompt');
  await expect(composer).toHaveClass(/is-expanded/);
  await expect(model).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Clear Prompt', exact: true })).toBeVisible();
  await model.click();
  await expect(page.locator('.model-menu').getByRole('button', { name: 'Browse Models', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.stage-gallery').click({ position: { x: 150, y: 150 } });
  await expect(composer).not.toHaveClass(/is-expanded/);
  await expect(prompt).toHaveValue('A user-written landscape prompt');
  await expect(composer.locator('.composer-prompt-row .composer-prompt-preview')).toHaveText('A user-written landscape prompt');
  await expect(composer.locator('.composer-prompt-row .composer-prompt-preview')).toHaveCSS('text-overflow', 'ellipsis');
  let submission: Record<string, unknown> | undefined;
  await page.route('**/api/generate', (route) => {
    submission = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Captured submission' } });
  });
  await send.click();
  await expect.poll(() => submission?.prompt).toBe('A user-written landscape prompt');
});

test('long prompts and advanced options remain inside the viewport', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone creation uses its scrollable sheet.');
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto('/');
  const composer = page.locator('.zen-prompt');
  await composer.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Scene detail\n'.repeat(60));
  await composer.getByRole('textbox', { name: 'Negative Prompt', exact: true }).fill('Avoid defects\n'.repeat(60));
  await composer.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced Settings', exact: true });
  await expect(advanced).toBeVisible();
  await expect.poll(() => advanced.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
});

test('phone compact prompt is one muted line with overflow ellipsis', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone compact creation pill.');
  await page.goto('/');
  await page.locator('.phone-create-open').click();
  const text = 'A detailed landscape with mountains and valleys beneath a softly lit sky. '.repeat(4);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(text);
  await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
  const preview = page.locator('.phone-create-open strong');
  await expect(preview).toHaveText(text.trim());
  await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
  await expect(page.locator('.phone-create-open small')).toHaveCount(0);
  const [prompt, send] = await Promise.all([page.locator('.phone-create-open').boundingBox(), page.locator('.phone-go').boundingBox()]);
  expect(prompt!.height).toBe(send!.height);
});

test('phone prompt keeps a usable height when tapped with the keyboard up', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone creation sheet.');
  // iOS Safari: the keyboard shrinks only the visual viewport, so the sheet lifts by the inset and loses that height.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    const state = { height: innerHeight };
    for (const [key, read] of Object.entries({ height: () => state.height, offsetLeft: () => 0, offsetTop: () => 0, scale: () => 1, width: () => innerWidth })) Object.defineProperty(viewport, key, { get: read });
    Object.defineProperty(window, 'visualViewport', { get: () => viewport });
    Object.assign(window, { keyboard: (height: number) => { state.height = innerHeight - height; viewport.dispatchEvent(new Event('resize')); } });
  });
  await page.setViewportSize({ width: 393, height: 660 });
  await page.goto('/');
  await page.locator('.phone-create-open').click();
  const sheet = page.locator('.phone-create');
  const prompt = sheet.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.tap();
  await expect(prompt).toBeFocused();
  await page.evaluate(() => (window as unknown as { keyboard: (height: number) => void }).keyboard(336));
  await expect(page.locator('html')).toHaveClass(/kb-open/);
  await expect.poll(() => prompt.evaluate((field) => {
    // The part of the field left uncovered by every box that could clip it.
    const boxes = [field, field.closest('.phone-sheet-body')!, field.closest('.phone-sheet')!].map((box) => box.getBoundingClientRect());
    return Math.round(Math.min(...boxes.map((box) => box.bottom)) - Math.max(...boxes.map((box) => box.top)));
  })).toBeGreaterThanOrEqual(60);
  const send = sheet.getByRole('button', { name: 'Generate', exact: true });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
});


test('each expanded field owns its clear action and reset clears only the current creation', async ({ page, isMobile }) => {
  let destructiveRequest = false;
  page.on('request', (request) => { if (request.method() === 'DELETE') destructiveRequest = true; });
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt');
  const prompt = root.getByRole('textbox', { name: 'Prompt', exact: true });
  const negative = root.getByRole('textbox', { name: 'Negative Prompt', exact: true });
  await prompt.fill('A scene to retain');
  await negative.fill('Blur and defects');
  for (const field of [prompt, negative]) {
    await expect(field).toHaveAttribute('rows', '2');
    expect(await field.evaluate((element) => element.clientHeight >= parseFloat(getComputedStyle(element).lineHeight) * 2)).toBe(true);
  }
  await root.getByRole('button', { name: 'Clear Prompt', exact: true }).click();
  await expect(prompt).toHaveValue('');
  await expect(negative).toHaveValue('Blur and defects');
  await prompt.fill('A fresh scene');
  await root.getByRole('button', { name: 'Clear Negative Prompt', exact: true }).click();
  await expect(prompt).toHaveValue('A fresh scene');
  await expect(negative).toHaveValue('');
  await negative.fill('Saved negative');
  await root.getByRole('button', { name: 'Reset Creation', exact: true }).click();
  await expect(prompt).toHaveValue('');
  await expect(negative).toHaveValue('');
  expect(destructiveRequest).toBe(false);
  await expect(root.getByRole('button', { name: 'Collapse Creation Box', exact: true })).toHaveCount(0);
});


test('unsupported profiles hide negative prompt without deleting its draft', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.kind === 'image');
  const supported = { ...base, id: 'negative-supported', displayName: 'Negative Supported', capabilities: { ...base.capabilities, negativePrompt: true } };
  const unsupported = { ...base, id: 'negative-unsupported', displayName: 'Negative Unsupported', capabilities: { ...base.capabilities, negativePrompt: false } };
  models.profiles = [supported, unsupported];
  models.defaults.imageModel = supported.id;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt');
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Retain this scene');
  await root.getByRole('textbox', { name: 'Negative Prompt', exact: true }).fill('Retain this negative');
  const choose = async (name: string) => {
    await root.locator(isMobile ? '.phone-model-browse' : '.model-trigger').click();
    const picker = page.locator(isMobile ? '.phone-model-sheet' : '.model-menu');
    await picker.getByRole(isMobile ? 'button' : 'option', { name: new RegExp(name) }).first().click();
  };
  await choose('Negative Unsupported');
  await expect(root.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveCount(0);
  await expect(root.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Retain this scene');
  await choose('Negative Supported');
  await expect(root.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue('Retain this negative');
});

test('creation pickers expose their open state and ignore exiting surfaces when dismissing', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt');
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A neutral control state');
  const loras = root.locator('.composer-resource-add');
  const advanced = root.getByRole('button', { name: 'Advanced Settings', exact: true, includeHidden: true });
  const model = root.locator(isMobile ? '.phone-model-browse' : '.model-trigger');
  await loras.click();
  await expect(loras).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await expect(loras).toHaveAttribute('aria-expanded', 'false');
  await model.click();
  await expect(model).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(model).toHaveAttribute('aria-expanded', 'false');
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
});

test('secondary creation controls share muted, hover and neutral open states without changing Send', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const root = page.locator(isMobile ? '.phone-create' : '.zen-prompt');
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A quiet landscape');
  await page.mouse.move(0, 0);
  const colours = await root.evaluate(element => {
    const probe = document.createElement('i');
    element.appendChild(probe);
    const colour = (value: string) => { probe.style.color = value; return getComputedStyle(probe).color; };
    const background = (value: string) => { probe.style.backgroundColor = value; return getComputedStyle(probe).backgroundColor; };
    const result = { muted: colour('hsl(var(--muted-foreground))'), foreground: colour('hsl(var(--foreground))'), hover: background('var(--control-hover)'), selected: background('var(--selected)') };
    probe.remove();
    return result;
  });
  const loras = root.getByRole('button', { name: 'LoRAs', exact: true });
  const advanced = root.getByRole('button', { name: 'Advanced Settings', exact: true, includeHidden: true });
  const reset = root.getByRole('button', { name: 'Reset Creation', exact: true });
  const model = root.locator(isMobile ? '.phone-model-browse' : '.model-trigger');
  const send = root.getByRole('button', { name: 'Generate', exact: true });
  const sendBefore = await send.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, colour: getComputedStyle(element).color }));
  for (const button of [loras, advanced, reset, model]) {
    await expect(button).toHaveCSS('color', colours.muted);
    await expect(button.locator('svg').first()).toHaveCSS('width', '16px');
    await expect(button.locator('svg').first()).toHaveCSS('height', '16px');
  }
  if (!isMobile) for (const button of [advanced, reset]) await expect(button).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await loras.hover();
  await expect(loras).toHaveCSS('color', colours.foreground);
  await expect(loras).toHaveCSS('background-color', colours.hover);
  await loras.click();
  await page.mouse.move(0, 0);
  await expect(loras).toHaveCSS('background-color', colours.selected);
  await expect(loras).toHaveCSS('color', colours.foreground);
  await page.keyboard.press('Escape');
  await expect(loras).toHaveCSS('color', colours.muted);
  await model.click();
  await page.mouse.move(0, 0);
  await expect(model).toHaveCSS('background-color', colours.selected);
  await page.keyboard.press('Escape');
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await advanced.click();
  await page.mouse.move(0, 0);
  await expect(advanced).toHaveCSS('background-color', colours.selected);
  await expect(advanced).toHaveCSS('color', colours.foreground);
  await page.keyboard.press('Escape');
  await expect(advanced).toHaveCSS('color', colours.muted);
  await expect(send).toHaveCSS('background-color', sendBefore.background);
  await expect(send).toHaveCSS('color', sendBefore.colour);
  if (!isMobile) {
    const settings = page.locator('.studio-dock').getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveCSS('color', colours.muted);
    await settings.hover();
    await expect(settings).toHaveCSS('color', colours.foreground);
    await expect(settings).toHaveCSS('background-color', colours.hover);
  }
});
