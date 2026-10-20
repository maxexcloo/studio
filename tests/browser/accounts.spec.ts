import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('administrators can manage access profiles, accounts and a personal MCP token', async ({ page }) => {
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
    if (url.pathname === '/api/accounts/admin') return request.fulfill({ json: { ok: true, accounts, accessProfiles: profiles, availableProfiles: ['image-fast', 'video-hd'], gateway: { links: [], pending: [{ identity: 'librechat-user-7', firstSeenAt: '2026-10-19T00:00:00.000Z', lastSeenAt: '2026-10-19T00:00:00.000Z' }] } } });
    if (url.pathname === '/api/accounts/gateway-links') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, gateway: { links: [], pending: [] } } });
    }
    if (url.pathname === '/api/accounts/gateway-pending/dismiss') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, gateway: { links: [], pending: [] } } });
    }
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
  await studioUi(page).openSettings();
  await page.getByRole('button', { name: 'Accounts & MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access Profiles', exact: true })).toBeVisible();
  await page.getByPlaceholder('Studio Artists').fill('Video Artists');
  await page.getByRole('switch', { name: 'video-hd' }).click();
  await page.getByRole('switch', { name: 'LoRAs' }).click();
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect.poll(() => posts.some((post) => post.url === '/api/accounts/profiles')).toBe(true);
  const profile = posts.find((post) => post.url === '/api/accounts/profiles')?.body as { id: string; generationProfiles: string[]; features: { loras: boolean } };
  expect(profile.id).toBe('video-artists');
  expect(profile.generationProfiles).toEqual(['video-hd']);
  expect(profile.features.loras).toBe(true);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  // Disabling asks first; nothing is sent until it is confirmed.
  expect(posts.some((post) => post.url === '/api/accounts/users/artist-id')).toBe(false);
  await page.getByRole('button', { name: 'Disable Account', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/users/artist-id')?.body).toEqual({ disabled: true });

  await page.getByRole('button', { name: 'Edit Artists', exact: true }).click();
  await expect(page.getByLabel('Profile name')).toHaveValue('Artists');
  await expect(page.getByRole('switch', { name: 'image-fast' })).toBeChecked();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // The placeholder shows by name, not as its sentinel value.
  await expect(page.getByLabel('Account for librechat-user-7')).toContainText('Choose an Account');
  await page.getByLabel('Account for librechat-user-7').click();
  await page.getByRole('option', { name: 'Artist One (artist.one)', exact: true }).click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/gateway-links')?.body).toEqual({ identity: 'librechat-user-7', accountId: 'artist-id' });
  await page.getByRole('button', { name: 'Dismiss librechat-user-7', exact: true }).click();
  expect(posts.some((post) => post.url === '/api/accounts/gateway-pending/dismiss')).toBe(false);
  await page.getByRole('button', { name: 'Dismiss Chat User', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/gateway-pending/dismiss')?.body).toEqual({ identity: 'librechat-user-7' });

  await page.getByRole('button', { name: 'Create Token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy Token', exact: true })).toBeVisible();
  // The one-time token stays readable if the clipboard is unavailable.
  await expect(page.getByLabel('New MCP token')).toHaveValue('new-one-time-secret');
  await expect(page.getByText('https://studio.example.test/mcp')).toBeVisible();
  const newEmail = page.getByLabel('Email', { exact: true });
  await expect(newEmail).toHaveAttribute('type', 'email');
  await expect(newEmail).toHaveAttribute('autocapitalize', 'none');
  await newEmail.fill('new.artist');
  await page.getByLabel('Display name', { exact: true }).fill('New Artist');
  await page.getByLabel('Temporary password', { exact: true }).fill('a secure temporary password');
  // The username is the account's email, so a new one must look like one.
  await expect(page.getByRole('button', { name: 'Create User', exact: true })).toBeDisabled();
  await expect(page.getByText('Enter an email address.', { exact: false })).toBeVisible();
  await newEmail.fill(' new.artist@example.com ');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/users')?.body).toMatchObject({ username: 'new.artist@example.com' });
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});

test('ordinary accounts open their own studio without administration sections', async ({ page }) => {
  await page.route('**/api/accounts/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/api/accounts/status') return request.fulfill({ json: { ok: true, mode: 'multi-user', signedIn: true, account: { id: 'artist-id', role: 'user', generationProfiles: [], features: {} } } });
    if (url.pathname === '/api/accounts/mcp-token') return request.fulfill({ json: { ok: true, enabled: false, createdAt: '', endpoint: 'https://studio.example.test/mcp' } });
    if (url.pathname === '/api/accounts/admin') throw new Error('An ordinary account must not request administration data.');
    return request.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Your private studio is being prepared')).toHaveCount(0);
  await studioUi(page).openSettings();
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections.getByRole('button', { name: 'Accounts & MCP', exact: true })).toBeVisible();
  for (const name of ['Models', 'Library', 'Connection']) await expect(sections.getByRole('button', { name, exact: true })).toHaveCount(0);
  await sections.getByRole('button', { name: 'Accounts & MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access Profiles', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
});

const signedOutStatus = (extra: object = {}) => ({ ok: true, mode: 'multi-user', signedIn: false, account: null, ...extra });

test('the sign-in box asks for an email, never capitalises it and shows errors inline', async ({ page }) => {
  const attempts: unknown[] = [];
  await page.route('**/api/accounts/status', (request) => request.fulfill({ json: signedOutStatus({ oidc: { label: 'Pocket ID' } }) }));
  await page.route('**/api/accounts/sign-in', (request) => {
    attempts.push(request.request().postDataJSON());
    return request.fulfill({ status: 401, json: { ok: false, error: 'That email or password is incorrect, or the account is not approved.' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign In to Studio', exact: true })).toBeVisible();
  const email = page.getByLabel('Email', { exact: true });
  for (const [name, value] of [['type', 'email'], ['autocomplete', 'username'], ['autocapitalize', 'none'], ['autocorrect', 'off'], ['spellcheck', 'false'], ['inputmode', 'email']]) await expect(email).toHaveAttribute(name, value);
  await expect(email).toHaveCSS('text-transform', 'none');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.getByRole('link', { name: 'Sign In with Pocket ID', exact: true })).toHaveAttribute('href', '/api/accounts/oidc/start');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeDisabled();
  await email.fill('max@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That email or password is incorrect, or the account is not approved.');
  await expect(email).toHaveValue('max@example.com');
  expect(attempts).toEqual([{ username: 'max@example.com', displayName: '', password: 'wrong' }]);
});

test('the first administrator is created with an email address', async ({ page }) => {
  await page.route('**/api/accounts/status', (request) => request.fulfill({ json: signedOutStatus({ needsRecoveryAdmin: true, setupTokenAccepted: true }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create the First Administrator', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pocket ID/ })).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('a password');
  await expect(page.getByRole('button', { name: 'Create Administrator', exact: true })).toBeDisabled();
  await page.getByLabel('Email', { exact: true }).fill('admin@example.com');
  await expect(page.getByRole('button', { name: 'Create Administrator', exact: true })).toBeEnabled();
});

test('phones reach account settings and sign out from the More sheet', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The More sheet is the phone studio.');
  let signedIn = true;
  await page.route('**/api/accounts/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/api/accounts/status') return request.fulfill({ json: { ok: true, mode: 'multi-user', signedIn, account: signedIn ? { id: 'artist-id', role: 'user', generationProfiles: [], features: {} } : null } });
    if (url.pathname === '/api/accounts/mcp-token') return request.fulfill({ json: { ok: true, enabled: false, createdAt: '', endpoint: 'https://studio.example.test/mcp' } });
    if (url.pathname === '/api/accounts/sign-out' && request.request().method() === 'POST') {
      signedIn = false;
      return request.fulfill({ json: { ok: true } });
    }
    return request.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /^Accounts & MCP/ }).click();
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign In to Studio', exact: true })).toBeVisible();
  expect(signedIn).toBe(false);
});
