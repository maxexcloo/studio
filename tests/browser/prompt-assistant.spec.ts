import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';
import { fakeKeyboard, raiseKeyboard } from './helpers/text-focus';

// The prompt assistant in the composer (UI-PATTERNS › Composer): the magic button streams a rewrite
// into the prompt with Undo and History, and suggested LoRAs add with their trigger words.
const presets = [
  { id: 'enhance', label: 'Enhance', description: 'Richer detail.' },
  { id: 'photographic', label: 'Photographic', description: 'A real photograph.' },
  { id: 'cinematic', label: 'Cinematic', description: 'A film still.' },
];
const suggestions = [
  { name: 'glow.safetensors', title: 'Glow', strength: 0.8, triggers: ['glowfx'], reason: 'Soft light' },
  { name: 'mist.safetensors', title: 'Mist', strength: 0.6, triggers: ['mistyx'], reason: 'Fog' },
];
/** The status pill showing these words (a replaced one may still be leaving). */
const pill = (page: Page, text: string) => page.locator('[data-status-message] .status-pill-body').filter({ hasText: text });
const sse = (events: Array<[string, unknown]>) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

async function mockStudio(page: Page) {
  const models = await (await page.request.get('/api/models')).json();
  const profile = models.profiles.find((item: any) => item.id === models.defaults.imageModel);
  profile.capabilities = { ...profile.capabilities, negativePrompt: true, lora: true };
  profile.options = { ...profile.options, loras: suggestions.map((item) => item.name) };
  models.loras = profile.options.loras;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/loras/*', (route) => route.fulfill({ json: { found: false, loras: [] } }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: Object.fromEntries(suggestions.map((item) => [item.name, { title: item.title, families: [profile.family], base: '', triggers: item.triggers }])) } }));
  await page.route('**/api/assistant', (route) => route.fulfill({ json: { ok: true, available: true, presets, defaultPreset: 'enhance', vision: false, loras: true, spicy: false, noNegative: [] } }));
  const recorded: Array<{ text: string; kind: string }> = [];
  await page.route('**/api/prompts/record', async (route) => { recorded.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, prompts: [] } }); });
  await page.route('**/api/assistant/negative', (route) => route.fulfill({ json: { ok: true, negative: 'blurry, extra fingers', unused: false } }));
  await page.route('**/api/assistant/loras', (route) => route.fulfill({ json: { ok: true, loras: suggestions } }));
  return { recorded };
}

/** Holds the rewrite until `release`, so the streaming state can be seen. */
async function holdRewrite(page: Page, written = 'A cabin at dusk, warm light.') {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const bodies: any[] = [];
  await page.route('**/api/assistant/rewrite', async (route) => {
    bodies.push(route.request().postDataJSON());
    await held;
    await route.fulfill({ headers: { 'content-type': 'text/event-stream; charset=utf-8' }, body: sse([['delta', { text: 'A cabin' }], ['delta', { text: ' at dusk, warm light.' }], ['done', { prompt: written, preset: bodies.at(-1).preset, model: 'ai/text-quick', source: 'assistant', vision: false }]]) });
  });
  return { release: () => release(), bodies };
}

async function rewriteWith(page: Page, phone: boolean, preset = 'Enhance') {
  const composer = await studioUi(page).openComposer();
  if (phone) {
    await composer.getByRole('combobox', { name: 'Prompt Assistant', exact: true }).click();
    await page.locator('.dropdown-menu').getByRole('option', { name: preset, exact: true }).click();
  } else if (preset === 'Enhance') await composer.getByRole('button', { name: 'Rewrite Prompt · Enhance', exact: true }).click();
  else {
    await composer.getByRole('combobox', { name: 'Rewrite Presets', exact: true }).click();
    await page.locator('.dropdown-menu').getByRole('option', { name: preset, exact: true }).click();
  }
}

test('the preset menu reads Enhance, the other presets alphabetically, then Suggest LoRAs', async ({ page }) => {
  await mockStudio(page);
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const composer = await ui.openComposer();
  await composer.getByRole('combobox', { name: phone ? 'Prompt Assistant' : 'Rewrite Presets', exact: true }).click();
  const menu = page.locator('.dropdown-menu');
  const rows = (await menu.locator('[role="option"], [role="group"] button').allInnerTexts()).map((text) => text.split('\n')[0].trim());
  expect(rows).toEqual(['Enhance', 'Cinematic', 'Photographic', 'Suggest LoRAs']);
});

