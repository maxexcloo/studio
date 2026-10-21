import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { studioUi, pickerSearch } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#699b88"/></svg>');
const image = (id: string) => ({ id, source: 'upload', name: `${id}.png`, url: picture, thumbnailUrl: picture, mime: 'image/png', width: 80, height: 80, size: 10, createdAt: '' });

async function prepare(page: Page, capacity: number, inpaint = false) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
    if (inpaint) profile.capabilities = { ...profile.capabilities, inpaint: true };
    profile.mediaInputs = Array.from({ length: capacity }, (_, index) => ({ id: index ? `reference_${index + 1}` : 'reference', kind: 'image', role: 'reference', label: index ? `Reference ${index + 1}` : 'Reference Image', min: 0, max: 1, required: false, ...(index ? { follows: index > 1 ? `reference_${index}` : 'reference' } : {}) }));
  }
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  const uploads: string[] = [];
  await page.route('**/api/reference-assets/upload', (route) => {
    const id = `uploaded-${uploads.length + 1}`;
    uploads.push(id);
    return route.fulfill({ json: { asset: image(id) } });
  });
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [image('library-image')], nextCursor: '' } }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  return { phone: await ui.isPhone(), ui, uploads };
}

/** A model with several slots shows one References button, named with how many are picked. */
const references = (page: Page) => page.locator('.ref-group');
const expectPicked = (page: Page, count: number, max: number) => expect(references(page)).toHaveAttribute('aria-label', count ? `References, ${count} of ${max} Selected` : 'Add References');

