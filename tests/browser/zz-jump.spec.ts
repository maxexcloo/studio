import { test } from '@playwright/test';
import { studioUi } from './helpers/ui';
test('jump', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const ui = studioUi(page);
  const composer = await ui.openComposer();
  await ui.prompt.click();
  await page.evaluate(() => {
    const log: any[] = []; (window as any).__log = log;
    const ta = document.activeElement as HTMLElement;
    const shell = ta.closest('[aria-label="Create"]') as HTMLElement || ta.parentElement!;
    const tick = () => { const a = ta.getBoundingClientRect(); const b = shell.getBoundingClientRect(); log.push([Math.round(performance.now()), Math.round(a.top), Math.round(a.height), Math.round(b.top), Math.round(b.height), ta.scrollTop]); requestAnimationFrame(tick); };
    tick();
  });
  for (const word of 'a long prompt that keeps going and going so that it wraps onto a third line and then a fourth line and maybe even a fifth line of text in the composer box to see how it behaves when it grows taller than two lines of text which it should do smoothly'.split(' ')) {
    await page.keyboard.type(word + ' ', { delay: 15 });
  }
  await page.waitForTimeout(600);
  const log = await page.evaluate(() => (window as any).__log);
  let prev: any = null; const changes: any[] = [];
  for (const row of log) { if (!prev || row.slice(1).join() !== prev.slice(1).join()) changes.push(row); prev = row; }
  console.log(JSON.stringify(changes));
});
