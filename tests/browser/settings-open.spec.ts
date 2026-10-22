import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * UI-PATTERNS › Settings: the first open of a session draws the final sheet
 * from its first frame. No stand-in ("Opening settings…") that is swapped for
 * the real sheet and fades in again, no rail or page that changes once it
 * shows. Each probe samples every frame from the press until it has settled.
 */

type Frame = { modals: number; opening: boolean; nav: string; page: string; opacity: number; node: number };

async function watch(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    const nodes = new WeakMap<Element, number>();
    let next = 0;
    const sample = () => {
      const modal = document.querySelector('.settings-modal');
      if (modal && !nodes.has(modal)) nodes.set(modal, ++next);
      frames.push({
        modals: document.querySelectorAll('.settings-modal').length,
        opening: [...document.querySelectorAll('.settings-modal [role="status"]')].some((node) => /Opening/i.test(node.textContent || '')),
        nav: [...document.querySelectorAll('.set-nav > *')].map((node) => node.classList.contains('set-nav-divider') ? '|' : node.textContent).join(','),
        page: document.querySelector('#settings-panel-title')?.textContent || '',
        opacity: modal ? Number(getComputedStyle(modal).opacity) : 0,
        node: modal ? nodes.get(modal)! : 0,
      });
      (window as any).__settingsFrame = requestAnimationFrame(sample);
    };
    sample();
    (window as any).__settings = frames;
  });
}

async function frames(page: Page) {
  return page.evaluate(() => { cancelAnimationFrame((window as any).__settingsFrame); return (window as any).__settings as Frame[]; });
}

test('the first open of Settings draws the final sheet from its first frame', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  // As soon as the studio shows, before its idle time could fetch Settings' code.
  await expect(page.locator('.phone-shell, .app-shell')).toHaveCount(1);
  await watch(page);
  await ui.openSettings();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(700);
  const shown = (await frames(page)).filter((frame) => frame.modals);
  expect(shown.length).toBeGreaterThan(3);
  // One sheet, never a stand-in, never replaced.
  expect(shown.filter((frame) => frame.opening || frame.modals !== 1)).toEqual([]);
  expect(new Set(shown.map((frame) => frame.node)).size).toBe(1);
  // The rail and the page are final from the first frame.
  expect(new Set(shown.map((frame) => `${frame.nav} / ${frame.page}`))).toEqual(new Set([`${shown.at(-1)!.nav} / ${shown.at(-1)!.page}`]));
  expect(shown[0].page).toBe('Studio');
  // It fades in once: its opacity never falls back.
  for (let index = 1; index < shown.length; index++) expect(shown[index].opacity).toBeGreaterThanOrEqual(shown[index - 1].opacity - 0.001);
  expect(shown.at(-1)!.opacity).toBe(1);
});

test('About stands apart at the foot of the Settings rail', async ({ page }) => {
  await page.goto('/');
  const ui = studioUi(page);
  const phone = await ui.isPhone();
  await ui.openSettings();
  const nav = page.getByRole('navigation', { name: 'Settings Sections', exact: true });
  await expect(nav).toBeVisible();
  const layout = await nav.evaluate((element) => {
    const children = [...element.children] as HTMLElement[];
    const about = element.querySelector<HTMLElement>('[data-section="about"]')!;
    const divider = element.querySelector<HTMLElement>('.set-nav-divider')!;
    const before = about.previousElementSibling === divider ? divider.previousElementSibling as HTMLElement : null;
    const box = (node: HTMLElement) => node.getBoundingClientRect();
    return {
      last: children.at(-1) === about,
      dividerBefore: about.previousElementSibling === divider,
      gap: before ? (getComputedStyle(element).flexDirection === 'row' ? box(about).left - box(before).right : box(about).top - box(before).bottom) : 0,
      bottomGap: box(element).bottom - box(about).bottom,
    };
  });
  expect(layout.last).toBe(true);
  expect(layout.dividerBefore).toBe(true);
  // A clear separation from the section before it.
  expect(layout.gap).toBeGreaterThanOrEqual(8);
  // On the desktop rail About sits at its foot, inside the rail's padding.
  if (!phone) expect(layout.bottomGap).toBeLessThanOrEqual(16);
  await expect(nav.locator('[data-section]').last()).toHaveAttribute('data-section', 'about');
});
