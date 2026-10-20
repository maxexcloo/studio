import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

for (const [width, height] of [[160, 100], [2400, 3600], [3600, 2400]]) test(`viewer opens ${width}×${height} at 1:1 on desktop, fitted on a phone, and fits without warping`, async ({ page }) => {
  const image = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#527b8f"/></svg>`);
  const item = { id: 'native-viewer', type: 'image', status: 'done', url: image, width, height, prompt: 'Native viewer sizing', createdAt: '2026-01-01T00:00:00Z' };
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  const viewer = await ui.openViewer(page.locator('[data-tile-id] .tile').first());
  const canvas = viewer.locator('.viewer-canvas');
  const media = canvas.locator('img.generation-result');
  const drawn = () => media.evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
  });
  const bounds = await canvas.boundingBox();
  const fitted = async () => {
    const size = await drawn();
    return size.width <= bounds!.width + 1 && size.height <= bounds!.height + 1;
  };
  // The phone opens the whole image fitted to the screen; the full studio opens it at 1:1.
  if (phone) await expect.poll(fitted).toBe(true);
  else await expect.poll(async () => Math.abs((await drawn()).width - width)).toBeLessThan(2);
  const opened = await drawn();
  const fittedPercent = await viewer.getByRole('button', { name: 'Image Zoom Percentage', exact: true }).textContent();
  await page.screenshot({ path: `/tmp/studio-shots-viewer/opens-${test.info().project.name}-${width}x${height}.png` });
  const zoom = viewer.getByRole('group', { name: 'Image Zoom', exact: true });
  await expect(zoom.getByRole('button', { name: 'Zoom In', exact: true })).toBeVisible();
  await expect(zoom.getByRole('button', { name: 'Zoom Out', exact: true })).toBeVisible();
  await zoom.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expect.poll(async () => (await drawn()).width).toBeGreaterThan(opened.width + 1);
  // The percentage steps through Fit, 1:1 and Full Size, the same on both.
  const percent = zoom.getByRole('button', { name: 'Image Zoom Percentage', exact: true });
  const native = async () => Math.abs((await drawn()).width - width) < 2;
  const reach = async (state: () => Promise<boolean>, button: string) => {
    for (let step = 0; step < 3 && !await state(); step += 1) {
      const before = await percent.textContent();
      await percent.click();
      await expect(percent).not.toHaveText(before!);
    }
    await expect.poll(state).toBe(true);
  };
  await reach(native, '1:1');
  if (!phone) {
    // Full Size fills the viewer: the picture covers the canvas both ways, edges cropped.
    await percent.click();
    await expect.poll(async () => {
      const size = await drawn();
      return size.width >= bounds!.width - 1 && size.height >= bounds!.height - 1 && Math.min(size.width - bounds!.width, size.height - bounds!.height) < 2;
    }).toBe(true);
  }
  // Fit is where a phone opened; the desktop opened at 1:1, so Fit is whatever fits.
  const openedPercent = phone ? fittedPercent : '';
  await reach(phone ? async () => (await percent.textContent()) === openedPercent : fitted, 'Fit');
  const size = await drawn();
  if (phone) expect(Math.abs(opened.width - size.width)).toBeLessThan(2);
  expect(size.width / size.height).toBeCloseTo(width / height, 5);
  // The full studio's 0 shortcut returns to 1:1.
  if (!phone) {
    await page.keyboard.press('0');
    await expect.poll(async () => Math.abs((await drawn()).width - width)).toBeLessThan(2);
  }
});
