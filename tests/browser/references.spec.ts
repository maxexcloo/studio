import { expect, test, type Locator, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#699b88"/></svg>');
const image = (id: string) => ({ id, source: 'upload', name: `${id}.png`, url: picture, thumbnailUrl: picture, mime: 'image/png', width: 80, height: 80, size: 10, createdAt: '', privacyDomain: 'gallery' });

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

async function drop(target: Locator, count: number) {
  await target.evaluate((element, count) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < count; index++) transfer.items.add(new File(['image'], `image-${index}.png`, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, count);
}

test('multiple upload selection fills declared slots and removal closes gaps', async ({ page }) => {
  const { ui, uploads } = await prepare(page, 3);
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  const input = page.locator('.reference-popover input[type="file"]');
  await expect(input).toHaveAttribute('multiple', '');
  await input.setInputFiles([1, 2, 3].map((index) => ({ name: `reference-${index}.png`, mimeType: 'image/png', buffer: Buffer.from('image') })));
  await expect(page.locator('.ref-thumb')).toHaveCount(3);
  await expect(page.locator('.reference-count')).toHaveText('3/3 References');
  expect(uploads).toHaveLength(3);
  await expect(page.locator('.reference-popover')).toHaveCount(0);
  const firstRemove = page.getByRole('group', { name: 'Reference Images', exact: true }).getByRole('button', { name: 'Remove reference image', exact: true });
  await firstRemove.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ref-thumb')).toHaveCount(2);
  await expect(page.locator('.ref-thumb').first()).toHaveAttribute('aria-label', /uploaded-2.png/);
  await expect(page.locator('.reference-count')).toHaveText('2/3 References');
  await expect(page.getByRole('button', { name: 'Add Reference 3', exact: true })).toBeVisible();
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
  expect(generated!.referenceAssets).toEqual([{ slot: 'reference', assetId: 'uploaded-2' }, { slot: 'reference_2', assetId: 'uploaded-3' }]);
});

test('multi-file drops add references, respect capacity and allow explicit replacement', async ({ page }) => {
  const { ui, uploads } = await prepare(page, 3);
  await drop(ui.composer, 2);
  await expect(page.locator('.ref-thumb')).toHaveCount(2);
  await drop(ui.composer, 2);
  await expect(page.locator('.reference-count')).toHaveText('3/3 References');
  expect(uploads).toHaveLength(3);
  await drop(ui.composer, 1);
  await expect(page.getByText('All reference slots are filled.', { exact: false })).toBeVisible();
  expect(uploads).toHaveLength(3);
  await drop(page.locator('.ref-thumb[data-reference-slot="reference_2"]'), 1);
  await expect(page.locator('[data-reference-slot="reference_2"]')).toHaveAttribute('aria-label', /uploaded-4.png/);
  await expect(page.locator('.ref-thumb').first()).toHaveAttribute('aria-label', /uploaded-1.png/);
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
  await page.getByRole('button', { name: 'Paint the part to change', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Paint the part to change' });
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.locator('.inpaint-stage img').evaluate((image) => image.getBoundingClientRect().width)).toBeGreaterThan(phone ? 300 : 500);
  const tools = await editor.getByRole('toolbar').boundingBox();
  const close = await editor.getByRole('button', { name: 'Done painting' }).boundingBox();
  const viewport = page.viewportSize()!;
  expect(tools!.y).toBeGreaterThanOrEqual(0);
  expect(close!.y).toBeGreaterThanOrEqual(0);
  expect(close!.y + close!.height).toBeLessThanOrEqual(viewport.height);
  expect(tools!.x).toBeGreaterThanOrEqual(0);
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(viewport.width);
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(viewport.height);
  // The phone puts the tools below Done; the full studio may share a row.
  if (phone) expect(tools!.y).toBeGreaterThan(close!.y + close!.height);
  await editor.getByRole('button', { name: 'Done painting' }).click();
  await expect(editor).toHaveCount(0);
});


test('reference sources name their search and keep one upload action', async ({ page }) => {
  const { phone } = await prepare(page, 2);
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [], nextCursor: '' } }));
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  const picker = page.locator('.reference-popover');
  // Open and type on desktop; the phone sheet takes focus itself so no keyboard pops up.
  if (!phone) await expect(picker.getByRole('searchbox', { name: 'Search Library', exact: true })).toBeFocused();
  await expect(picker.getByRole('button', { name: 'Close References', exact: true })).toBeVisible();
  await picker.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(picker.getByRole('searchbox', { name: 'Search Library', exact: true })).toHaveAttribute('placeholder', 'Search Library');
  await expect(picker.getByText('No Outputs Yet', { exact: true })).toBeVisible();
  await picker.getByRole('tab', { name: 'Uploads', exact: true }).click();
  await expect(picker.getByText('No Uploads Yet', { exact: true })).toBeVisible();
  await expect(picker.getByRole('searchbox', { name: 'Search Uploads', exact: true })).toHaveAttribute('placeholder', 'Search Uploads');
  await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(1);
  await expect(picker.locator('.reference-empty button')).toHaveCount(0);
});


test('reference selection stays open, pins selections across searches and tabs, and frees capacity immediately', async ({ page }) => {
  await prepare(page, 2);
  await page.route('**/api/reference-assets?*', route => route.fulfill({ json: {
    items: new URL(route.request().url()).searchParams.get('q') ? [] : [image('first'), image('second'), image('third')], nextCursor: '',
  } }));
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose reference image', exact: false });
  await picker.getByRole('button', { name: 'second.png', exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('.reference-tile-select').first()).toHaveAttribute('aria-label', 'Selected: second.png');
  await picker.getByRole('button', { name: 'first.png', exact: true }).click();
  await expect(page.locator('.reference-count')).toHaveText('2/2 References');
  await expect(picker.getByRole('button', { name: 'third.png', exact: true })).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Selected: second.png', exact: true })).toBeEnabled();
  const search = picker.getByRole('searchbox');
  await search.fill('no matching images');
  await expect(picker.locator('.reference-tile-select')).toHaveCount(2);
  await picker.getByRole('tab', { name: 'Uploads', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Selected: second.png', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Selected: second.png', exact: true }).click();
  await expect(page.locator('.reference-count')).toHaveText('1/2 References');
  await search.clear();
  await picker.getByRole('button', { name: 'third.png', exact: true }).click();
  await expect(page.locator('.reference-count')).toHaveText('2/2 References');
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.locator('.reference-slot-list button[data-reference-slot]').first()).toBeFocused();
});
