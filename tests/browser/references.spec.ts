import { expect, test, type Page } from '@playwright/test';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#699b88"/></svg>');
const image = (id: string) => ({ id, source: 'upload', name: `${id}.png`, url: picture, thumbnailUrl: picture, mime: 'image/png', width: 80, height: 80, size: 10, createdAt: '', privacyDomain: 'gallery' });

async function prepare(page: Page, phone: boolean, capacity: number) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) if (profile.kind === 'image') {
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
  if (phone) await page.locator('.phone-create-open').click();
  return uploads;
}

async function drop(page: Page, count: number, selector = '.composer-prompt-row') {
  await page.locator(selector).evaluate((element, count) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < count; index++) transfer.items.add(new File(['image'], `image-${index}.png`, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, count);
}

test('multiple upload selection fills declared slots and removal closes gaps', async ({ page, isMobile }) => {
  const uploads = await prepare(page, isMobile, 3);
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
  const layout = await page.locator('.composer-prompt-row').evaluate((element) => {
    const prompt = element.querySelector('textarea')!.getBoundingClientRect();
    const references = element.querySelector('.composer-reference-tools')!.getBoundingClientRect();
    return { promptRight: prompt.right, referenceLeft: references.left, right: references.right, viewport: innerWidth, width: element.clientWidth, scroll: element.scrollWidth };
  });
  expect(layout.referenceLeft).toBeGreaterThanOrEqual(layout.promptRight);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
  let generated: Record<string, any> | null = null;
  await page.route('**/api/generate', async (route) => { generated = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A scene with both references');
  const generate = isMobile ? page.locator('.phone-create').getByRole('button', { name: 'Generate 4', exact: true }) : page.getByRole('button', { name: 'Generate', exact: true });
  await generate.click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated!.referenceAssets).toEqual([{ slot: 'reference', assetId: 'uploaded-2' }, { slot: 'reference_2', assetId: 'uploaded-3' }]);
});

test('multi-file drops add references, respect capacity and allow explicit replacement', async ({ page, isMobile }) => {
  const uploads = await prepare(page, isMobile, 3);
  await drop(page, 2);
  await expect(page.locator('.ref-thumb')).toHaveCount(2);
  await drop(page, 2);
  await expect(page.locator('.reference-count')).toHaveText('3/3 References');
  expect(uploads).toHaveLength(3);
  await drop(page, 1);
  await expect(page.getByText('All reference slots are filled.', { exact: false })).toBeVisible();
  expect(uploads).toHaveLength(3);
  await drop(page, 1, '.ref-thumb[data-reference-slot="reference_2"]');
  await expect(page.locator('[data-reference-slot="reference_2"]')).toHaveAttribute('aria-label', /uploaded-4.png/);
  await expect(page.locator('.ref-thumb').first()).toHaveAttribute('aria-label', /uploaded-1.png/);
});

test('single-reference models keep one slot and show the full image if the thumbnail expires', async ({ page, isMobile }) => {
  const uploads = await prepare(page, isMobile, 1);
  await page.route('**/expired-thumbnail.png', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [{ ...image('fallback-reference'), thumbnailUrl: '/expired-thumbnail.png' }], nextCursor: '' } }));
  await page.getByRole('button', { name: 'Add Reference Image', exact: true }).click();
  await expect(page.locator('.reference-popover input[type="file"]')).not.toHaveAttribute('multiple');
  await page.getByRole('button', { name: 'fallback-reference.png', exact: true }).click();
  await expect(page.locator('.ref-thumb img')).toHaveAttribute('src', picture);
  await expect.poll(() => page.locator('.ref-thumb img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await drop(page, 2);
  expect(uploads).toHaveLength(0);
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  await page.getByRole('group', { name: 'Reference Images', exact: true }).getByRole('button', { name: 'Remove reference image', exact: true }).click();
  await drop(page, 2);
  await expect(page.locator('.ref-thumb')).toHaveCount(1);
  expect(uploads).toHaveLength(1);
});

test('late uploads do not attach after leaving the composer context', async ({ page, isMobile }) => {
  await prepare(page, isMobile, 3);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let uploads = 0;
  await page.route('**/api/reference-assets/upload', async (route) => {
    uploads++;
    await pending;
    await route.fulfill({ json: { asset: image('late-reference') } });
  });
  await drop(page, 2);
  await expect.poll(() => uploads).toBe(1);
  if (isMobile) {
    await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.phone-create')).toHaveCount(0);
    await page.locator('.phone-create-open').click();
  } else {
    await page.locator('.gallery-generation-mode').getByRole('button', { name: 'Video', exact: true }).click();
    await page.locator('.gallery-generation-mode').getByRole('button', { name: 'Image', exact: true }).click();
  }
  const completed = page.waitForResponse('**/api/reference-assets/upload');
  finish();
  await completed;
  await expect(page.locator('.ref-chip.is-busy')).toHaveCount(0);
  await expect(page.locator('.ref-thumb')).toHaveCount(0);
  expect(uploads).toBe(1);
});
