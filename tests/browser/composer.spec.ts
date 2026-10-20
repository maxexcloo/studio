import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities = { ...profile.capabilities, negativePrompt: true };
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
});

test('compact creation keeps a one-line prompt and send aligned through expansion', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The full creation box is a desktop layout.');
  await page.goto('/');
  const ui = studioUi(page);
  const { composer, prompt, generate: send, modelTrigger: model } = ui;
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
  await expect(ui.modelPicker.getByRole('button', { name: 'Browse Models', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await ui.gallery.click({ position: { x: 150, y: 150 } });
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
  const ui = studioUi(page);
  await ui.prompt.fill('Scene detail\n'.repeat(60));
  await ui.negativePrompt.fill('Avoid defects\n'.repeat(60));
  await ui.composer.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
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
  const ui = studioUi(page);
  await ui.openComposer();
  const text = 'A detailed landscape with mountains and valleys beneath a softly lit sky. '.repeat(4);
  await ui.prompt.fill(text);
  await ui.closeComposer();
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
  const ui = studioUi(page);
  const sheet = await ui.openComposer();
  const prompt = ui.prompt;
  await prompt.tap();
  await expect(prompt).toBeFocused();
  await page.evaluate(() => (window as unknown as { keyboard: (height: number) => void }).keyboard(336));
  await expect(page.locator('html')).toHaveClass(/kb-open/);
  await expect.poll(() => prompt.evaluate((field) => {
    // The part of the field left uncovered by every box that could clip it.
    const boxes = [field, field.closest('.phone-sheet-body')!, field.closest('.phone-sheet')!].map((box) => box.getBoundingClientRect());
    return Math.round(Math.min(...boxes.map((box) => box.bottom)) - Math.max(...boxes.map((box) => box.top)));
  })).toBeGreaterThanOrEqual(60);
  const send = ui.generate;
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
});


test('the phone Create sheet stays in the visible viewport while the keyboard is up, and comes back after', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone creation sheet.');
  // iOS Safari: the keyboard shrinks the visual viewport and pans it down to the focused field (offsetTop).
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    const state = { height: innerHeight, top: 0 };
    for (const [key, read] of Object.entries({ height: () => state.height, offsetLeft: () => 0, offsetTop: () => state.top, scale: () => 1, width: () => innerWidth })) Object.defineProperty(viewport, key, { get: read });
    Object.defineProperty(window, 'visualViewport', { get: () => viewport });
    Object.assign(window, { keyboard: (height: number, pan: number) => { state.height = innerHeight - height - pan; state.top = pan; viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); } });
  });
  await page.goto('/');
  await page.locator('.phone-create-open').click();
  const sheet = page.locator('.phone-create');
  const prompt = sheet.getByRole('textbox', { name: 'Prompt', exact: true });
  const send = sheet.getByRole('button', { name: 'Generate', exact: true });
  await prompt.tap();
  await expect(prompt).toBeFocused();
  const closedTop = (await sheet.boundingBox())!.y;
  // A 336 px keyboard, with the page panned 120 px up to the field.
  const visible = { top: 120, bottom: 0 };
  visible.bottom = await page.evaluate(() => { (window as unknown as { keyboard: (height: number, pan: number) => void }).keyboard(336, 120); return innerHeight - 336; });
  await expect(page.locator('html')).toHaveClass(/kb-open/);
  // The sheet's top, the focused field and Generate are all within what is visible.
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(visible.top);
  await expect.poll(async () => (await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height).toBeLessThanOrEqual(visible.bottom + 1);
  const inside = async (box: { y: number; height: number } | null) => box!.y >= visible.top - 1 && box!.y + box!.height <= visible.bottom + 1;
  await expect.poll(async () => inside(await prompt.boundingBox())).toBe(true);
  await send.scrollIntoViewIfNeeded();
  await expect.poll(async () => inside(await send.boundingBox())).toBe(true);
  // Keyboard down: the sheet goes back where it was.
  await page.evaluate(() => (window as unknown as { keyboard: (height: number, pan: number) => void }).keyboard(0, 0));
  await expect(page.locator('html')).not.toHaveClass(/kb-open/);
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.y)).toBe(Math.round(closedTop));
});

