import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities = { ...profile.capabilities, negativePrompt: true };
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/prompts*', (route) => {
    const negative = new URL(route.request().url()).searchParams.get('kind') === 'negative';
    return route.fulfill({ json: { enabled: true, prompts: [{ text: negative ? 'Avoid blur and extra fingers' : 'A mountain at sunrise', at: new Date().toISOString(), uses: 1 }] } });
  });
});

test('positive and negative histories replace only their respective fields', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  const { prompt, negativePrompt: negative } = ui;
  await prompt.fill('Keep this scene');
  await page.getByRole('button', { name: 'Recent Negative Prompts', exact: true }).click();
  const negativeHistory = page.getByRole('dialog', { name: 'Recent Negative Prompts', exact: true });
  await expect(negativeHistory).toBeVisible();
  // The phone history sheet lists buttons; the full studio's popover is a listbox.
  await negativeHistory.getByRole('option', { name: /Avoid blur and extra fingers/ }).or(negativeHistory.getByRole('button', { name: /Avoid blur and extra fingers/ })).first().click();
  await expect(negative).toHaveValue('Avoid blur and extra fingers');
  await expect(prompt).toHaveValue('Keep this scene');
  await prompt.focus();
  await page.getByRole('button', { name: 'Recent Prompts', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Recent Prompts', exact: true });
  await history.getByRole('option', { name: /A mountain at sunrise/ }).or(history.getByRole('button', { name: /A mountain at sunrise/ })).first().click();
  await expect(prompt).toHaveValue('A mountain at sunrise');
  await expect(negative).toHaveValue('Avoid blur and extra fingers');
});

test('both prompt fields grow, stop at a viewport cap and scroll through long content', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  const fields = [ui.prompt, ui.negativePrompt];
  const phone = await ui.isPhone();
  for (const field of fields) {
    // The phone's prompt fills the Create sheet from the start, so it scrolls rather than grows.
    const fills = phone && field === ui.prompt;
    await field.fill('Short');
    const small = await field.evaluate((element) => element.clientHeight);
    await field.fill('A longer line of prompt detail\n'.repeat(6));
    if (!fills) await expect.poll(() => field.evaluate((element) => element.clientHeight)).toBeGreaterThan(small);
    await field.fill('A longer line of prompt detail\n'.repeat(60));
    const geometry = await field.evaluate((element) => {
      const field = element as HTMLTextAreaElement;
      field.scrollTop = field.scrollHeight;
      const parent = field.closest('.negative-drawer, .phone-negative, .composer-prompt-field')!;
      return { height: field.clientHeight, scroll: field.scrollHeight, top: field.scrollTop, bottom: field.getBoundingClientRect().bottom, parentBottom: parent.getBoundingClientRect().bottom, viewport: innerHeight };
    });
    if (!fills) expect(geometry.height).toBeLessThanOrEqual(geometry.viewport * 0.28 + 1);
    expect(geometry.scroll).toBeGreaterThan(geometry.height);
    expect(geometry.top).toBeGreaterThan(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.parentBottom + 1);
  }
});