async function drop(target: Locator, count: number) {
  await target.evaluate((element, count) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < count; index++) transfer.items.add(new File(['image'], `image-${index}.png`, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, count);
}

test('several slots share one References button whose chooser fills, reviews and empties them', async ({ page }) => {
  const { ui, uploads } = await prepare(page, 3);
  await expect(page.locator('[data-reference-slot]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose References', exact: true });
  const input = picker.locator('input[type="file"]');
  await expect(input).toHaveAttribute('multiple', '');
  await input.setInputFiles([1, 2, 3].map((index) => ({ name: `reference-${index}.png`, mimeType: 'image/png', buffer: Buffer.from('image') })));
  await expectPicked(page, 3, 3);
  expect(uploads).toHaveLength(3);
  // Picking several stays open for the rest; Selected reviews them in order.
  await picker.getByRole('tab', { name: 'Selected 3 of 3', exact: true }).click();
  const rows = picker.getByRole('list', { name: 'Selected References' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await picker.getByRole('button', { name: 'Remove uploaded-1', exact: true }).click();
  await expectPicked(page, 2, 3);
  await expect(rows.first()).toContainText('uploaded-2');
  await picker.getByRole('button', { name: 'Move uploaded-2 Later', exact: true }).click();
  await expect(rows.first()).toContainText('uploaded-3');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  const layout = await ui.composer.evaluate((element) => {
    const prompt = element.querySelector('textarea')!.getBoundingClientRect();
    const references = element.querySelector('.composer-reference-tools')!.getBoundingClientRect();
    return { promptBottom: prompt.bottom, promptRight: prompt.right, referenceLeft: references.left, referenceTop: references.top, right: references.right, viewport: innerWidth, width: element.clientWidth, scroll: element.scrollWidth };
  });
  expect(layout.referenceLeft >= layout.promptRight || layout.referenceTop >= layout.promptBottom).toBe(true);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
  let generated: Record<string, any> | null = null;
  await page.route('**/api/generate', async (route) => { generated = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
  await ui.prompt.fill('A scene with both references');
  await ui.generate.click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated!.referenceAssets).toEqual([{ slot: 'reference', assetId: 'uploaded-3' }, { slot: 'reference_2', assetId: 'uploaded-2' }]);
});

test('multi-file drops add references and respect capacity', async ({ page }) => {
  const { ui, uploads } = await prepare(page, 3);
  await drop(ui.composer, 2);
  await expectPicked(page, 2, 3);
  await drop(ui.composer, 2);
  await expectPicked(page, 3, 3);
  expect(uploads).toHaveLength(3);
  await drop(ui.composer, 1);
  await expect(page.locator('.status-message').filter({ hasText: 'Reference slots are full' })).toBeVisible();
  expect(uploads).toHaveLength(3);
  // Dropped on the button, a picture is added like anywhere else on the prompt.
  await drop(references(page), 1);
  expect(uploads).toHaveLength(3);
});

test('single-reference models keep one slot and show the full image if the thumbnail expires', async ({ page }) => {
  const { ui, uploads } = await prepare(page, 1);
  await page.route('**/expired-thumbnail.png', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [{ ...image('fallback-reference'), thumbnailUrl: '/expired-thumbnail.png' }], nextCursor: '' } }));
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  await expect(page.locator('.reference-popover input[type="file"]')).not.toHaveAttribute('multiple');
  await page.getByRole('button', { name: 'fallback-reference.png', exact: true }).click();
  await expect(page.locator('.reference-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ref-thumb img')).toHaveAttribute('src', picture);
  await expect.poll(() => page.locator('.ref-thumb img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await drop(ui.composer, 2);
  expect(uploads).toHaveLength(0);
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  await page.getByRole('group', { name: 'Reference Images', exact: true }).getByRole('button', { name: 'Remove reference image', exact: true }).click();
  await drop(ui.composer, 2);
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  expect(uploads).toHaveLength(1);
});

test('late uploads do not attach after leaving the composer context', async ({ page }) => {
  const { ui } = await prepare(page, 3);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let uploads = 0;
  await page.route('**/api/reference-assets/upload', async (route) => {
    uploads++;
    await pending;
    await route.fulfill({ json: { asset: image('late-reference') } });
  });
  await drop(ui.composer, 2);
  await expect.poll(() => uploads).toBe(1);
  await ui.closeComposer();
  await ui.switchMode('video');
  await ui.switchMode('image');
  await ui.openComposer();
  const completed = page.waitForResponse('**/api/reference-assets/upload');
  finish();
  await completed;
  await expect(page.locator('.ref-chip.is-busy')).toHaveCount(0);
  await expect(page.locator('.ref-thumb')).toHaveCount(0);
  expect(uploads).toBe(1);
});


test('the image editor fills a usable workspace with reachable mobile tools', async ({ page }) => {
  const { phone } = await prepare(page, 1, true);
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  await page.getByRole('button', { name: 'library-image.png', exact: true }).click();
  await expect(page.locator('.reference-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Paint the Part to Change', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Paint the Part to Change' });
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.locator('.inpaint-stage img').evaluate((image) => image.getBoundingClientRect().width)).toBeGreaterThan(phone ? 300 : 500);
  const tools = await editor.getByRole('toolbar').boundingBox();
  const close = await editor.getByRole('button', { name: 'Done Painting' }).boundingBox();
  const viewport = page.viewportSize()!;
  expect(tools!.y).toBeGreaterThanOrEqual(0);
  expect(close!.y).toBeGreaterThanOrEqual(0);
  expect(close!.y + close!.height).toBeLessThanOrEqual(viewport.height);
  expect(tools!.x).toBeGreaterThanOrEqual(0);
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(viewport.width);
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(viewport.height);
  // The phone puts the tools below Done; the full studio may share a row.
  if (phone) expect(tools!.y).toBeGreaterThan(close!.y + close!.height);
  await editor.getByRole('button', { name: 'Done Painting' }).click();
  await expect(editor).toHaveCount(0);
});


test('reference sources name their search and keep one upload action', async ({ page }) => {
  const { phone } = await prepare(page, 2);
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.locator('.reference-popover');
  await expect(picker.getByRole('button', { name: 'Close References', exact: true })).toBeVisible();
  await picker.getByRole('tab', { name: 'Library', exact: true }).click();
  // Typing in the picker opens its compact search with that text, on both layouts.
  if (!phone) {
    await page.keyboard.type('n');
    await expect(picker.getByRole('searchbox', { name: 'Search Library', exact: true })).toBeFocused();
    await expect(picker.getByRole('searchbox', { name: 'Search Library', exact: true })).toHaveValue('n');
    await picker.getByRole('button', { name: 'Close Search', exact: true }).click();
  }
  await expect(await pickerSearch(picker, 'Search Library', 'searchbox')).toHaveAttribute('placeholder', 'Search Library');
  await expect(picker.getByText('No Outputs Yet', { exact: true })).toBeVisible();
  await picker.getByRole('tab', { name: 'Uploads', exact: true }).click();
  await expect(picker.getByText('No Uploads Yet', { exact: true })).toBeVisible();
  await expect(await pickerSearch(picker, 'Search Uploads', 'searchbox')).toHaveAttribute('placeholder', 'Search Uploads');
  await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(1);
  await expect(picker.locator('.empty-state button')).toHaveCount(0);
});


test('reference selection stays open, keeps picks in place across searches and tabs, and frees capacity immediately', async ({ page }) => {
  await prepare(page, 2);
  await page.route('**/api/reference-assets?*', route => route.fulfill({ json: {
    items: new URL(route.request().url()).searchParams.get('q') ? [] : [image('first'), image('second'), image('third')], nextCursor: '',
  } }));
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose References', exact: true });
  await picker.getByRole('button', { name: 'second.png', exact: true }).click();
  await expect(picker).toBeVisible();
  // A pick keeps its place in the list; only its state changes.
  await expect(picker.locator('.reference-tile-select').nth(1)).toHaveAttribute('aria-label', 'Selected: second.png');
  await expect(picker.locator('.reference-tile-select').first()).toHaveAttribute('aria-label', 'first.png');
  await picker.getByRole('button', { name: 'first.png', exact: true }).click();
  await expectPicked(page, 2, 2);
  await expect(picker.getByRole('button', { name: 'third.png', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(picker.getByRole('button', { name: 'Selected: second.png', exact: true })).toBeEnabled();
  const search = await pickerSearch(picker, 'Search Library', 'searchbox');
  await search.fill('no matching images');
  await expect(picker.locator('.reference-tile-select')).toHaveCount(2);
  await picker.getByRole('tab', { name: 'Uploads', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Selected: second.png', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Selected: second.png', exact: true }).click();
  await expectPicked(page, 1, 2);
  // The query follows the tab; its field takes the tab's name.
  await picker.getByRole('searchbox', { name: 'Search Uploads', exact: true }).clear();
  await picker.getByRole('button', { name: 'third.png', exact: true }).click();
  await expectPicked(page, 2, 2);
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(references(page)).toBeFocused();
});

test('a real ten-slot profile shows one References button, however its slots are declared', async ({ page }) => {
  // FLUX.3 [klein] Base as synced from the deployment: ten "Reference Image" slots, with no `follows` or `role`.
  const real = JSON.parse(readFileSync(new URL('../../server/fixtures/profiles/flux3-klein-base-10-references.json', import.meta.url), 'utf8'));
  const slots = real.heissUi.mediaInputs.map(({ control, ...input }: { control: unknown }) => input);
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') profile.mediaInputs = slots;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [image('library-image')], nextCursor: '' } }));
  await page.goto('/');
  await studioUi(page).openComposer();
  await expect(page.locator('[data-reference-slot]')).toHaveCount(0);
  await expect(references(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose References', exact: true });
  await expect(picker.getByRole('tab', { name: 'Selected 0 of 10', exact: true })).toBeVisible();
});

test('Clear Selection beside the chooser tabs empties every reference and Undo brings them back', async ({ page }) => {
  await prepare(page, 3);
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose References', exact: true });
  await expect(picker.getByRole('button', { name: 'Clear Selection', exact: true })).toHaveCount(0);
  await picker.locator('input[type="file"]').setInputFiles([1, 2].map((index) => ({ name: `reference-${index}.png`, mimeType: 'image/png', buffer: Buffer.from('image') })));
  await expectPicked(page, 2, 3);
  await picker.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await expectPicked(page, 0, 3);
  await page.locator('.status-message').getByRole('button', { name: 'Undo', exact: true }).click();
  await expectPicked(page, 2, 3);
});

test('picked references reorder by dragging in the Selected tab', async ({ page }) => {
  await prepare(page, 3);
  await page.route('**/api/reference-assets?*', route => route.fulfill({ json: { items: [image('first'), image('second'), image('third')], nextCursor: '' } }));
  await page.getByRole('button', { name: 'Add References', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose References', exact: true });
  for (const name of ['first.png', 'second.png', 'third.png']) await picker.getByRole('button', { name, exact: true }).click();
  await picker.getByRole('tab', { name: 'Selected 3 of 3', exact: true }).click();
  const names = () => picker.locator('.reference-selected-name').allTextContents();
  await expect.poll(names).toEqual(['first', 'second', 'third']);
  // Drag the last one's grip onto the first row: it moves there and the others shift down.
  const grip = picker.getByRole('button', { name: 'Drag third to Reorder', exact: true });
  const target = picker.locator('.reference-selected-row').first();
  const [from, to] = [(await grip.boundingBox())!, (await target.boundingBox())!];
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(names).toEqual(['third', 'first', 'second']);
  // The keyboard moves it too: ArrowDown on its grip.
  await picker.getByRole('button', { name: 'Drag third to Reorder', exact: true }).press('ArrowDown');
  await expect.poll(names).toEqual(['first', 'third', 'second']);
});
