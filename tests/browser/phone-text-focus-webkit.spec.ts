import { test } from '@playwright/test';
import { fakeKeyboard, focusedOnly } from './helpers/text-focus';

// The same in WebKit, the engine iOS uses, at an iPhone's 390 × 844; once, from the phone project.
// Skipped before launch in the desktop project, so WebKit only starts once.
test.skip(({}, info) => info.project.name !== 'phone', 'Runs once, from the phone project.');
test.use({ browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('WebKit: a focused Prompt shows only itself above the keyboard, and Done puts it back', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('/');
  await focusedOnly(page, 'Prompt');
});
