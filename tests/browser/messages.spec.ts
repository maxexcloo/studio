import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const images = Array.from({ length: 6 }, (_, index) => ({ id: `image-${index}`, url: `${picture}#${index}`, filename: `image-${index}.png`, type: 'image', status: 'done', prompt: `Image ${index}`, width: 512, height: 512 }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === 'video' ? [] : images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
});

// One message pattern (UI-PATTERNS › Messages): one pill at a time, questions inline in it, Undo inside it.
test('several messages in a row show one pill, a question lists what it removes, and Undo follows in the same pill', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const tile = (id: number) => page.locator(`[data-tile-id="image-${id}"] .tile`);
  const pills = page.locator('[data-status-message]').filter({ visible: true });
  await expect(tile(0)).toBeVisible();
  await ui.enterSelection();
  await tile(0).click();
  await tile(1).click();
  await ui.selectionBar.getByRole('button', { name: 'Delete Selected', exact: true }).click();

  // The question asks in the pill, never in a dialog, with the list of what goes under it.
  const question = page.getByRole('alertdialog', { name: 'Delete 2 Items?' });
  await expect(question).toBeVisible();
  await expect(question).toHaveAttribute('data-status-message', '');
  await expect(page.locator('.modal-scrim')).toHaveCount(0);
  await expect(question.getByRole('list', { name: 'Items' }).getByRole('listitem')).toHaveCount(2);
  await expect(question.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(pills).toHaveCount(1);
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(tile(0)).toBeVisible();

  // Escape answers no, too.
  await ui.selectionBar.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  await expect(question).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(tile(0)).toBeVisible();

  await ui.selectionBar.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  await question.getByRole('button', { name: 'Delete 2', exact: true }).click();
  await expect(tile(0)).toHaveCount(0);
  const undo = pills.filter({ hasText: '2 items deleted' });
  await expect(undo).toBeVisible();
  await expect(pills).toHaveCount(1);
  await undo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tile(0)).toBeVisible();
  await expect(tile(1)).toBeVisible();
  await expect(pills).toHaveCount(0);
});
