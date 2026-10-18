import React from 'react';
import { Copy, LogOut, RefreshCw, UserPlus, X } from 'lucide-react';
import { apiJson } from './api';
import { Group, Row } from './SettingsControls';
import type { ShowToast } from './toast';

type Feature = 'loras' | 'imageGeneration' | 'videoGeneration' | 'imageReferences' | 'videoReferences' | 'gallery' | 'promptHistory';
type AccessProfile = { id: string; name: string; generationProfiles: string[]; features: Record<Feature, boolean> };
type Account = { id: string; username: string; displayName: string; role: 'administrator' | 'user'; accessProfileId?: string; disabled: boolean };
type AdminData = { accessProfiles: AccessProfile[]; availableProfiles: string[]; accounts: Account[] };
type TokenStatus = { enabled: boolean; createdAt: string; endpoint: string };

const featureLabels: [Feature, string][] = [
  ['gallery', 'Gallery'], ['imageGeneration', 'Image Generation'], ['imageReferences', 'Image References'],
  ['loras', 'LoRAs'], ['promptHistory', 'Prompt History'], ['videoGeneration', 'Video Generation'], ['videoReferences', 'Video References']
];
const blankFeatures = () => Object.fromEntries(featureLabels.map(([key]) => [key, false])) as Record<Feature, boolean>;