test('the magic button streams a rewrite in place, with Undo and the old text in History', async ({ page }) => {
  const { recorded } = await mockStudio(page);
  const rewrite = await holdRewrite(page);
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const composer = await ui.openComposer();
  await ui.prompt.fill('a cabin');
  await rewriteWith(page, phone);
  // While it writes, the field is read-only and the button is Stop.
  await expect(composer.getByRole('button', { name: 'Stop Rewriting', exact: true })).toBeVisible();
  await expect(ui.prompt).toHaveAttribute('readonly', '');
  rewrite.release();
  await expect(ui.prompt).toHaveValue('A cabin at dusk, warm light.');
  await expect(ui.prompt).not.toHaveAttribute('readonly', '');
  // The negative follows, and one Undo takes both back.
  await expect(ui.negativePrompt).toHaveValue('blurry, extra fingers');
  expect(rewrite.bodies[0]).toMatchObject({ prompt: 'a cabin', preset: 'enhance', stream: true, references: [] });
  await expect(pill(page, 'Prompt and negative rewritten · Enhance')).toBeVisible();
  await expect.poll(() => recorded).toContainEqual({ text: 'a cabin', kind: 'positive' });
  await pill(page, 'Prompt and negative rewritten').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(ui.prompt).toHaveValue('a cabin');
  await expect(ui.negativePrompt).toHaveValue('');
  // The last preset is remembered: the next tap uses it.
  await rewriteWith(page, phone, 'Cinematic');
  rewrite.release();
  await expect(ui.prompt).toHaveValue('A cabin at dusk, warm light.');
  expect(rewrite.bodies[1].preset).toBe('cinematic');
  if (!phone) await expect(composer.getByRole('button', { name: 'Rewrite Prompt · Cinematic', exact: true })).toBeVisible();
  // The run records what wrote its prompt, for Details.
  const generated = page.waitForRequest((request) => request.url().endsWith('/api/generate') && request.method() === 'POST');
  await ui.generate.click();
  expect((await generated).postDataJSON().assistant).toEqual({ preset: 'cinematic', model: 'ai/text-quick', source: 'ui' });
});

test('a timed-out rewrite keeps the prompt and offers Try Again in the pill', async ({ page }) => {
  await mockStudio(page);
  await page.route('**/api/assistant/rewrite', (route) => route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: sse([['done', { prompt: 'a cabin', preset: 'enhance', source: 'fallback', reason: 'timeout' }]]) }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  await ui.openComposer();
  await ui.prompt.fill('a cabin');
  await rewriteWith(page, phone);
  const failed = pill(page, 'Couldn’t rewrite the prompt. The prompt assistant took too long');
  await expect(failed).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
  await expect(ui.prompt).toHaveValue('a cabin');
});

