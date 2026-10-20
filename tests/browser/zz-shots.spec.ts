import { expect, test } from '@playwright/test';
const colours = ['#527b8f', '#8f5252', '#528f5a', '#8f8752', '#6b528f'];
const pic = (i: number) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${i % 3 ? 512 : 768}"><rect width="512" height="768" fill="${colours[i % 5]}"/><circle cx="256" cy="256" r="120" fill="#fff8"/></svg>`);
const images = Array.from({ length: 60 }, (_, i) => ({ id: `image-${i}`, url: pic(i), filename: `image-${i}.png`, type: 'image', status: i === 2 ? 'error' : 'done', error: i === 2 ? 'Out of memory' : undefined, prompt: `A photo of a calm landscape number ${i}`, model: 'flux1-schnell.safetensors', createdAt: new Date(Date.now() - i * 60000).toISOString(), width: 512, height: i % 3 ? 512 : 768, settings: { profileId: 'mock-flux-schnell', steps: 4, cfg: 1, seed: '0' } }));
test('shots', async ({ page, isMobile }) => {
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: images, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  await expect(page.locator('[data-tile-id]').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(600);
  const tag = isMobile ? 'phone' : 'desktop';
  await page.screenshot({ path: `/tmp/uib/${tag}-${process.env.SHOT || 'a'}-gallery.png` });
  for (const step of (process.env.STEPS || '').split(',').filter(Boolean)) {
    if (step.startsWith('click:')) await page.locator(step.slice(6)).first().click();
    else if (step.startsWith('role:')) await page.getByRole('button', { name: step.slice(5), exact: true }).first().click();
    else if (step.startsWith('fill:')) { const [sel, text] = step.slice(5).split('='); await page.locator(sel).first().fill(text); }
    else if (step === 'wait') await page.waitForTimeout(700);
    else if (step.startsWith('shot:')) await page.screenshot({ path: `/tmp/uib/${tag}-${process.env.SHOT || 'a'}-${step.slice(5)}.png` });
  }
});
