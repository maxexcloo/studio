import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * UI-PATTERNS › Pickers: the LoRA chooser opens on its final list. The names
 * (catalogue titles, not file names), the sections and the order in the first
 * frame it shows rows are the ones it shows a second later, even when the
 * LoRA information answers slowly and the chooser is opened at once.
 */

const loras = ['cyberpunk_neon_v1.safetensors', 'film_grain_35mm.safetensors', 'anime_watercolor.safetensors', 'zz_other_family.safetensors'];

async function prepare(page: Page, delay: number) {
  const models = await (await page.request.get('/api/models')).json();
  const base = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
  base.options = { ...base.options, loras };
  models.loras = loras;
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  let requests = 0;
  await page.route('**/api/loras/info', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ json: { loras: {
      'cyberpunk_neon_v1.safetensors': { title: 'Neon Nights', families: [base.family], base: base.family, triggers: [] },
      'film_grain_35mm.safetensors': { title: 'Film Grain', families: [base.family], base: base.family, triggers: [] },
      'anime_watercolor.safetensors': { title: 'Anime Watercolour', families: [base.family], base: base.family, triggers: [] },
      'zz_other_family.safetensors': { title: 'Another Family', families: ['wan'], base: 'wan', triggers: [] },
    } } });
  });
  return { requests: () => requests };
}

/** Samples, every frame from now, the chooser's section headings and row names in order. */
async function watchRows(page: Page) {
  await page.evaluate(() => {
    const frames: string[] = [];
    const sample = () => {
      const list = document.querySelector('.lora-picker-list');
      const rows = list ? [...list.querySelectorAll('.lora-picker-heading, .lora-library-select')].map((node) => node.getAttribute('aria-label') || node.textContent?.trim() || '') : [];
      if (rows.length) frames.push(rows.join(' | '));
      (window as any).__loraFrame = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__loraRows = frames;
  });
}

async function sampledRows(page: Page) {
  return page.evaluate(() => { cancelAnimationFrame((window as any).__loraFrame); return (window as any).__loraRows as string[]; });
}

async function openLoras(page: Page) {
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await watchRows(page);
  await composer.getByRole('button', { name: /^LoRAs/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'LoRAs', exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  return sampledRows(page);
}

test('the first frame of the LoRA chooser is its final list, opened at once on a slow answer', async ({ page }) => {
  await prepare(page, 700);
  await page.goto('/');
  const frames = await openLoras(page);
  expect(frames.length).toBeGreaterThan(0);
  const last = frames[frames.length - 1];
  expect(last).toContain('Select Neon Nights');
  expect(last).not.toContain('cyberpunk_neon_v1');
  // Every frame that showed rows showed the final ones, in the final order.
  expect([...new Set(frames)]).toEqual([last]);
});

test('LoRA information is fetched on idle after load, so a later open needs no request', async ({ page }) => {
  const { requests } = await prepare(page, 200);
  await page.goto('/');
  await expect.poll(requests, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const before = requests();
  const frames = await openLoras(page);
  expect([...new Set(frames)]).toEqual([frames[frames.length - 1]]);
  expect(frames[0]).toContain('Select Neon Nights');
  // Opening refreshes in the background at most once, and the list doesn't change for it.
  expect(requests() - before).toBeLessThanOrEqual(1);
});
