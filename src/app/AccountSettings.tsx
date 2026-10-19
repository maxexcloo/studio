import React from 'react';
import { Ban, Check, Copy, KeyRound, Link2, LogOut, Pencil, Power, RefreshCw, Unlink, UserPlus, X } from 'lucide-react';
import { apiJson } from './api';
import { StudioSelect } from './components';
import { Group, Row, Switch } from './SettingsControls';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

type Feature = 'loras' | 'imageGeneration' | 'videoGeneration' | 'imageReferences' | 'videoReferences' | 'gallery' | 'promptHistory';
type AccessProfile = { id: string; name: string; generationProfiles: string[]; features: Record<Feature, boolean> };
type Account = { id: string; username: string; displayName: string; role: 'administrator' | 'user'; accessProfileId?: string; disabled: boolean; identity?: { provider?: string }; pending?: boolean; signInLinked?: boolean };
type GatewayIdentities = { links: { identity: string; accountId: string; linkedAt: string }[]; pending: { identity: string; firstSeenAt: string; lastSeenAt: string }[] };
type AdminData = { accessProfiles: AccessProfile[]; availableProfiles: string[]; accounts: Account[]; gateway?: GatewayIdentities };
type TokenStatus = { enabled: boolean; createdAt: string; endpoint: string };

const featureLabels: [Feature, string][] = [
  ['gallery', 'Gallery'], ['imageGeneration', 'Image Generation'], ['imageReferences', 'Image References'],
  ['loras', 'LoRAs'], ['promptHistory', 'Prompt History'], ['videoGeneration', 'Video Generation'], ['videoReferences', 'Video References']
];
const blankFeatures = () => Object.fromEntries(featureLabels.map(([key]) => [key, false])) as Record<Feature, boolean>;
const jsonPost = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
// FluidSelect needs a non-empty value for its placeholder option.
const NONE = '__none__';
const choose = (label: string, value: string) => value ? [] : [{ label, value: NONE }];

