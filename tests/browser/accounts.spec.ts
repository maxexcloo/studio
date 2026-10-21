import { expect, test } from '@playwright/test';
import { studioUi } from './helpers/ui';

test('administrators can manage access profiles, accounts and a personal MCP token', async ({ page }) => {
  // One long end-to-end walk through Users and Account; CI runners need more than the default 30 s.
  test.setTimeout(90_000);
  const otherAccountText = 'private-draft-from-another-account';
  const posts: { url: string; body: unknown }[] = [];
  const loraOps: string[] = [];
  let signedIn = true;
  const profiles = [{ id: 'artists', name: 'Artists', generationProfiles: ['image-fast'], features: { loras: true } }];
  const accounts = [
    { id: 'admin-id', username: 'recovery', displayName: 'Recovery', role: 'administrator', disabled: false },
    { id: 'artist-id', username: 'artist.one', displayName: 'Artist One', role: 'user', accessProfileId: 'artists', disabled: false },
    { id: 'pending-id', username: 'waiting@example.com', displayName: 'Waiting One', role: 'user', pending: true, signInLinked: true, disabled: false }
  ];
  const defaults = { defaultAccessProfileId: '', requireApproval: true };
  const route = async (request: import('@playwright/test').Route) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/api/accounts/status') return request.fulfill({ json: { ok: true, mode: 'multi-user', signedIn, account: signedIn ? { id: 'admin-id', role: 'administrator' } : null } });
    if (url.pathname === '/api/accounts/sign-out' && request.request().method() === 'POST') {
      signedIn = false;
      return request.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/accounts/mcp-token' && request.request().method() === 'GET') return request.fulfill({ json: { enabled: false, createdAt: '', endpoint: 'https://studio.example.test/mcp' } });
    if (url.pathname === '/api/accounts/me') return request.fulfill({ json: { ok: true, account: { id: 'admin-id', username: 'recovery', displayName: 'Recovery', role: 'administrator' }, mcp: { enabled: false, createdAt: '', endpoint: 'https://studio.example.test/mcp' } } });
    if (url.pathname === '/api/accounts/admin') return request.fulfill({ json: { ok: true, accounts, accessProfiles: profiles, availableProfiles: ['image-fast', 'video-hd'], ...defaults, lockedFeatures: { loras: false, cloudModels: false, presets: false }, gateway: { links: [], pending: [{ identity: 'librechat-user-7', firstSeenAt: '2026-10-19T00:00:00.000Z', lastSeenAt: '2026-10-19T00:00:00.000Z' }] } } });
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
    if (url.pathname === '/api/accounts/default-profile' && request.request().method() === 'POST') {
      const body = request.request().postDataJSON();
      posts.push({ url: url.pathname, body });
      Object.assign(defaults, typeof body.accessProfileId === 'string' ? { defaultAccessProfileId: body.accessProfileId } : {}, typeof body.requireApproval === 'boolean' ? { requireApproval: body.requireApproval } : {});
      return request.fulfill({ json: { ok: true, ...defaults } });
    }
    if (url.pathname === '/api/accounts/users' && request.request().method() === 'POST') {
      posts.push({ url: url.pathname, body: request.request().postDataJSON() });
      return request.fulfill({ json: { ok: true, account: { ...request.request().postDataJSON(), id: 'new-user', role: 'user' } } });
    }
    if (/^\/api\/accounts\/users\/(artist|pending)-id$/.test(url.pathname) && request.request().method() === 'PATCH') {
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
    localStorage.setItem('studio-draft', JSON.stringify({ prompt: text }));
    localStorage.setItem('studio-lora-pending', JSON.stringify([{ op: 'favorite', name: text, on: true }]));
    localStorage.setItem('studio-unstacked-runs', JSON.stringify(['private-run-from-another-account']));
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('studio-draft:account:admin-id'))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('studio-draft:account:admin-id'))).not.toContain(otherAccountText);
  expect(loraOps.join('\n')).not.toContain(otherAccountText);
  expect(await page.evaluate(() => localStorage.getItem('studio-lora-pending:account:admin-id'))).toBeNull();
  await studioUi(page).openSettings();
  // Account first, then the pages alphabetically.
  await expect(page.getByRole('navigation', { name: 'Settings Sections' }).getByRole('button')).toHaveText(['Account', 'About', 'Maintenance', 'Models', 'Profiles', 'Studio', 'Users', 'Workers']);
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access Profiles', exact: true })).toBeVisible();
  // Groups read alphabetically, and the model profile editor is its own page now.
  await expect(page.locator('#settings-panel .list-section-title')).toHaveText(['Access Profiles', 'Accounts', 'Chat Gateway']);
  await expect(page.getByRole('button', { name: 'Edit Profiles', exact: true })).toHaveCount(0);
  // New Account sits on the Accounts heading's line, not in a row of its own.
  await expect(page.locator('.set-group-head').filter({ hasText: 'Accounts' }).getByRole('button', { name: 'New Account', exact: true })).toBeVisible();
  await expect(page.getByText('A local account with an access profile.', { exact: true })).toHaveCount(0);
  // One access profile at a time: picked from a list with New, edited with multi-selects, then saved or discarded.
  await page.getByLabel('Access Profile to Edit').click();
  await page.getByRole('option', { name: 'New Access Profile', exact: true }).click();
  await page.getByLabel('Profile Name').fill('Video Artists');
  // The ID comes from the name; there is no Profile ID row.
  await expect(page.getByLabel('Profile ID')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Features', exact: true }).click();
  const features = page.getByRole('listbox', { name: 'Features', exact: true });
  await expect(features.getByRole('option')).toHaveText([/^Cloud Models/, /^Gallery/, /^Image Generation/, /^Image References/, /^LoRAs/, /^NSFW Models/, /^Prompt Assistant/, /^Prompt History/, /^Video Generation/, /^Video References/]);
  // All picks everything at once, dependants included; presets stay with administrators.
  await page.locator('.dropdown-menu').getByRole('button', { name: 'All', exact: true }).click();
  for (const name of ['Cloud Models', 'Image References', 'LoRAs', 'NSFW Models', 'Prompt Assistant', 'Video References']) await expect(features.getByRole('option', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-selected', 'true');
  await expect(features.getByRole('option', { name: /^Presets & Civitai Imports/ })).toHaveCount(0);
  await page.locator('.dropdown-menu').getByRole('button', { name: 'Clear', exact: true }).click();
  await features.getByRole('option', { name: /^Image Generation/ }).click();
  await features.getByRole('option', { name: /^Video Generation/ }).click();
  await features.getByRole('option', { name: /^LoRAs/ }).click();
  // Escape closes the menu alone; Settings stays open.
  await page.keyboard.press('Escape');
  await expect(features).toHaveCount(0);
  await expect(page.getByLabel('Profile Name')).toBeVisible();
  const users = page.getByRole('region', { name: 'Users', exact: true });
  await users.getByRole('combobox', { name: 'Models', exact: true }).click();
  // Models has no search box.
  await expect(page.getByLabel('Search Models', { exact: true })).toHaveCount(0);
  await page.getByRole('listbox', { name: 'Models', exact: true }).getByRole('option', { name: /^video-hd/ }).click();
  await expect(page.getByRole('listbox', { name: 'Models', exact: true }).getByRole('option', { name: /^video-hd/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Unsaved Changes' }).getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Profile', exact: true }).click();
  await expect.poll(() => posts.some((post) => post.url === '/api/accounts/profiles')).toBe(true);
  const profile = posts.find((post) => post.url === '/api/accounts/profiles')?.body as { id: string; generationProfiles: string[]; features: { loras: boolean; videoGeneration: boolean } };
  expect(profile.id).toBe('video-artists');
  expect(profile.generationProfiles).toEqual(['video-hd']);
  expect(profile.features.loras).toBe(true);
  expect(profile.features.videoGeneration).toBe(true);
  expect(profile.features.cloudModels).toBe(false);

  // One default access profile for every new account, saved at once.
  await page.getByLabel('Default Access Profile', { exact: true }).click();
  await page.getByRole('option', { name: 'Artists', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/default-profile')?.body).toEqual({ accessProfileId: 'artists' });
  // Require Approval sits beside it, on until turned off; a waiting sign-in is approved onto the default.
  const approval = page.getByRole('switch', { name: 'Require Approval', exact: true });
  await expect(approval).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Approve Waiting One', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/users/pending-id')?.body).toEqual({ accessProfileId: 'artists' });
  await approval.click();
  await expect.poll(() => posts.filter((post) => post.url === '/api/accounts/default-profile').at(-1)?.body).toEqual({ requireApproval: false });
  await expect(approval).toHaveAttribute('aria-checked', 'false');
  await page.locator('.set-row').filter({ hasText: 'artist.one' }).getByRole('button', { name: 'Disable', exact: true }).click();
  // Disabling acts at once (it can be enabled again); no question in the pill.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/users/artist-id')?.body).toEqual({ disabled: true });

  await page.getByLabel('Access Profile to Edit').click();
  await page.getByRole('option', { name: 'Artists', exact: true }).click();
  await expect(page.getByLabel('Profile Name')).toHaveValue('Artists');
  await expect(users.getByRole('combobox', { name: 'Models', exact: true })).toContainText('image-fast');

  // The placeholder shows by name, not as its sentinel value.
  await expect(page.getByLabel('Account for librechat-user-7')).toContainText('Choose an Account');
  await page.getByLabel('Account for librechat-user-7').click();
  await page.getByRole('option', { name: 'Artist One (artist.one)', exact: true }).click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/gateway-links')?.body).toEqual({ identity: 'librechat-user-7', accountId: 'artist-id' });
  await page.getByRole('button', { name: 'Dismiss librechat-user-7', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/gateway-pending/dismiss')?.body).toEqual({ identity: 'librechat-user-7' });

  // The personal token lives in Account; Users is administration only.
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Settings Sections' }).getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Create Token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy Token', exact: true })).toBeVisible();
  // The one-time token stays readable if the clipboard is unavailable.
  await expect(page.getByLabel('New MCP Token')).toHaveValue('new-one-time-secret');
  await expect(page.getByText('https://studio.example.test/mcp')).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings Sections' }).getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'New Account', exact: true }).click();
  const newEmail = page.getByLabel('Email', { exact: true });
  await expect(newEmail).toHaveAttribute('type', 'email');
  await expect(newEmail).toHaveAttribute('autocapitalize', 'none');
  await newEmail.fill('new.artist');
  await page.getByLabel('Display Name', { exact: true }).fill('New Artist');
  await page.getByLabel('Temporary Password', { exact: true }).fill('a secure temporary password');
  // The username is the account's email, so a new one must look like one.
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
  await expect(page.getByText('Enter an email address.', { exact: false })).toBeVisible();
  await newEmail.fill(' new.artist@example.com ');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect.poll(() => posts.find((post) => post.url === '/api/accounts/users')?.body).toMatchObject({ username: 'new.artist@example.com' });
  // A menu still closing takes the first outside click for itself, so go to Account until it shows.
  await expect(async () => {
    await page.getByRole('navigation', { name: 'Settings Sections' }).getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // Settings › Account has no Session group or Access line; Sign Out lives in the Menu.
  await expect(page.getByRole('heading', { name: 'Session', exact: true })).toHaveCount(0);
  await expect(page.getByText('Administrator · full access', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The phone's Menu or the desktop dock's Account menu.
  await page.getByRole('button', { name: 'Menu', exact: true }).or(page.getByRole('button', { name: 'Account', exact: true })).first().click();
  await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
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
  const sections = page.getByRole('navigation', { name: 'Settings Sections' });
  await expect(sections.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
  // Administration stays with administrators; everyone has Studio and Maintenance.
  for (const name of ['Users', 'Models', 'Profiles']) await expect(sections.getByRole('button', { name, exact: true })).toHaveCount(0);
  for (const name of ['Studio', 'Maintenance', 'About', 'Workers']) await expect(sections.getByRole('button', { name, exact: true })).toBeVisible();
  // Everyone reads Upscale's status in Workers; the worker list stays with administrators.
  await sections.getByRole('button', { name: 'Workers', exact: true }).click();
  await expect(page.locator('.set-row').filter({ hasText: 'Upscale Status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Worker', exact: true })).toHaveCount(0);
  await sections.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access Profiles', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Create Token', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign In to Studio', exact: true })).toBeVisible();
  expect(signedIn).toBe(false);
});
