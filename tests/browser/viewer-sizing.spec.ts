import { expect, test } from '@playwright/test';

for (const [width, height] of [[160, 100], [2400, 3600], [3600, 2400]]) test(`viewer opens ${width}×${height} at 1:1 and fits without warping`, async ({ page, isMobile }) => {
  const image = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#527b8f"/></svg>`);
  const item = { id: 'native-viewer', type: 'image', status: 'done', url: image, width, height, prompt: 'Native viewer sizing', createdAt: '2026-01-01T00:00:00Z' };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  await page.locator('[data-tile-id] .tile').first().click();
  const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
  const canvas = viewer.locator('.viewer-canvas');
  const media = canvas.locator('img.generation-result');
  const drawn = () => media.evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
  });
  await expect.poll(async () => Math.abs((await drawn()).width - width)).toBeLessThan(2);
  const zoom = viewer.getByRole('group', { name: 'Image Zoom', exact: true });
  await expect(zoom.getByRole('button', { name: 'Zoom In', exact: true })).toBeVisible();
  await expect(zoom.getByRole('button', { name: 'Zoom Out', exact: true })).toBeVisible();
  await zoom.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expect.poll(async () => (await drawn()).width).toBeGreaterThan(width);
  await zoom.getByRole('button', { name: '1:1', exact: true }).click();
  await expect.poll(async () => Math.abs((await drawn()).width - width)).toBeLessThan(2);
  await zoom.getByRole('button', { name: 'Fit Whole Image', exact: true }).click();
  const bounds = await canvas.boundingBox();
  await expect.poll(async () => {
    const size = await drawn();
    return size.width <= bounds!.width + 1 && size.height <= bounds!.height + 1;
  }).toBe(true);
  const size = await drawn();
  expect(size.width / size.height).toBeCloseTo(width / height, 5);
  if (!isMobile) {
    await page.keyboard.press('0');
    await expect.poll(async () => Math.abs((await drawn()).width - width)).toBeLessThan(2);
  }
});
