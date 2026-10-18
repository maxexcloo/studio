import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities = { ...profile.capabilities, negativePrompt: true };
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/prompts*', (route) => {
    const negative = new URL(route.request().url()).searchParams.get('kind') === 'negative';
    return route.fulfill({ json: { enabled: true, prompts: [{ text: negative ? 'Avoid blur and extra fingers' : 'A mountain at sunrise', at: new Date().toISOString(), uses: 1 }] } });
  });
});

test('positive and negative histories replace only their respective fields', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const negative = page.getByRole('textbox', { name: 'Negative Prompt', exact: true });
  await prompt.fill('Keep this scene');
  await page.getByRole('button', { name: 'Recent Negative Prompts', exact: true }).click();
  const negativeHistory = page.getByRole('dialog', { name: 'Recent Negative Prompts', exact: true });
  await expect(negativeHistory).toBeVisible();
  await negativeHistory.getByRole(isMobile ? 'button' : 'option', { name: /Avoid blur and extra fingers/ }).first().click();
  await expect(negative).toHaveValue('Avoid blur and extra fingers');
  await expect(prompt).toHaveValue('Keep this scene');
  await prompt.focus();
  await page.getByRole('button', { name: 'Recent Prompts', exact: true }).click();
  await page.getByRole('dialog', { name: 'Recent Prompts', exact: true }).getByRole(isMobile ? 'button' : 'option', { name: /A mountain at sunrise/ }).first().click();
  await expect(prompt).toHaveValue('A mountain at sunrise');
  await expect(negative).toHaveValue('Avoid blur and extra fingers');
});

test('both prompt fields grow, stop at a viewport cap and scroll through long content', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.locator('.phone-create-open').click();
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.focus();
  const fields = [prompt, page.getByRole('textbox', { name: 'Negative Prompt', exact: true })];
  for (const field of fields) {
    await field.fill('Short');
    const small = await field.evaluate((element) => element.clientHeight);
    await field.fill('A longer line of prompt detail\n'.repeat(6));
    await expect.poll(() => field.evaluate((element) => element.clientHeight)).toBeGreaterThan(small);
    await field.fill('A longer line of prompt detail\n'.repeat(60));
    const geometry = await field.evaluate((element) => {
      const field = element as HTMLTextAreaElement;
      field.scrollTop = field.scrollHeight;
      const parent = field.closest('.negative-drawer, .phone-negative, .composer-prompt-field')!;
      return { height: field.clientHeight, scroll: field.scrollHeight, top: field.scrollTop, bottom: field.getBoundingClientRect().bottom, parentBottom: parent.getBoundingClientRect().bottom, viewport: innerHeight };
    });
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewport * 0.28 + 1);
    expect(geometry.scroll).toBeGreaterThan(geometry.height);
    expect(geometry.top).toBeGreaterThan(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.parentBottom + 1);
  }
});
