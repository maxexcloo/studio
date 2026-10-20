import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('the phone Create sheet is one flat column that fits every phone width', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone Create sheet.');
  await page.goto('/');
  const ui = studioUi(page);
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    const sheet = await ui.openComposer();
    await ui.prompt.fill('A long prompt line that wraps several times on a narrow phone. '.repeat(8));
    // Nothing reaches past the right edge.
    await expect.poll(() => sheet.evaluate((root) => Array.from(root.querySelectorAll('*')).filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.right > innerWidth + 0.5 && !node.closest('[aria-hidden="true"]');
    }).map((node) => node.className).slice(0, 3))).toEqual([]);
    // Count and Generate stay in view in the sticky footer.
    await expect(ui.generate).toBeInViewport({ ratio: 1 });
    await expect(sheet.getByRole('button', { name: 'Decrease Images', exact: true })).toBeInViewport({ ratio: 1 });
    // One row per choice, each one line high and as wide as the sheet.
    for (const name of [/^Choose Model$/, /^LoRAs$/, /^Size:/, /^Advanced Settings$/]) {
      const row = sheet.getByRole('button', { name });
      await row.scrollIntoViewIfNeeded();
      const box = (await row.boundingBox())!;
      expect(box.height).toBeLessThan(52);
      expect(box.width).toBeGreaterThan(width - 40);
    }
    // The prompt takes the room that's left: no gap under the fields on a tall phone.
    if (height >= 800) {
      const gap = await sheet.evaluate((root) => {
        const prompts = root.querySelector('.create-prompts')!.getBoundingClientRect();
        const last = root.querySelector('.create-prompts > :last-child')!.getBoundingClientRect();
        return prompts.bottom - last.bottom;
      });
      expect(gap).toBeLessThan(2);
      expect((await ui.prompt.boundingBox())!.height).toBeGreaterThan(200);
    }
    await ui.closeComposer();
  }
});