test('each expanded field owns its clear action and reset clears only the current creation', async ({ page }) => {
  let destructiveRequest = false;
  page.on('request', (request) => { if (request.method() === 'DELETE') destructiveRequest = true; });
  await page.goto('/');
  const ui = studioUi(page);
  const root = await ui.openComposer();
  const { prompt, negativePrompt: negative } = ui;
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


test('unsupported profiles hide negative prompt without deleting its draft', async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.kind === 'image');
  const supported = { ...base, id: 'negative-supported', displayName: 'Negative Supported', capabilities: { ...base.capabilities, negativePrompt: true } };
  const unsupported = { ...base, id: 'negative-unsupported', displayName: 'Negative Unsupported', capabilities: { ...base.capabilities, negativePrompt: false } };
  models.profiles = [supported, unsupported];
  models.defaults.imageModel = supported.id;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  await ui.prompt.fill('Retain this scene');
  await ui.negativePrompt.fill('Retain this negative');
  await ui.chooseModel('Negative Unsupported');
  await expect(ui.negativePrompt).toHaveCount(0);
  await expect(ui.prompt).toHaveValue('Retain this scene');
  await ui.chooseModel('Negative Supported');
  await expect(ui.negativePrompt).toHaveValue('Retain this negative');
});

test('creation pickers expose their open state and ignore exiting surfaces when dismissing', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const root = await ui.openComposer();
  await ui.prompt.fill('A neutral control state');
  const loras = root.getByRole('button', { name: 'LoRAs', exact: true, includeHidden: true });
  const advanced = root.getByRole('button', { name: 'Advanced Settings', exact: true, includeHidden: true });
  const model = ui.modelTrigger;
  await loras.click();
  await expect(loras).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await expect(loras).toHaveAttribute('aria-expanded', 'false');
  await model.click();
  await expect(model).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(model).toHaveAttribute('aria-expanded', 'false');
  await ui.prompt.focus();
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
});

test('secondary creation controls share muted, hover and neutral open states without changing Send', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const root = await ui.openComposer();
  const phone = await ui.isPhone();
  await ui.prompt.fill('A quiet landscape');
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
  const loras = root.getByRole('button', { name: 'LoRAs', exact: true, includeHidden: true });
  const advanced = root.getByRole('button', { name: 'Advanced Settings', exact: true, includeHidden: true });
  const reset = root.getByRole('button', { name: 'Reset Creation', exact: true });
  const model = ui.modelTrigger;
  const send = ui.generate;
  const sendBefore = await send.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, colour: getComputedStyle(element).color }));
  for (const button of [loras, advanced, reset, model]) {
    await expect(button).toHaveCSS('color', colours.muted);
    await expect(button.locator('svg').first()).toHaveCSS('width', '16px');
    await expect(button.locator('svg').first()).toHaveCSS('height', '16px');
  }
  // The full studio's square buttons keep an invisible border; the phone's have none.
  if (!phone) for (const button of [advanced, reset]) await expect(button).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
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
  await ui.prompt.focus();
  await advanced.click();
  await page.mouse.move(0, 0);
  await expect(advanced).toHaveCSS('background-color', colours.selected);
  await expect(advanced).toHaveCSS('color', colours.foreground);
  await page.keyboard.press('Escape');
  await expect(advanced).toHaveCSS('color', colours.muted);
  await expect(send).toHaveCSS('background-color', sendBefore.background);
  await expect(send).toHaveCSS('color', sendBefore.colour);
  // Only the full studio has a dock.
  if (!phone) {
    const settings = page.locator('.studio-dock').getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveCSS('color', colours.muted);
    await settings.hover();
    await expect(settings).toHaveCSS('color', colours.foreground);
    await expect(settings).toHaveCSS('background-color', colours.hover);
  }
});