test('suggested LoRAs add with their trigger words, and taking one off offers Remove Trigger Words', async ({ page }) => {
  await mockStudio(page);
  const rewrite = await holdRewrite(page, 'a cabin at dusk');
  rewrite.release();
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const composer = await ui.openComposer();
  await ui.prompt.fill('a cabin');
  await rewriteWith(page, phone);
  const chips = composer.getByRole('group', { name: 'Suggested LoRAs', exact: true });
  await expect(chips).toBeVisible();
  const glow = chips.getByRole('button', { name: 'Add Glow, strength 0.8, triggers glowfx', exact: true });
  await glow.click();
  // The trigger goes first, and the chip turns amber as it is in the stack.
  await expect(ui.prompt).toHaveValue('glowfx, a cabin at dusk');
  const added = chips.getByRole('button', { name: /^Remove Glow/ });
  await expect(added).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page, 'Added Glow with trigger word')).toBeVisible();
  // Taking it off again offers to take its trigger out of the prompt.
  await added.click();
  await pill(page, 'Removed Glow').getByRole('button', { name: 'Remove Trigger Words', exact: true }).click();
  await expect(ui.prompt).toHaveValue('a cabin at dusk');
  // Add All takes every suggestion with its triggers, and one Undo takes them all back.
  await chips.getByRole('button', { name: 'Add All', exact: true }).click();
  await expect(ui.prompt).toHaveValue('mistyx, glowfx, a cabin at dusk');
  await expect(chips.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  await pill(page, 'Added 2 LoRAs with trigger words').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(ui.prompt).toHaveValue('a cabin at dusk');
  await expect(chips.getByRole('button', { name: /^Add (Glow|Mist),/ })).toHaveCount(2);
  // The LoRAs picker has no Suggested section: This Model lists the model family's LoRAs, and a pick there is plain.
  await composer.getByRole('button', { name: /^LoRAs/ }).first().click();
  const picker = page.getByRole('dialog', { name: 'LoRAs', exact: true });
  await expect(picker.getByText('Suggested', { exact: true })).toHaveCount(0);
  const mist = picker.getByRole('checkbox', { name: 'Select Mist', exact: true });
  await mist.click();
  await expect(mist).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(ui.prompt).toHaveValue('a cabin at dusk');
});

test('the negative writer sits beside Negative and is absent where the model takes none', async ({ page }) => {
  await mockStudio(page);
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await ui.prompt.fill('a cabin');
  await composer.getByRole('button', { name: 'Write Negative Prompt', exact: true }).click();
  await expect(ui.negativePrompt).toHaveValue('blurry, extra fingers');
  await pill(page, 'Negative written').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(ui.negativePrompt).toHaveValue('');
});

test('without the assistant nothing shows', async ({ page }) => {
  await mockStudio(page);
  await page.route('**/api/assistant', (route) => route.fulfill({ json: { ok: true, available: false, presets: [] } }));
  await page.goto('/');
  const composer = await studioUi(page).openComposer();
  await expect(composer.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: /^Rewrite Prompt/ })).toHaveCount(0);
  await expect(composer.getByRole('combobox', { name: 'Prompt Assistant' })).toHaveCount(0);
  await expect(composer.getByRole('button', { name: 'Write Negative Prompt', exact: true })).toHaveCount(0);
});

test('in the phone\'s focused-text row, one tap rewrites with the last preset and keeps the keyboard up', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone Create sheet.');
  await fakeKeyboard(page);
  await mockStudio(page);
  const rewrite = await holdRewrite(page);
  await page.goto('/');
  const sheet = await studioUi(page).openComposer();
  const field = sheet.getByRole('textbox', { name: 'Prompt', exact: true });
  await field.fill('a cabin');
  await field.focus();
  await raiseKeyboard(page, 336);
  const focused = sheet.locator('.composer-prompt-field.is-text-focused');
  await expect(focused).toHaveCount(1);
  await focused.getByRole('button', { name: 'Rewrite Prompt · Enhance', exact: true }).click();
  await expect(focused.getByRole('button', { name: 'Stop Rewriting', exact: true })).toBeVisible();
  await expect(field).toBeFocused();
  rewrite.release();
  await expect(field).toHaveValue('A cabin at dusk, warm light.');
  await expect(focused).toHaveCount(1);
});

test('a focused prompt or negative takes the field\'s full width, the tools sitting above the text', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone Create sheet.');
  await fakeKeyboard(page);
  await mockStudio(page);
  await page.goto('/');
  const sheet = await studioUi(page).openComposer();
  for (const label of ['Prompt', 'Negative Prompt'] as const) {
    if (label === 'Negative Prompt') await sheet.getByRole('button', { name: /Negative/ }).first().click().catch(() => {});
    const field = sheet.getByRole('textbox', { name: label, exact: true });
    await field.fill('gggf '.repeat(60));
    await field.focus();
    await raiseKeyboard(page, 336);
    await expect(sheet.locator('.is-text-focused.has-assistant textarea')).toHaveCount(1);
    const padding = await field.evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));
    expect(padding, label).toBeLessThanOrEqual(16);
    await sheet.getByRole('button', { name: 'Done', exact: true }).click();
    await raiseKeyboard(page, 0);
  }
});
