import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

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