export function AccountSettings({ showToast, copyToClipboard, isAdmin }: { showToast: ShowToast; copyToClipboard: (text: string) => Promise<boolean>; isAdmin: boolean }) {
  const [admin, setAdmin] = React.useState<AdminData | null>(null);
  const [token, setToken] = React.useState<TokenStatus | null>(null);
  const [issuedToken, setIssuedToken] = React.useState('');
  const [busy, setBusy] = React.useState(true);
  const [profileName, setProfileName] = React.useState('');
  const [profileId, setProfileId] = React.useState('');
  const [selectedProfiles, setSelectedProfiles] = React.useState<string[]>([]);
  const [features, setFeatures] = React.useState<Record<Feature, boolean>>(blankFeatures());
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [assignedProfile, setAssignedProfile] = React.useState('');

  const refresh = React.useCallback(async () => {
    setBusy(true);
    try {
      const tokenResult = await apiJson<TokenStatus>('/api/accounts/mcp-token');
      setToken(tokenResult);
      if (isAdmin) {
        const adminResult = await apiJson<AdminData>('/api/accounts/admin');
        setAdmin(adminResult);
        if (!assignedProfile && adminResult.accessProfiles[0]) setAssignedProfile(adminResult.accessProfiles[0].id);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load account settings.', 'error');
    } finally { setBusy(false); }
  }, [assignedProfile, isAdmin, showToast]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const saveProfile = async () => {
    const id = (profileId || profileName).trim().toLocaleLowerCase('en-AU').replace(/[^a-z0-9:-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id || !profileName.trim()) return;
    setBusy(true);
    try {
      await apiJson('/api/accounts/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name: profileName.trim(), generationProfiles: selectedProfiles, features }) });
      setProfileName(''); setProfileId(''); setSelectedProfiles([]); setFeatures(blankFeatures());
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the access profile.', 'error'); }
    finally { setBusy(false); }
  };

  const createAccount = async () => {
    setBusy(true);
    try {
      await apiJson('/api/accounts/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, displayName, password, accessProfileId: assignedProfile }) });
      setUsername(''); setDisplayName(''); setPassword('');
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not create the account.', 'error'); }
    finally { setBusy(false); }
  };

  const issueToken = async () => {
    setBusy(true);
    try {
      const result = await apiJson<TokenStatus & { token: string }>('/api/accounts/mcp-token', { method: 'POST' });
      setIssuedToken(result.token); setToken((current) => ({ ...current!, enabled: true, createdAt: result.createdAt }));
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not create the MCP token.', 'error'); }
    finally { setBusy(false); }
  };

  const revokeToken = async () => {
    setBusy(true);
    try {
      const result = await apiJson<TokenStatus>('/api/accounts/mcp-token/revoke', { method: 'POST' });
      setToken((current) => current ? { ...current, ...result } : current); setIssuedToken('');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not revoke the MCP token.', 'error'); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await apiJson('/api/accounts/sign-out', { method: 'POST' });
      window.location.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not sign out.', 'error');
      setBusy(false);
    }
  };

  const assign = async (account: Account, accessProfileId: string) => {
    try {
      await apiJson(`/api/accounts/users/${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessProfileId }) });
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not update the account.', 'error'); }
  };

  const setDisabled = async (account: Account, disabled: boolean) => {
    try {
      await apiJson(`/api/accounts/users/${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled }) });
      await refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not update the account.', 'error'); }
  };

  return <>
    <Group title="Personal MCP Connection" note="The bearer token belongs to your account and uses its current access profile.">
      <Row label="Endpoint" description={token?.endpoint || 'Loading the configured endpoint…'}>
        {token?.endpoint ? <button className="btn is-ghost" onClick={() => void copyToClipboard(token.endpoint)}><Copy size={14} /> Copy URL</button> : null}
      </Row>
      <Row label={token?.enabled ? 'Token is active' : 'No token issued'} description={token?.createdAt ? `Created ${new Date(token.createdAt).toLocaleString()}` : 'Create a personal token to connect an MCP client.'}>
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void issueToken()}><RefreshCw size={14} /> Rotate</button> : <button className="btn is-primary" disabled={busy} onClick={() => void issueToken()}>Create Token</button>}
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void revokeToken()}><X size={14} /> Revoke</button> : null}
      </Row>
      {issuedToken ? <Row label="Copy your new token" description="It is shown once. Store it in your MCP client as a bearer credential, separate from the endpoint URL."><button className="btn is-primary" onClick={() => void copyToClipboard(issuedToken)}><Copy size={14} /> Copy Token</button></Row> : null}
    </Group>

    {isAdmin ? <Group title="Access Profiles" note="Ordinary accounts receive one profile. Administrators always retain full access.">
      {admin?.accessProfiles.map((profile) => <Row key={profile.id} label={profile.name} description={`${profile.generationProfiles.length} generation profile${profile.generationProfiles.length === 1 ? '' : 's'} · ${profile.id}`} />)}
      <Row label="Profile Name"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Studio Artists" /></Row>
      <Row label="Profile ID" description="Lowercase letters, numbers, colon and hyphen."><input value={profileId} onChange={(event) => setProfileId(event.target.value)} placeholder="studio-artists" /></Row>
      <fieldset className="account-profile-list"><legend>Generation Profiles</legend>
        {(admin?.availableProfiles || []).map((id) => <label key={id}><input type="checkbox" checked={selectedProfiles.includes(id)} onChange={(event) => setSelectedProfiles((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{id}</label>)}
      </fieldset>
      <fieldset className="account-profile-list"><legend>Features</legend>
        {featureLabels.map(([id, label]) => <label key={id}><input type="checkbox" checked={features[id]} onChange={(event) => setFeatures((current) => ({ ...current, [id]: event.target.checked }))} />{label}</label>)}
      </fieldset>
      <Row label="Save Access Profile"><button className="btn is-primary" disabled={busy || !profileName.trim()} onClick={() => void saveProfile()}>Save Profile</button></Row>
    </Group> : null}

    {isAdmin ? <Group title="Accounts">
      {admin?.accounts.map((account) => <Row key={account.id} label={account.displayName} description={`${account.username} · ${account.role}${account.disabled ? ' · Disabled' : ''}`}>
        {account.role === 'user' ? <>
          <select aria-label={`Access profile for ${account.username}`} value={account.accessProfileId || ''} onChange={(event) => void assign(account, event.target.value)}><option value="" disabled>Choose a profile</option>{admin.accessProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
          <button className="btn is-ghost" onClick={() => void setDisabled(account, !account.disabled)}>{account.disabled ? 'Enable' : 'Disable'}</button>
        </> : null}
      </Row>)}
      <Row label="Username"><input autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="new.artist" /></Row>
      <Row label="Display Name"><input autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="New Artist" /></Row>
      <Row label="Temporary Password" description="Use at least 12 characters. Share it directly with the account holder."><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></Row>
      <Row label="Access Profile"><select value={assignedProfile} onChange={(event) => setAssignedProfile(event.target.value)}><option value="">Choose a profile</option>{admin?.accessProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Row>
      <Row label="Create Account"><button className="btn is-primary" disabled={busy || !username || password.length < 12 || !assignedProfile} onClick={() => void createAccount()}><UserPlus size={14} /> Create User</button></Row>
    </Group> : null}

    <Group title="Account Session" note="Sign out of this browser before handing it to someone else.">
      <Row label="Signed in on this device"><button className="btn is-ghost" disabled={busy} onClick={() => void signOut()}><LogOut size={14} /> Sign Out</button></Row>
    </Group>
  </>;
}
