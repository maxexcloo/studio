import { expect, test } from '@playwright/test';

test('optional LoRAs show unverified variants and expose full published strength bounds', async ({ page, isMobile }) => {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  Object.assign(base, { family: 'boogu', baseModel: 'boogu_edit.safetensors', recipe: { modelLabel: 'Boogu Edit Test', conditioning: 'Generate', label: 'Standard', adapters: [] }, options: { ...base.options, loras: ['slider.safetensors', 'excluded.safetensors', 'unknown.safetensors'] } });
  models.loras = base.options.loras;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/loras/info', (route) => route.fulfill({ json: { loras: {
    'slider.safetensors': { title: 'Published Slider', families: ['boogu'], base: 'Boogu', triggers: [], compatibility: { baseModels: ['boogu_base.safetensors'] }, strengthRange: { min: -3, max: 10, step: 0.05 } },
    'excluded.safetensors': { title: 'Excluded Conditioning', families: ['boogu'], base: 'Boogu', triggers: [], compatibility: { conditionings: ['Reference'], unlisted: 'other' } },
    'unknown.safetensors': { title: 'Unknown Effect', families: [], base: '', triggers: [] },
  } } }));
  await page.goto('/');
  if (isMobile) {
    await page.locator('.phone-create-open').click();
    const openLoras = page.locator('.phone-create').getByRole('button', { name: /^LoRAs/ });
    if (await openLoras.count()) await openLoras.click();
  } else {
    await page.locator('.zen-prompt').getByRole('textbox', { name: 'Prompt', exact: true }).focus();
    const openLoras = page.locator('.composer-options').getByRole('button', { name: 'LoRAs', exact: true });
    if (await openLoras.count()) await openLoras.click();
    else await page.getByRole('button', { name: 'Controls', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add LoRA', exact: true }).filter({ visible: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add LoRAs', exact: true });
  await expect(picker.getByText('Compatibility has not been verified for this model variant.', { exact: true }).first()).toBeVisible();
  await expect(picker.getByText('Excluded Conditioning', { exact: true })).toHaveCount(0);
  await expect(picker.getByText('Unknown Effect', { exact: true }).first()).toBeVisible();
  await picker.locator('.lora-option').filter({ hasText: 'Published Slider' }).first().click();
  await picker.getByRole('button', { name: 'Add', exact: true }).click();
  const value = page.getByLabel('Published Slider strength value', { exact: true }).filter({ visible: true });
  await value.fill('10');
  await value.press('Enter');
  await expect(value).toHaveValue('10.00');
  const slider = page.getByLabel('Published Slider strength', { exact: true }).filter({ visible: true });
  await expect(slider).toHaveAttribute('min', '-3');
  await expect(slider).toHaveAttribute('max', '10');
  await value.press('ArrowUp');
  await expect(value).toHaveValue('10.00');
});
