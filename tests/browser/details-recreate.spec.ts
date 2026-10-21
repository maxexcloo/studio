import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

// Details' footer (UI-PATTERNS › Action Placement): Copy and Recreate, Recreate keeping how a prompt was written.
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function mockGallery(page: Page, { chatUrl = '' } = {}) {
  const models = await (await page.request.get('/api/models')).json();
  const profile = models.profiles.find((item: any) => item.id === models.defaults.imageModel);
  const item = { id: 'chat-made-0', jobId: 'chat-made-job', index: 0, url: picture, type: 'image', status: 'done', prompt: 'A heron in morning mist, cinematic light', model: profile.model, createdAt: '2026-10-21T00:00:00Z', width: 512, height: 512, settings: { profileId: profile.id, steps: 4, cfg: 1, seed: '77', sampler: 'euler' }, assistant: { preset: 'cinematic', model: 'ai/text-quick', source: 'chat' } };
  await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.route('**/api/chat', (route) => route.fulfill({ json: { ok: true, url: chatUrl } }));
  const handovers: unknown[] = [];
  await page.route('**/api/chat/handover', async (route) => { handovers.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, jobId: item.jobId } }); });
  // window.open is recorded instead of opening a tab.
  await page.addInitScript(() => { (window as any).opened = []; window.open = ((url: string) => { (window as any).opened.push(String(url)); return null; }) as typeof window.open; });
  return { item, profile, handovers };
}

async function openDetails(page: Page, id: string) {
  const ui = studioUi(page);
  const viewer = await ui.openViewer(page.locator(`[data-tile-id="${id}"] .tile`));
  await ui.showDetails();
  return { ui, viewer, footer: viewer.locator('.viewer-side').getByRole('group', { name: 'Details Actions', exact: true }) };
}

test('Details offers only Copy and Recreate, also on a finished job', async ({ page }) => {
  const { item, handovers } = await mockGallery(page, { chatUrl: 'https://chat.example.test' });
  await page.goto('/');
  const { footer } = await openDetails(page, item.id);
  expect((await footer.getByRole('button').allInnerTexts()).map((name) => name.trim())).toEqual(['Copy', 'Recreate']);
  await expect(page.getByRole('button', { name: 'Refine in Chat', exact: true })).toHaveCount(0);
  expect(handovers).toEqual([]);
});

test('Recreate carries how the prompt was written into the rerun, until the prompt changes', async ({ page }) => {
  const { item } = await mockGallery(page);
  const bodies: Array<Record<string, any>> = [];
  await page.route('**/api/generate', async (route) => { bodies.push(route.request().postDataJSON()); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
  await page.goto('/');
  const { ui, footer } = await openDetails(page, item.id);
  await footer.getByRole('button', { name: 'Recreate', exact: true }).click();
  await ui.openComposer();
  await expect(ui.prompt).toHaveValue(item.prompt);
  await ui.generate.click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].assistant).toEqual({ preset: 'cinematic', model: 'ai/text-quick', source: 'chat' });
  expect(bodies[0].seed).toBe('77');
  // A failed run leaves the composer as it was; on the phone it may have closed with the message.
  await ui.openComposer();
  await ui.prompt.fill('Something else entirely');
  await ui.generate.click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].assistant).toBeUndefined();
});
