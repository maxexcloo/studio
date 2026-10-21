import { expect, test, type Page, type Route } from '@playwright/test';
import { studioUi } from './helpers/ui';

/*
 * Settings › Profiles with a mocked API: an AI-drafted profile shows where it
 * stands and is approved in place; Versions open to their diff and Revert as a
 * new version; Guide edits the applicable guide with Review Changes and Save;
 * Export downloads the bundle and says what it held.
 */

const text = (name: string, steps = 8) => `${JSON.stringify({ heissUi: { id: 'real-skin', name, kind: 'image', family: 'krea2', defaults: { steps }, controls: { prompt: { node: '2', input: 'text' } } }, graph: {} }, null, 2)}\n`;
const versions = [
  { version: 2, at: '2026-10-21T11:00:00.000Z', by: 'assistant', origin: 'ai', aiDrafted: true },
  { version: 1, at: '2026-10-21T10:00:00.000Z', by: 'seed', origin: 'seed', aiDrafted: false }
];
const pack = { name: 'Krea 2', summary: 'Seed guide.' };

async function mockProfiles(page: Page) {
  const state = { aiDrafted: true, posts: [] as Array<{ url: string; body: unknown }>, current: text('Real Skin V3', 12) };
  const list = () => [
    { id: 'real-skin', profileId: 'custom:real-skin', name: 'Real Skin V3', kind: 'image', family: 'krea2', readable: true, edited: { editedAt: '2026-10-21T11:00:00.000Z', by: 'assistant' }, version: 2, origin: 'ai', aiDrafted: state.aiDrafted },
    { id: 'krea-fast', profileId: 'custom:krea-fast', name: 'Krea 2 Fast', kind: 'image', family: 'krea2', readable: true, edited: null, version: 1, origin: 'seed', aiDrafted: false }
  ];
  await page.route(/\/api\/profiles\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() : null;
    if (method !== 'GET') state.posts.push({ url: `${method} ${url.pathname}`, body });
    const path = url.pathname;
    if (path === '/api/profiles/editable') return route.fulfill({ json: { ok: true, profiles: list() } });
    if (path === '/api/profiles/editable/real-skin') return route.fulfill({ json: { ok: true, id: 'real-skin', text: state.current, hash: 'h-current', edited: null, version: { version: 2, origin: 'ai', aiDrafted: state.aiDrafted, by: 'assistant', editedAt: '2026-10-21T11:00:00.000Z' } } });
    if (path === '/api/profiles/editable/real-skin/approve') { state.aiDrafted = false; return route.fulfill({ json: { ok: true, meta: { aiDrafted: false } } }); }
    if (path === '/api/profiles/editable/real-skin/versions') return route.fulfill({ json: { ok: true, versions, meta: null } });
    if (path === '/api/profiles/editable/real-skin/versions/1') return route.fulfill({ json: { ok: true, version: { ...versions[1], text: text('Real Skin V3') } } });
    if (path === '/api/profiles/editable/real-skin/versions/2') return route.fulfill({ json: { ok: true, version: { ...versions[0], text: text('Real Skin V3', 12) } } });
    if (path === '/api/profiles/editable/real-skin/revert') { state.current = text('Real Skin V3'); return route.fulfill({ json: { ok: true, id: 'real-skin', text: state.current, hash: 'h-reverted', edited: null } }); }
    if (path === '/api/profiles/editable/real-skin/guide') return route.fulfill({ json: { ok: true, packId: 'krea2', source: 'family', pack, hash: 'g-1', meta: { version: 1, origin: 'seed', aiDrafted: false, by: 'seed', editedAt: '2026-10-20T10:00:00.000Z' } } });
    if (path === '/api/profiles/guides/krea2/versions') return route.fulfill({ json: { ok: true, versions: [versions[1]], meta: null, hash: 'g-1' } });
    if (path === '/api/profiles/guides/krea2') return route.fulfill({ json: { ok: true, packId: 'krea2', pack: body?.pack ? JSON.parse(body.pack) : pack, hash: 'g-2', meta: { version: 2, origin: 'studio' } } });
    if (path === '/api/profiles/export') return route.fulfill({ status: 200, body: Buffer.from('PK\u0005\u0006'.padEnd(22, '\u0000'), 'binary'), headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="studio-profiles-test.zip"', 'x-studio-export': JSON.stringify({ profiles: 2, guides: 1, unreviewed: 1 }) } });
    return route.fulfill({ status: 404, json: { ok: false, error: `Unmocked ${path}` } });
  });
  return state;
}

async function openProfiles(page: Page) {
  await page.goto('/');
  await studioUi(page).openSettings();
  const dialog = page.locator('.settings-modal');
  await dialog.getByRole('button', { name: 'Profiles', exact: true }).click();
  return dialog;
}
const statusPill = (page: Page) => page.locator('[data-status-message]');

test('an AI-drafted profile opens first, says so and is approved in place', async ({ page }) => {
  const state = await mockProfiles(page);
  const dialog = await openProfiles(page);
  const source = dialog.locator('.set-row').filter({ hasText: 'Source' });
  await expect(source).toContainText('AI-Drafted');
  await expect(source).toContainText('Only administrators see it until you approve it');
  await source.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(statusPill(page)).toContainText('Real Skin V3 approved');
  await expect(source).toContainText('Drafted by the Assistant');
  await expect(source.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  expect(state.posts.map((post) => post.url)).toEqual(['POST /api/profiles/editable/real-skin/approve']);
});

test('Versions open in place to what they changed and Revert as a new version', async ({ page }) => {
  const state = await mockProfiles(page);
  const dialog = await openProfiles(page);
  await dialog.getByRole('radio', { name: 'Versions', exact: true }).click();
  const rows = dialog.locator('.profile-version');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Version 2 · Current');
  await expect(rows.first()).toContainText('Drafted by the Assistant');
  await expect(rows.first()).toContainText('AI-Drafted');
  // Version 2 changed the steps from 8 to 12; it is current, so it has no Revert.
  await rows.first().click();
  const diff = dialog.getByRole('list', { name: 'Changes in Version 2' });
  await expect(diff.locator('.is-remove')).toContainText('"steps": 8');
  await expect(diff.locator('.is-add')).toContainText('"steps": 12');
  await expect(dialog.getByRole('button', { name: /^Revert to Version 2/ })).toHaveCount(0);
  await rows.nth(1).click();
  await dialog.getByRole('button', { name: 'Revert to Version 1', exact: true }).click();
  await expect(statusPill(page)).toContainText('Real Skin V3 back to version 1');
  expect(state.posts).toEqual([{ url: 'POST /api/profiles/editable/real-skin/revert', body: { version: 1, baseHash: 'h-current' } }]);
});

test('Guide shows the guide that applies and saves an edit after its review', async ({ page }) => {
  const state = await mockProfiles(page);
  const dialog = await openProfiles(page);
  await dialog.getByRole('radio', { name: 'Guide', exact: true }).click();
  await expect(dialog.locator('.set-row').filter({ hasText: 'Krea 2' }).first()).toContainText('Its family’s guide');
  const field = dialog.getByRole('textbox', { name: 'Guide JSON' });
  await expect(field).toHaveValue(/Seed guide\./);
  await field.fill(JSON.stringify({ name: 'Krea 2', summary: 'Edited guide.' }, null, 2));
  await dialog.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Changes' }).locator('.is-add')).toContainText(['"summary": "Edited guide."']);
  await dialog.getByRole('button', { name: 'Save Guide', exact: true }).click();
  await expect(statusPill(page)).toContainText('Guide saved');
  expect(state.posts.map((post) => post.url)).toEqual(['PUT /api/profiles/guides/krea2']);
  expect(state.posts[0].body).toMatchObject({ baseHash: 'g-1' });
});

test('Export downloads the bundle and says what it held', async ({ page }) => {
  await mockProfiles(page);
  const dialog = await openProfiles(page);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('studio-profiles-test.zip');
  await expect(statusPill(page)).toContainText('Exported 2 profiles and 1 guide, 1 not yet approved');
});
