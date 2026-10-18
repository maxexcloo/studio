import { expect, test } from '@playwright/test';

test('administrators can manage access profiles, accounts and a personal MCP token', async ({ page, isMobile }) => {
  const otherAccountText = 'private-draft-from-another-account';
  const posts: { url: string; body: unknown }[] = [];
  const loraOps: string[] = [];
  let signedIn = true;
  const profiles = [{ id: 'artists', name: 'Artists', generationProfiles: ['image-fast'], features: { loras: true } }];
  const accounts = [
    { id: 'admin-id', username: 'recovery', displayName: 'Recovery', role: 'administrator', disabled: false },
    { id: 'artist-id', username: 'artist.one', displayName: 'Artist One', role: 'user', accessProfileId: 'artists', disabled: false }
  ];
  const route = async (request: import('@playwright/test').Route) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/api/accounts/status') return request.fulfill({ json: { ok: true, mode: 'multi-user', signedIn, account: signedIn ? { id: 'admin-id', role: 'administrator' } : null } });
    if (url.pathname === '/api/accounts/sign-out' && request.request().method() === 'POST') {
      signedIn = false;
      return request.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/accounts/mcp-token' && request.request().method() === 'GET') return request.fulfill({ json: { enabled: false, createdAt: '', endpoint: 'https://studio.example.test/mcp' } });
    if (url.pathname === '/api/accounts/admin') return request.fulfill({ json: { ok: true, accounts, accessProfiles: profiles, availableProfiles: ['image-fast', 'video-hd'] } });
    if (url.pathname === '/api/accounts/profiles' && request.request().method() === 'POST') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, profile: request.request().postDataJSON() } });
    }
    if (url.pathname === '/api/accounts/users' && request.request().method() === 'POST') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, account: { ...request.request().postDataJSON(), id: 'new-user', role: 'user' } } });
    }
    if (url.pathname === '/api/accounts/users/artist-id' && request.request().method() === 'PATCH') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, account: { id: 'artist-id', ...request.request().postDataJSON() } } });
    }
    if (url.pathname === '/api/accounts/mcp-token' && request.request().method() === 'POST') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, token: 'new-one-time-secret', createdAt: new Date().toISOString() } });
    }
    if (url.pathname === '/api/accounts/users/new-user') return request.fulfill({ json: { ok: true, account: { id: 'new-user', accessProfileId: request.request().postDataJSON().accessProfileId } } });
    return request.continue();
  };
  await page.addInitScript((text) => {
    localStorage.setItem('heiss-ui-draft', JSON.stringify({ prompt: text }));
    localStorage.setItem('heiss-ui-lora-pending', JSON.stringify([{ op: 'favorite', name: text, on: true }]));
    localStorage.setItem('heiss-ui-unstacked-runs', JSON.stringify(['private-run-from-another-account']));
  }, otherAccountText);
  await page.route('**/api/loras/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/api/loras/library' && request.request().method() === 'GET') return request.fulfill({ json: { found: false, library: { strengths: {}, snapshots: {}, favorites: [], recents: [] } } });
    if (url.pathname === '/api/loras/library/ops') {
      loraOps.push(request.request().postData() || '');
      return request.fulfill({ json: { ok: true, library: { strengths: {}, snapshots: {}, favorites: [], recents: [] } } });
    }
    return request.continue();
  });
  await page.route('**/api/accounts/**', route);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('heiss-ui-draft:account:admin-id'))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('heiss-ui-draft:account:admin-id'))).not.toContain(otherAccountText);
  expect(loraOps.join('\n')).not.toContain(otherAccountText);
  expect(await page.evaluate(() => localStorage.getItem('heiss-ui-lora-pending:account:admin-id'))).toBeNull();
  if (isMobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: /Use the full studio/ }).click();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts & MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access Profiles', exact: true })).toBeVisible();
  await page.getByPlaceholder('Studio Artists').fill('Video Artists');
  await page.getByRole('checkbox', { name: 'video-hd' }).check();
  await page.getByRole('checkbox', { name: 'LoRAs' }).check();
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect.poll(() => posts.some((post) => post.url === '/api/accounts/profiles')).toBe(true);
  const profile = posts.find((post) => post.url === '/api/accounts/profiles')?.body as { id: string; generationProfiles: string[]; features: { loras: boolean } };
  expect(profile.id).toBe('video-artists');
  expect(profile.generationProfiles).toEqual(['video-hd']);
  expect(profile.features.loras).toBe(true);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  expect(posts.find((post) => post.url === '/api/accounts/users/artist-id')?.body).toEqual({ disabled: true });

  await page.getByRole('button', { name: 'Create Token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy Token', exact: true })).toBeVisible();
  await expect(page.getByText('https://studio.example.test/mcp')).toBeVisible();
  await page.getByPlaceholder('new.artist').fill('new.artist');
  await page.getByPlaceholder('New Artist').fill('New Artist');
  await page.getByPlaceholder('At least 12 characters').fill('a secure temporary password');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect.poll(() => posts.some((post) => post.url === '/api/accounts/users')).toBe(true);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