/** profileLabels names generation profiles from /api/models; an unknown ID shows as itself. */
export function AccountSettings({ showToast, copyToClipboard, confirmAction, isAdmin, profileLabels }: { showToast: ShowToast; copyToClipboard: (text: string) => Promise<boolean>; confirmAction: ConfirmAction; isAdmin: boolean; profileLabels?: Record<string, string> }) {
  const [admin, setAdmin] = React.useState<AdminData | null>(null);
  const [token, setToken] = React.useState<TokenStatus | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [issuedToken, setIssuedToken] = React.useState('');
  const [busy, setBusy] = React.useState(true);
  const [editingId, setEditingId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const [profileId, setProfileId] = React.useState('');
  const [selectedProfiles, setSelectedProfiles] = React.useState<string[]>([]);
  const [features, setFeatures] = React.useState<Record<Feature, boolean>>(blankFeatures());
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [assignedProfile, setAssignedProfile] = React.useState('');
  const [resetAccount, setResetAccount] = React.useState('');
  const [resetPassword, setResetPassword] = React.useState('');
  const [gatewayChoice, setGatewayChoice] = React.useState<Record<string, string>>({});

  const refresh = React.useCallback(async () => {
    setBusy(true);
    try {
      setToken(await apiJson<TokenStatus>('/api/accounts/mcp-token'));
      if (isAdmin) {
        const adminResult = await apiJson<AdminData>('/api/accounts/admin');
        setAdmin(adminResult);
        setAssignedProfile((current) => current || adminResult.accessProfiles[0]?.id || '');
      }
      setLoadError('');
    } catch (error) {
      setLoadError(message(error, 'Could not load account settings.'));
    } finally { setBusy(false); }
  }, [isAdmin]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      showToast(message(error, failure), 'error');
      return false;
    } finally { setBusy(false); }
  };

  const copy = async (text: string, what: string) => {
    // A failed copy is announced by copyToClipboard; the token also stays selectable below.
    if (await copyToClipboard(text)) showToast(`${what} Copied`, 'success');
  };

  const clearProfileForm = () => { setEditingId(''); setProfileName(''); setProfileId(''); setSelectedProfiles([]); setFeatures(blankFeatures()); };
  const editProfile = (profile: AccessProfile) => {
    setEditingId(profile.id); setProfileName(profile.name); setProfileId(profile.id);
    setSelectedProfiles(profile.generationProfiles); setFeatures({ ...blankFeatures(), ...profile.features });
  };

  const saveProfile = async () => {
    const id = editingId || (profileId || profileName).trim().toLocaleLowerCase('en-AU').replace(/[^a-z0-9:-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id || !profileName.trim()) return;
    if (await run(() => apiJson('/api/accounts/profiles', jsonPost('POST', { id, name: profileName.trim(), generationProfiles: selectedProfiles, features })), 'Could not save the access profile.')) {
      clearProfileForm();
      await refresh();
    }
  };

  const createAccount = async () => {
    if (await run(() => apiJson('/api/accounts/users', jsonPost('POST', { username, displayName, password, accessProfileId: assignedProfile })), 'Could not create the account.')) {
      setUsername(''); setDisplayName(''); setPassword('');
      await refresh();
    }
  };

  const issueToken = async () => {
    if (token?.enabled && !await confirmAction({ title: 'Rotate Your MCP Token?', description: 'Clients using the current token stop connecting until they receive the new one. Existing result links keep working.', action: 'Rotate Token', destructive: true })) return;
    await run(async () => {
      const result = await apiJson<TokenStatus & { token: string }>('/api/accounts/mcp-token', { method: 'POST' });
      setIssuedToken(result.token);
      setToken((current) => ({ endpoint: current?.endpoint || '', enabled: true, createdAt: result.createdAt }));
    }, 'Could not create the MCP token.');
  };

  const revokeToken = async () => {
    if (!await confirmAction({ title: 'Revoke Your MCP Token?', description: 'Clients using it stop connecting. Your jobs, outputs and existing result links are kept.', action: 'Revoke Token', destructive: true })) return;
    await run(async () => {
      const result = await apiJson<TokenStatus>('/api/accounts/mcp-token/revoke', { method: 'POST' });
      setToken((current) => current ? { ...current, ...result } : current);
      setIssuedToken('');
    }, 'Could not revoke the MCP token.');
  };

  const signOut = async () => {
    if (await run(() => apiJson('/api/accounts/sign-out', { method: 'POST' }), 'Could not sign out.')) window.location.reload();
  };

  const patchAccount = async (account: Account, body: Record<string, unknown>) => {
    if (await run(() => apiJson(`/api/accounts/users/${encodeURIComponent(account.id)}`, jsonPost('PATCH', body)), 'Could not update the account.')) await refresh();
  };

  const toggleDisabled = async (account: Account) => {
    if (!account.disabled && !await confirmAction({ title: `Disable ${account.displayName}?`, description: 'Their browser sessions end and their MCP token stops working. Their outputs are kept.', action: 'Disable Account', destructive: true })) return;
    await patchAccount(account, { disabled: !account.disabled });
  };

  const submitPasswordReset = async () => {
    const account = admin?.accounts.find((item) => item.id === resetAccount);
    if (!account || resetPassword.length < 12) return;
    if (!await confirmAction({ title: `Reset ${account.displayName}’s Password?`, description: 'Their browser sessions end. Their MCP token and outputs are kept.', action: 'Reset Password', destructive: true })) return;
    await patchAccount(account, { password: resetPassword });
    setResetPassword('');
  };

  const setGatewayLink = async (identity: string, accountId: string) => {
    const account = admin?.accounts.find((item) => item.id === accountId);
    if (!accountId && !await confirmAction({ title: 'Unlink This Chat User?', description: 'Their chat stops reaching Studio until it is linked again. Their outputs stay with the account.', action: 'Unlink', destructive: true })) return;
    if (await run(() => apiJson('/api/accounts/gateway-links', jsonPost('POST', { identity, ...(accountId ? { accountId } : {}) })), 'Could not update the chat user.')) {
      if (account) showToast(`Linked to ${account.displayName}`, 'success');
      await refresh();
    }
  };

  // Stored grants stay listed while discovery is degraded, marked unavailable.
  const grantable = [...new Set([...(admin?.availableProfiles || []), ...selectedProfiles])];
  const unavailable = new Set(grantable.filter((id) => !admin?.availableProfiles.includes(id)));
  const profileLabel = (id: string) => profileLabels?.[id] || id;
  const profileOptions = (admin?.accessProfiles || []).map((profile) => ({ label: profile.name, value: profile.id }));
  const accountOptions = (list: Account[]) => list.map((account) => ({ label: `${account.displayName} (${account.username})`, value: account.id }));
  const localAccounts = (admin?.accounts || []).filter((account) => account.identity?.provider !== 'pocket-id');

  return <>
    {loadError ? <Group><Row label="Account Settings Unavailable" description={loadError}><button className="btn is-ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Retry</button></Row></Group> : null}
    <Group title="Personal MCP Connection" note="The bearer token belongs to your account and uses its current access profile. It only works for MCP, never for account or studio administration.">
      <Row label="Endpoint" description={token?.endpoint || (loadError ? 'Unavailable until account settings load.' : 'Loading the configured endpoint…')}>
        {token?.endpoint ? <button className="btn is-ghost" onClick={() => void copy(token.endpoint, 'URL')}><Copy size={14} /> Copy URL</button> : null}
      </Row>
      <Row label={token?.enabled ? 'Token Active' : 'No Token Issued'} description={token?.createdAt ? `Created ${new Date(token.createdAt).toLocaleString('en-AU')}` : 'Create a personal token to connect an MCP client.'}>
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void issueToken()}><RefreshCw size={14} /> Rotate</button> : <button className="btn is-primary" disabled={busy || !token} onClick={() => void issueToken()}><KeyRound size={14} /> Create Token</button>}
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void revokeToken()}><X size={14} /> Revoke</button> : null}
      </Row>
      {issuedToken ? <Row stacked label="New Token" description="Shown once. Store it in your MCP client as a bearer credential, separate from the endpoint URL.">
        <input className="modal-input set-path-input" aria-label="New MCP token" readOnly value={issuedToken} onFocus={(event) => event.currentTarget.select()} />
        <button className="btn is-primary" onClick={() => void copy(issuedToken, 'Token')}><Copy size={14} /> Copy Token</button>
      </Row> : null}
    </Group>

    {isAdmin ? <Group title="Access Profiles" note="Ordinary accounts receive one profile. Administrators always retain full access. New generation profiles stay administrator-only until granted here.">
      {admin?.accessProfiles.map((profile) => <Row key={profile.id} label={profile.name} description={`${profile.generationProfiles.length} generation profile${profile.generationProfiles.length === 1 ? '' : 's'} · ${profile.id}`}>
        <button className="btn is-ghost" disabled={busy} aria-label={`Edit ${profile.name}`} onClick={() => editProfile(profile)}><Pencil size={14} /> Edit</button>
      </Row>)}
      <Row label={editingId ? 'Profile Name' : 'New Profile Name'}><input className="modal-input account-field" aria-label="Profile name" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Studio Artists" /></Row>
      {editingId ? <Row label="Profile ID" description={editingId} /> : <Row label="Profile ID" description="Lowercase letters, numbers, colon and hyphen."><input className="modal-input account-field" aria-label="Profile ID" value={profileId} onChange={(event) => setProfileId(event.target.value)} placeholder="studio-artists" /></Row>}
      <fieldset className="account-profile-list"><legend>Generation Profiles</legend>
        {grantable.map((id) => <label key={id}><span>{profileLabel(id)}{unavailable.has(id) ? ' (Unavailable)' : ''}</span><Switch size="sm" label={profileLabel(id)} checked={selectedProfiles.includes(id)} onChange={(next) => setSelectedProfiles((current) => next ? [...current, id] : current.filter((item) => item !== id))} /></label>)}
      </fieldset>
      <fieldset className="account-profile-list"><legend>Features</legend>
        {featureLabels.map(([id, label]) => <label key={id}><span>{label}</span><Switch size="sm" label={label} checked={features[id]} onChange={(next) => setFeatures((current) => ({ ...current, [id]: next }))} /></label>)}
      </fieldset>
      <Row label={editingId ? 'Update Access Profile' : 'Save Access Profile'}>
        {editingId ? <button className="btn is-ghost" disabled={busy} onClick={clearProfileForm}><X size={14} /> Cancel</button> : null}
        <button className="btn is-primary" disabled={busy || !profileName.trim()} onClick={() => void saveProfile()}><Check size={14} /> Save Profile</button>
      </Row>
    </Group> : null}

    {isAdmin ? <Group title="Accounts">
      {admin?.accounts.map((account) => <Row key={account.id} label={account.displayName} description={`${account.username} · ${account.role === 'administrator' ? 'Administrator' : 'User'}${account.pending ? ' · Pending Approval: assign a profile to approve' : ''}${account.signInLinked ? ' · Single Sign-On' : ''}${account.disabled ? ' · Disabled' : ''}`}>
        {account.role === 'user' ? <>
          <div className="set-type-picker"><StudioSelect ariaLabel={`Access profile for ${account.username}`} value={account.accessProfileId || NONE} options={[...choose('Choose a Profile', account.accessProfileId || ''), ...profileOptions]} onChange={(value) => { if (!busy && value !== NONE && value !== account.accessProfileId) void patchAccount(account, { accessProfileId: value }); }} /></div>
          <button className="btn is-ghost" disabled={busy} onClick={() => void toggleDisabled(account)}>{account.disabled ? <><Power size={14} /> Enable</> : <><Ban size={14} /> Disable</>}</button>
        </> : null}
      </Row>)}
      <Row label="Username"><input className="modal-input account-field" aria-label="Username" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="new.artist" /></Row>
      <Row label="Display Name"><input className="modal-input account-field" aria-label="Display name" autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="New Artist" /></Row>
      <Row label="Temporary Password" description="Use at least 12 characters. Share it directly with the account holder."><input className="modal-input account-field" aria-label="Temporary password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></Row>
      <Row label="Access Profile"><div className="set-type-picker"><StudioSelect ariaLabel="Access profile for the new account" value={assignedProfile || NONE} options={[...choose('Choose a Profile', assignedProfile), ...profileOptions]} onChange={(value) => setAssignedProfile(value === NONE ? '' : value)} /></div></Row>
      <Row label="Create Account"><button className="btn is-primary" disabled={busy || !username || password.length < 12 || !assignedProfile} onClick={() => void createAccount()}><UserPlus size={14} /> Create User</button></Row>
    </Group> : null}

    {isAdmin ? <Group title="Chat Gateway Users" note="A trusted chat gateway forwards its own user IDs. Each one reaches Studio only after it is linked to an account here.">
      {(admin?.gateway?.links || []).map((link) => {
        const account = admin?.accounts.find((item) => item.id === link.accountId);
        return <Row key={link.identity} label={link.identity} description={`Linked to ${account ? `${account.displayName} (${account.username})` : 'a removed account'}`}>
          <button className="btn is-ghost" disabled={busy} aria-label={`Unlink ${link.identity}`} onClick={() => void setGatewayLink(link.identity, '')}><Unlink size={14} /> Unlink</button>
        </Row>;
      })}
      {(admin?.gateway?.pending || []).map((item) => <Row key={item.identity} label={item.identity} description={`Waiting since ${new Date(item.firstSeenAt).toLocaleString('en-AU')}`}>
        <div className="set-type-picker"><StudioSelect ariaLabel={`Account for ${item.identity}`} value={gatewayChoice[item.identity] || NONE} options={[...choose('Choose an Account', gatewayChoice[item.identity] || ''), ...accountOptions(admin?.accounts || [])]} onChange={(value) => setGatewayChoice((current) => ({ ...current, [item.identity]: value === NONE ? '' : value }))} /></div>
        <button className="btn is-primary" disabled={busy || !gatewayChoice[item.identity]} onClick={() => void setGatewayLink(item.identity, gatewayChoice[item.identity])}><Link2 size={14} /> Link</button>
      </Row>)}
      {!admin?.gateway?.links.length && !admin?.gateway?.pending.length ? <Row label="No Chat Users Yet" description="Users appear here after their first request through the gateway." /> : null}
    </Group> : null}

    {isAdmin ? <Group title="Reset Password" note="Resetting a password signs that account out of every browser. Its MCP token and outputs are kept.">
      <Row label="Account"><div className="set-type-picker"><StudioSelect ariaLabel="Account to reset" value={resetAccount || NONE} options={[...choose('Choose an Account', resetAccount), ...accountOptions(localAccounts)]} onChange={(value) => setResetAccount(value === NONE ? '' : value)} /></div></Row>
      <Row label="New Password" description="Use at least 12 characters."><input className="modal-input account-field" aria-label="New password" type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="At least 12 characters" /></Row>
      <Row label="Reset Password"><button className="btn is-ghost" disabled={busy || !resetAccount || resetPassword.length < 12} onClick={() => void submitPasswordReset()}><KeyRound size={14} /> Reset Password</button></Row>
    </Group> : null}

    <Group title="Account Session" note="Sign out of this browser before handing it to someone else.">
      <Row label="This Browser"><button className="btn is-ghost" disabled={busy} onClick={() => void signOut()}><LogOut size={14} /> Sign Out</button></Row>
    </Group>
  </>;
}
