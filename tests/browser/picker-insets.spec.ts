import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * UI-PATTERNS › Layering (phone pop-up lists): a pop-up's list starts as far
 * below its heading as it ends above the bottom, so at rest the first row sits
 * wholly below the list's top fade and only content scrolled up under the
 * heading fades.
 */

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#699b88"/></svg>');
const image = (id: string) => ({ id, source: 'generation', name: `${id}.png`, url: picture, thumbnailUrl: picture, mime: 'image/png', width: 80, height: 80, size: 10, createdAt: '' });

async function prepare(page: Page) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.mediaInputs = Array.from({ length: 3 }, (_, index) => ({ id: index ? `reference_${index + 1}` : 'reference', kind: 'image', role: 'reference', label: index ? `Reference ${index + 1}` : 'Reference Image', min: 0, max: 1, required: false, ...(index ? { follows: index > 1 ? `reference_${index}` : 'reference' } : {}) }));
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: Array.from({ length: 30 }, (_, index) => image(`inset-${index}`)), nextCursor: '' } }));
  await page.goto('/');
  return studioUi(page).openComposer();
}

/** The open pop-up's list: its fade's height, its top and bottom insets, and how far below its top the first item starts. */
async function insets(page: Page) {
  const body = page.locator('.reference-popover.is-pop .reference-popover-body').last();
  await expect(body).toBeVisible();
  await page.waitForTimeout(500);
  return body.evaluate((element) => {
    const style = getComputedStyle(element);
    const mask = style.maskImage || (style as any).webkitMaskImage || '';
    // "linear-gradient(transparent, black 10px, black)": the fade ends at its first length.
    const fade = mask === 'none' ? 0 : Number(/(\d+(?:\.\d+)?)px/.exec(mask)?.[1] || 0);
    const first = [...element.querySelectorAll<HTMLElement>('.reference-tile, .list-row, .list-section, button')].find((node) => node.getBoundingClientRect().height > 8);
    return { fade, top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), first: first ? first.getBoundingClientRect().top - element.getBoundingClientRect().top : Infinity };
  });
}

for (const [name, trigger] of [['References', /^(Add )?References/], ['Size', /^Size/], ['Advanced', /^Advanced/]] as const) {
  test(`the phone ${name} pop-up's first row sits below its top fade at rest`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone pop-up lists.');
    const composer = await prepare(page);
    await composer.getByRole('button', { name: trigger }).first().click();
    const box = await insets(page);
    expect(box.top).toBe(box.bottom);
    expect(box.top).toBeGreaterThanOrEqual(box.fade);
    expect(box.first).toBeGreaterThanOrEqual(box.fade);
  });
}
