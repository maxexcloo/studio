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
      // LoRAs gives up its end to its Clear once something is picked (another test's stack can be on the server).
      expect(box.width).toBeGreaterThan(width - (String(name) === String(/^LoRAs$/) ? 84 : 40));
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

test('the prompt actions are one alike row at the top right, centred on the first line, and the footer reads on one centre line', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The phone Create sheet.');
  await page.goto('/');
  const ui = studioUi(page);
  const sheet = await ui.openComposer();
  await ui.prompt.fill('A harbour at dawn');
  const field = sheet.locator('.composer-prompt-field.is-fill');
  const actions = field.locator('.composer-field-tools .prompt-action');
  // Measured once the sheet has stopped moving: the row and the text are read in separate calls.
  let lastY = -1;
  await expect.poll(async () => { const y = (await field.boundingBox())!.y; const still = Math.abs(y - lastY) < 0.1; lastY = y; return still; }, { intervals: [150] }).toBe(true);
  const boxes = await actions.evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).offsetParent).map((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const icon = node.querySelector('svg')!.getBoundingClientRect();
    return { x: box.x, right: box.right, centre: box.y + box.height / 2, colour: style.color, icon: `${icon.width}x${icon.height}` };
  }));
  expect(boxes).toHaveLength(3);
  for (const box of boxes) {
    expect(Math.abs(box.centre - boxes[0].centre)).toBeLessThanOrEqual(0.5);
    expect(box.colour).toBe(boxes[0].colour);
    expect(box.icon).toBe(boxes[0].icon);
  }
  for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].right - 0.5);
  // The row sits at the field's top right, its centre on the first line of text.
  const textarea = sheet.getByRole('textbox', { name: 'Prompt', exact: true });
  const firstLine = await textarea.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return box.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
  });
  expect(Math.abs(boxes[0].centre - firstLine)).toBeLessThanOrEqual(1.5);
  const fieldBox = (await field.boundingBox())!;
  expect(fieldBox.x + fieldBox.width - boxes[2].right).toBeLessThanOrEqual(8);
  // The footer's Image/Video, Clear All and Generate share one centre line and height.
  const footer = [sheet.locator('.create-footer .composer-mode-select button').first(), sheet.getByRole('button', { name: 'Clear All', exact: true }), ui.generate];
  const centres = [];
  for (const control of footer) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    centres.push(box.y + box.height / 2);
  }
  for (const centre of centres) expect(Math.abs(centre - centres[0])).toBeLessThanOrEqual(1);
  // Steps comes before the image count, as in the desktop composer.
  const steps = await sheet.getByRole('button', { name: 'Decrease Steps', exact: true }).boundingBox();
  const images = await sheet.getByRole('button', { name: 'Decrease Images', exact: true }).boundingBox();
  if (steps && images) expect(steps.x + steps.y * 1000).toBeLessThan(images.x + images.y * 1000);
});
