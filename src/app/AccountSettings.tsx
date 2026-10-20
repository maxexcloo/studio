import React from 'react';
import { Ban, Copy, KeyRound, Link2, LogOut, Power, RefreshCw, Unlink, UserPlus, X } from 'lucide-react';
import { cachedMe, emailFieldProps, knownAccountStatus, loadMe, looksLikeEmail, signOutAccount, updateCachedMe, type McpTokenStatus, type Me, type OwnAccount } from './accounts';
import { apiJson } from './api';
import { Skeleton, StudioSelect } from './components';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';
import { Group, Row, SaveRow } from './SettingsControls';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

type Feature = 'loras' | 'imageGeneration' | 'videoGeneration' | 'imageReferences' | 'videoReferences' | 'gallery' | 'promptHistory';
type AccessProfile = { id: string; name: string; generationProfiles: string[]; features: Record<Feature, boolean> };
type Account = { id: string; username: string; displayName: string; role: 'administrator' | 'user'; accessProfileId?: string; disabled: boolean; identity?: { provider?: string }; pending?: boolean; signInLinked?: boolean };
type GatewayIdentities = { links: { identity: string; accountId: string; linkedAt: string }[]; pending: { identity: string; firstSeenAt: string; lastSeenAt: string }[] };
type AdminData = { accessProfiles: AccessProfile[]; availableProfiles: string[]; accounts: Account[]; gateway?: GatewayIdentities };
export type ProfileInfo = { label: string; kind?: string };

const featureLabels: [Feature, string][] = [
  ['imageGeneration', 'Image Generation'], ['imageReferences', 'Image References'],
  ['videoGeneration', 'Video Generation'], ['videoReferences', 'Video References'],
  ['loras', 'LoRAs'], ['gallery', 'Gallery'], ['promptHistory', 'Prompt History']
];
// A feature that only means something while another one is on.
const featureNeeds: Partial<Record<Feature, { needs: Feature[]; reason: string }>> = {
  imageReferences: { needs: ['imageGeneration'], reason: 'Needs Image Generation' },
  videoReferences: { needs: ['videoGeneration'], reason: 'Needs Video Generation' },
  loras: { needs: ['imageGeneration', 'videoGeneration'], reason: 'Needs Image or Video Generation' }
};
const featureApplies = (feature: Feature, on: Set<Feature>) => !featureNeeds[feature] || featureNeeds[feature]!.needs.some((need) => on.has(need));
const jsonPost = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const NEW = '__new__';
const NONE = '__none__';
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));
const profileIdFrom = (name: string) => name.trim().toLocaleLowerCase('en-AU').replace(/[^a-z0-9:-]+/g, '-').replace(/^-+|-+$/g, '');

// Settings loads this module when its button is hovered or focused, so the account is on its way before Settings opens.
if (typeof window !== 'undefined' && knownAccountStatus()?.signedIn && !cachedMe()) void loadMe().catch(() => undefined);

/** Settings › Account: who you are, your password, your MCP connection and this browser's session. */
export function AccountSettings({ showToast, copyToClipboard, confirmAction }: { showToast: ShowToast; copyToClipboard: (text: string) => Promise<boolean>; confirmAction: ConfirmAction }) {
  // Drawn at once from what the sign-in gate and the last visit knew; a fresh copy fills in behind.
  const [me, setMe] = React.useState<Me | null>(cachedMe());
  const [loadError, setLoadError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [issuedToken, setIssuedToken] = React.useState('');
  const refresh = React.useCallback(async () => {
    try { setMe(await loadMe(true)); setLoadError(''); }
    catch (error) { setLoadError(message(error, 'Couldn’t load your account')); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const setToken = (mcp: McpTokenStatus) => setMe((current) => {
    const next = current ? { ...current, mcp } : current;
    if (next) updateCachedMe({ mcp });
    return next;
  });

  const run = async (action: () => Promise<unknown>, failure: string) => {
    if (busy) return false;
    setBusy(true);
    try { await action(); return true; }
    catch (error) { showToast(message(error, failure), 'error'); return false; }
    finally { setBusy(false); }
  };
  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) showToast(`${what} copied`, 'success');
  };
  const issueToken = async () => {
    if (me?.mcp.enabled && !await confirmAction({ title: 'Rotate Your MCP Token?', description: 'Clients using the current token stop connecting until they receive the new one. Existing result links keep working.', action: 'Rotate Token', destructive: true })) return;
    await run(async () => {
      const result = await apiJson<McpTokenStatus & { token: string }>('/api/accounts/mcp-token', { method: 'POST' });
      setIssuedToken(result.token);
      setToken({ endpoint: me?.mcp.endpoint || '', enabled: true, createdAt: result.createdAt });
    }, 'Couldn’t create the MCP token');
  };
  const revokeToken = async () => {
    if (!await confirmAction({ title: 'Revoke Your MCP Token?', description: 'Clients using it stop connecting. Your jobs, outputs and existing result links are kept.', action: 'Revoke Token', destructive: true })) return;
    await run(async () => {
      const result = await apiJson<McpTokenStatus>('/api/accounts/mcp-token/revoke', { method: 'POST' });
      setToken({ ...(me?.mcp || { endpoint: '' }), ...result });
      setIssuedToken('');
    }, 'Couldn’t revoke the MCP token');
  };

  const account = me?.account || null;
  const token = me?.mcp || null;
  return <div className="set-sections" data-account-ready={me ? '' : undefined}>
    {loadError && !me ? <Group><Row label="Account Unavailable" description={loadError}><button className="btn is-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Try Again</button></Row></Group> : null}
    <ProfileGroup account={account} showToast={showToast} onSaved={(next) => { setMe((current) => current ? { ...current, account: next } : current); updateCachedMe({ account: next }); }} />
    <PasswordGroup account={account} showToast={showToast} />
    <Group title="Personal MCP Connection" note="The token belongs to your account and uses its current access. It only works for MCP, never for account or Studio administration.">
      <Row label="Endpoint" description={token?.endpoint || <Skeleton className="skeleton-text path" />}>
        {token?.endpoint ? <button className="btn is-ghost" onClick={() => void copy(token.endpoint, 'URL')}><Copy size={14} /> Copy URL</button> : null}
      </Row>
      <Row label={token ? (token.enabled ? 'Token Active' : 'No Token Issued') : 'Token'} description={token ? (token.createdAt ? `Created ${new Date(token.createdAt).toLocaleString('en-AU')}` : 'Create a personal token to connect an MCP client.') : <Skeleton className="skeleton-text short" />}>
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void issueToken()}><RefreshCw size={14} /> Rotate</button> : <button className="btn is-primary" disabled={busy || !token} onClick={() => void issueToken()}><KeyRound size={14} /> Create Token</button>}
        {token?.enabled ? <button className="btn is-ghost" disabled={busy} onClick={() => void revokeToken()}><X size={14} /> Revoke</button> : null}
      </Row>
      {issuedToken ? <Row stacked label="New Token" description="Shown once. Store it in your MCP client as a bearer credential, separate from the endpoint URL.">
        <input className="modal-input set-path-input" aria-label="New MCP Token" readOnly value={issuedToken} onFocus={(event) => event.currentTarget.select()} />
        <button className="btn is-primary" onClick={() => void copy(issuedToken, 'Token')}><Copy size={14} /> Copy Token</button>
      </Row> : null}
    </Group>
    <Group title="Session" note="Sign out of this browser before handing it to someone else.">
      <Row label="This Browser"><button className="btn is-ghost" disabled={busy} onClick={() => void run(signOutAccount, 'Couldn’t sign out')}><LogOut size={14} /> Sign Out</button></Row>
    </Group>
  </div>;
}

function accessWords(account: OwnAccount) {
  if (account.role === 'administrator') return 'Administrator · full access';
  return `User · ${account.accessProfile?.name || 'no access profile yet'}`;
}

/** Display name and email, saved together; a new email asks for the current password. */
function ProfileGroup({ account, showToast, onSaved }: { account: OwnAccount | null; showToast: ShowToast; onSaved: (account: OwnAccount) => void }) {
  const [name, setName] = React.useState(account?.displayName || '');
  const [email, setEmail] = React.useState(account?.username || '');
  const [current, setCurrent] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { if (account) { setName(account.displayName); setEmail(account.username); } }, [account?.displayName, account?.username]); // eslint-disable-line react-hooks/exhaustive-deps
  const emailChanged = Boolean(account) && email.trim().toLocaleLowerCase('en-AU') !== account!.username.toLocaleLowerCase('en-AU');
  const dirty = Boolean(account) && (name.trim() !== account!.displayName || emailChanged);
  const discard = () => { if (!account) return; setName(account.displayName); setEmail(account.username); setCurrent(''); setError(''); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const result = await apiJson<{ account: OwnAccount }>('/api/accounts/me', jsonPost('PATCH', { displayName: name, ...(emailChanged ? { username: email.trim(), currentPassword: current } : {}) }));
      onSaved(result.account);
      setCurrent('');
      showToast('Account saved', 'success');
    } catch (reason) { setError(message(reason, 'Couldn’t save your account')); }
    finally { setBusy(false); }
  };
  const emailInvalid = emailChanged && !looksLikeEmail(email);
  return <Group title="Profile">
    <Row label="Display Name" description="How Studio names you to administrators.">
      {account ? <input className="modal-input account-field" aria-label="Display Name" autoComplete="name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /> : <Skeleton className="skeleton-text short" />}
    </Row>
    <Row label="Email" description={!account ? undefined : !account.canChangeEmail ? 'Managed by your single sign-on provider.' : emailInvalid ? 'Enter an email address. It is how you sign in.' : 'How you sign in.'}>
      {account ? account.canChangeEmail
        ? <input className="modal-input account-field" aria-label="Email" autoComplete="username" {...emailFieldProps} value={email} onChange={(event) => setEmail(event.target.value)} />
        : <span className="set-locked-value">{account.username}</span>
        : <Skeleton className="skeleton-text short" />}
    </Row>
    {emailChanged ? <Row label="Current Password" description="Needed to change the email you sign in with.">
      <input className="modal-input account-field" aria-label="Current Password for Email" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
    </Row> : null}
    <Row label="Access" description={account ? accessWords(account) : <Skeleton className="skeleton-text short" />} />
    <SaveRow dirty={dirty} busy={busy} onSave={() => void save()} onDiscard={discard} canSave={Boolean(name.trim()) && !emailInvalid && (!emailChanged || Boolean(current))} note={error || undefined} />
  </Group>;
}

/** A new password for a local account; other browsers sign out, this one stays. */
function PasswordGroup({ account, showToast }: { account: OwnAccount | null; showToast: ShowToast }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  if (account && !account.canChangePassword) {
    return <Group title="Password"><Row label="Single Sign-On" description={account.provider === 'pocket-id' ? 'You sign in through your single sign-on provider; change your password there.' : 'This account has no Studio password.'} /></Group>;
  }
  const mismatch = Boolean(again) && again !== next;
  const short = Boolean(next) && next.length < 8;
  const discard = () => { setCurrent(''); setNext(''); setAgain(''); setError(''); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiJson('/api/accounts/me', jsonPost('PATCH', { currentPassword: current, newPassword: next }));
      discard();
      showToast('Password changed · other browsers signed out', 'success');
    } catch (reason) { setError(message(reason, 'Couldn’t change your password')); }
    finally { setBusy(false); }
  };
  return <Group title="Password" note="Changing it signs you out of every other browser. Your MCP token keeps working.">
    <Row label="Current Password"><input className="modal-input account-field" aria-label="Current Password" type="password" autoComplete="current-password" disabled={!account} value={current} onChange={(event) => setCurrent(event.target.value)} /></Row>
    <Row label="New Password" description={short ? 'Use at least 8 characters.' : undefined}><input className="modal-input account-field" aria-label="New Password" type="password" autoComplete="new-password" disabled={!account} value={next} onChange={(event) => setNext(event.target.value)} /></Row>
    <Row label="Confirm New Password" description={mismatch ? 'The two new passwords differ.' : undefined}><input className="modal-input account-field" aria-label="Confirm New Password" type="password" autoComplete="new-password" disabled={!account} value={again} onChange={(event) => setAgain(event.target.value)} /></Row>
    <SaveRow dirty={Boolean(current || next || again)} busy={busy} saveLabel="Change Password" onSave={() => void save()} onDiscard={discard} canSave={Boolean(current) && next.length >= 8 && next === again} note={error || undefined} />
  </Group>;
}

/** Settings › Users (administrators): access profiles, accounts and chat gateway users. */
export function UsersSettings({ showToast, confirmAction, profiles }: { showToast: ShowToast; confirmAction: ConfirmAction; profiles?: Record<string, ProfileInfo> }) {
  const [admin, setAdmin] = React.useState<AdminData | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [gatewayChoice, setGatewayChoice] = React.useState<Record<string, string>>({});
  const refresh = React.useCallback(async () => {
    try { setAdmin(await apiJson<AdminData>('/api/accounts/admin')); setLoadError(''); }
    catch (error) { setLoadError(message(error, 'Couldn’t load users')); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const run = async (action: () => Promise<unknown>, failure: string) => {
    if (busy) return false;
    setBusy(true);
    try { await action(); return true; }
    catch (error) { showToast(message(error, failure), 'error'); return false; }
    finally { setBusy(false); }
  };
  const setGatewayLink = async (identity: string, accountId: string) => {
    const account = admin?.accounts.find((item) => item.id === accountId);
    if (!accountId && !await confirmAction({ title: 'Unlink This Chat User?', description: 'Their chat stops reaching Studio until it is linked again, which happens automatically if the gateway forwards an email matching an enabled account. Their outputs stay with the account.', action: 'Unlink', destructive: true })) return;
    if (await run(() => apiJson('/api/accounts/gateway-links', jsonPost('POST', { identity, ...(accountId ? { accountId } : {}) })), 'Couldn’t update the chat user')) {
      if (account) showToast(`Linked to ${account.displayName}`, 'success');
      await refresh();
    }
  };
  const dismissGatewayIdentity = async (identity: string) => {
    if (!await confirmAction({ title: 'Dismiss This Chat User?', description: 'They leave this list. If the gateway sends them again, they return here waiting to be linked.', action: 'Dismiss Chat User', destructive: true })) return;
    if (await run(() => apiJson('/api/accounts/gateway-pending/dismiss', jsonPost('POST', { identity })), 'Couldn’t dismiss the chat user')) await refresh();
  };
  const accountOptions = (list: Account[]) => list.map((account) => ({ label: `${account.displayName} (${account.username})`, value: account.id }));

  if (!admin) return loadError
    ? <Group><Row label="Users Unavailable" description={loadError}><button className="btn is-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Try Again</button></Row></Group>
    : <Group title="Access Profiles"><Row label={<Skeleton className="skeleton-text short" />} /></Group>;

  return <div className="set-sections">
    <AccessProfileEditor admin={admin} profiles={profiles} showToast={showToast} onSaved={refresh} />
    <AccountEditor admin={admin} showToast={showToast} confirmAction={confirmAction} onSaved={refresh} />
    <Group title="Chat Gateway Users" note="A trusted chat gateway forwards its own user IDs. Each one reaches Studio only once it is linked to an account, here or automatically when the gateway forwards an enabled account's email.">
      {(admin.gateway?.links || []).map((link) => {
        const account = admin.accounts.find((item) => item.id === link.accountId);
        return <Row key={link.identity} label={link.identity} description={`Linked to ${account ? `${account.displayName} (${account.username})` : 'a removed account'}`}>
          <button className="btn is-ghost" disabled={busy} aria-label={`Unlink ${link.identity}`} onClick={() => void setGatewayLink(link.identity, '')}><Unlink size={14} /> Unlink</button>
        </Row>;
      })}
      {(admin.gateway?.pending || []).map((item) => <Row key={item.identity} label={item.identity} description={`Waiting since ${new Date(item.firstSeenAt).toLocaleString('en-AU')}`}>
        <div className="set-type-picker"><StudioSelect ariaLabel={`Account for ${item.identity}`} value={gatewayChoice[item.identity] || NONE} options={[...(gatewayChoice[item.identity] ? [] : [{ label: 'Choose an Account', value: NONE }]), ...accountOptions(admin.accounts)]} onChange={(value) => setGatewayChoice((current) => ({ ...current, [item.identity]: value === NONE ? '' : value }))} /></div>
        <button className="btn is-primary" disabled={busy || !gatewayChoice[item.identity]} onClick={() => void setGatewayLink(item.identity, gatewayChoice[item.identity])}><Link2 size={14} /> Link</button>
        <button className="btn is-ghost" disabled={busy} aria-label={`Dismiss ${item.identity}`} onClick={() => void dismissGatewayIdentity(item.identity)}><X size={14} /> Dismiss</button>
      </Row>)}
      {!admin.gateway?.links.length && !admin.gateway?.pending.length ? <Row label="No Chat Users Yet" description="Users appear here after their first request through the gateway." /> : null}
    </Group>
  </div>;
}

/** One access profile at a time, picked from a list with New, edited with multi-selects and saved or discarded. */
function AccessProfileEditor({ admin, profiles, showToast, onSaved }: { admin: AdminData; profiles?: Record<string, ProfileInfo>; showToast: ShowToast; onSaved: () => Promise<void> }) {
  const [choice, setChoice] = React.useState(admin.accessProfiles[0]?.id || NEW);
  const saved = admin.accessProfiles.find((profile) => profile.id === choice) || null;
  const blank = { name: '', id: '', models: [] as string[], features: ['imageGeneration', 'imageReferences', 'gallery', 'promptHistory'] as Feature[] };
  const fromSaved = (profile: AccessProfile | null) => profile ? { name: profile.name, id: profile.id, models: profile.generationProfiles, features: featureLabels.map(([key]) => key).filter((key) => profile.features?.[key]) } : blank;
  const [draft, setDraft] = React.useState(() => fromSaved(saved));
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setDraft(fromSaved(saved)); }, [choice, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = fromSaved(saved);
  const dirty = choice === NEW ? Boolean(draft.name.trim() || draft.models.length) : draft.name !== base.name || !sameSet(draft.models, base.models) || !sameSet(draft.features, base.features);
  const on = new Set(draft.features);
  // Stored grants stay listed while discovery is degraded, marked unavailable.
  const grantable = [...new Set([...admin.availableProfiles, ...draft.models])];
  const kindOn = (kind?: string) => kind === 'video' ? on.has('videoGeneration') : on.has('imageGeneration');
  const modelOptions: MultiSelectOption[] = grantable.map((id) => {
    const info = profiles?.[id];
    const unavailable = !admin.availableProfiles.includes(id);
    const off = !kindOn(info?.kind);
    return { value: id, label: info?.label || id, detail: unavailable ? 'Unavailable' : info?.kind === 'video' ? 'Video' : 'Image', disabled: off && !draft.models.includes(id), reason: off ? `Turn on ${info?.kind === 'video' ? 'Video' : 'Image'} Generation first` : undefined };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const featureOptions: MultiSelectOption[] = featureLabels.map(([key, label]) => ({ value: key, label, disabled: !featureApplies(key, on) && !on.has(key), reason: featureNeeds[key]?.reason }));
  const setFeatures = (values: string[]) => {
    // A feature whose prerequisite went off goes with it.
    const next = new Set(values as Feature[]);
    for (const [key] of featureLabels) if (next.has(key) && !featureApplies(key, next)) next.delete(key);
    setDraft((current) => ({ ...current, features: featureLabels.map(([key]) => key).filter((key) => next.has(key)) }));
  };
  const save = async () => {
    const id = choice === NEW ? (draft.id.trim() || profileIdFrom(draft.name)) : choice;
    if (!id || !draft.name.trim()) return;
    setBusy(true);
    try {
      const usable = draft.models.filter((model) => kindOn(profiles?.[model]?.kind) || !admin.availableProfiles.includes(model));
      await apiJson('/api/accounts/profiles', jsonPost('POST', { id, name: draft.name.trim(), generationProfiles: usable, features: Object.fromEntries(featureLabels.map(([key]) => [key, on.has(key)])) }));
      showToast(`${draft.name.trim()} saved`, 'success');
      await onSaved();
      setChoice(id);
    } catch (error) { showToast(message(error, 'Couldn’t save the access profile'), 'error'); }
    finally { setBusy(false); }
  };
  const options = [...admin.accessProfiles.map((profile) => ({ label: profile.name, value: profile.id })), { label: 'New Access Profile', value: NEW }];
  const offModels = draft.models.filter((model) => admin.availableProfiles.includes(model) && !kindOn(profiles?.[model]?.kind)).length;
  return <Group title="Access Profiles" note="Each ordinary account gets one access profile. Administrators always have full access, and new models stay administrator-only until granted here.">
    <Row label="Access Profile" description={saved ? `${saved.generationProfiles.length} model${saved.generationProfiles.length === 1 ? '' : 's'} · ${admin.accounts.filter((account) => account.accessProfileId === saved.id).length} account${admin.accounts.filter((account) => account.accessProfileId === saved.id).length === 1 ? '' : 's'}` : 'A new access profile.'}>
      <div className="set-type-picker"><StudioSelect ariaLabel="Access Profile to Edit" value={choice} options={options} onChange={(value) => { if (!dirty || value === choice) setChoice(value); else showToast('Save or discard the changes first', 'error'); }} /></div>
    </Row>
    <Row label="Name"><input className="modal-input account-field" aria-label="Profile Name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Studio Artists" /></Row>
    {choice === NEW ? <Row label="Profile ID" description="Lowercase letters, numbers, colon and hyphen. Taken from the name when empty."><input className="modal-input account-field" aria-label="Profile ID" value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} placeholder={profileIdFrom(draft.name) || 'studio-artists'} /></Row> : <Row label="Profile ID" description={choice} />}
    <Row label="Features" description="What accounts with this profile can use.">
      <MultiSelect label="Features" values={draft.features} options={featureOptions} onChange={setFeatures} />
    </Row>
    <Row label="Models" description={offModels ? `${offModels} picked model${offModels === 1 ? '' : 's'} won’t be granted while ${offModels === 1 ? 'its' : 'their'} generation is off.` : 'The models these accounts may generate with.'} disabled={!on.has('imageGeneration') && !on.has('videoGeneration')}>
      <MultiSelect label="Models" values={draft.models} options={modelOptions} disabled={!on.has('imageGeneration') && !on.has('videoGeneration')} onChange={(values) => setDraft((current) => ({ ...current, models: values }))} />
    </Row>
    <SaveRow dirty={dirty} busy={busy} saveLabel={choice === NEW ? 'Create Profile' : 'Save Profile'} canSave={Boolean(draft.name.trim())} onSave={() => void save()} onDiscard={() => { setDraft(fromSaved(saved)); if (choice === NEW && admin.accessProfiles[0]) setChoice(admin.accessProfiles[0].id); }} />
  </Group>;
}

/** One account at a time: its access profile, whether it is enabled and its password; or a new account. */
function AccountEditor({ admin, showToast, confirmAction, onSaved }: { admin: AdminData; showToast: ShowToast; confirmAction: ConfirmAction; onSaved: () => Promise<void> }) {
  const firstPending = admin.accounts.find((account) => account.pending)?.id;
  const [choice, setChoice] = React.useState(firstPending || admin.accounts.find((account) => account.role === 'user')?.id || admin.accounts[0]?.id || NEW);
  const account = admin.accounts.find((item) => item.id === choice) || null;
  const [profileId, setProfileId] = React.useState(account?.accessProfileId || '');
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setProfileId(account?.accessProfileId || (choice === NEW ? admin.accessProfiles[0]?.id || '' : '')); setPassword(''); setUsername(''); setDisplayName(''); }, [choice, account?.accessProfileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const isNew = choice === NEW;
  const isAdmin = account?.role === 'administrator';
  const sso = account?.identity?.provider === 'pocket-id';
  const dirty = isNew ? Boolean(username || displayName || password) : Boolean(password) || (!isAdmin && profileId !== (account?.accessProfileId || ''));
  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try { await action(); await onSaved(); return true; }
    catch (error) { showToast(message(error, failure), 'error'); return false; }
    finally { setBusy(false); }
  };
  const patch = (body: Record<string, unknown>) => apiJson(`/api/accounts/users/${encodeURIComponent(account!.id)}`, jsonPost('PATCH', body));
  const save = async () => {
    if (isNew) {
      if (await run(() => apiJson('/api/accounts/users', jsonPost('POST', { username: username.trim(), displayName, password, accessProfileId: profileId })), 'Couldn’t create the account')) {
        showToast(`${displayName || username.trim()} created`, 'success');
        setUsername(''); setDisplayName(''); setPassword('');
      }
      return;
    }
    if (!account) return;
    if (password && !await confirmAction({ title: `Reset ${account.displayName}’s Password?`, description: 'Their browser sessions end. Their MCP token and outputs are kept.', action: 'Reset Password', destructive: true })) return;
    await run(async () => {
      if (!isAdmin && profileId && profileId !== account.accessProfileId) await patch({ accessProfileId: profileId });
      if (password) await patch({ password });
      setPassword('');
      showToast(`${account.displayName} saved`, 'success');
    }, 'Couldn’t update the account');
  };
  const toggleDisabled = async () => {
    if (!account) return;
    if (!account.disabled && !await confirmAction({ title: `Disable ${account.displayName}?`, description: 'Their browser sessions end and their MCP token stops working. Their outputs are kept.', action: 'Disable Account', destructive: true })) return;
    await run(() => patch({ disabled: !account.disabled }), 'Couldn’t update the account');
  };
  const label = (item: Account) => `${item.displayName} (${item.username})${item.pending ? ' · Pending' : item.disabled ? ' · Disabled' : ''}`;
  const profileOptions = [...(profileId ? [] : [{ label: 'Choose a Profile', value: NONE }]), ...admin.accessProfiles.map((profile) => ({ label: profile.name, value: profile.id }))];
  const pending = admin.accounts.filter((item) => item.pending).length;
  return <Group title="Accounts" note={pending ? `${pending} sign-in${pending === 1 ? '' : 's'} waiting: assign an access profile to approve.` : 'Accounts are never deleted, only disabled, so their outputs stay.'}>
    <Row label="Account" description={account ? `${isAdmin ? 'Administrator' : 'User'}${account.signInLinked ? ' · single sign-on' : ''}${account.pending ? ' · waiting for approval' : ''}${account.disabled ? ' · disabled' : ''}` : 'A new local account.'}>
      <div className="set-type-picker"><StudioSelect ariaLabel="Account to Edit" value={choice} options={[...admin.accounts.map((item) => ({ label: label(item), value: item.id })), { label: 'New Account', value: NEW }]} onChange={(value) => { if (!dirty || value === choice) setChoice(value); else showToast('Save or discard the changes first', 'error'); }} /></div>
    </Row>
    {isNew ? <>
      <Row label="Email" description={username.trim() && !looksLikeEmail(username) ? 'Enter an email address. It is the account’s sign-in name.' : 'The account’s sign-in name.'}><input className="modal-input account-field" aria-label="Email" autoComplete="off" {...emailFieldProps} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="artist@example.com" /></Row>
      <Row label="Display Name"><input className="modal-input account-field" aria-label="Display Name" autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="New Artist" /></Row>
    </> : null}
    <Row label="Access Profile" description={isAdmin ? 'Administrators always have full access.' : undefined} disabled={isAdmin}>
      <div className="set-type-picker">{isAdmin ? <span className="set-locked-value">Full Access</span> : <StudioSelect ariaLabel={isNew ? 'Access Profile for the New Account' : `Access Profile for ${account?.username}`} value={profileId || NONE} options={profileOptions} onChange={(value) => setProfileId(value === NONE ? '' : value)} />}</div>
    </Row>
    <Row label={isNew ? 'Temporary Password' : 'New Password'} description={sso ? 'Signs in through single sign-on, so there is no Studio password to reset.' : isNew ? 'Share it directly with the account holder.' : 'Resetting it signs the account out of every browser.'} disabled={sso}>
      <input className="modal-input account-field" aria-label={isNew ? 'Temporary Password' : 'New Password'} type="password" autoComplete="new-password" disabled={sso} value={password} onChange={(event) => setPassword(event.target.value)} />
    </Row>
    {!isNew && account ? <Row label="Status" description={account.disabled ? 'Disabled: no sign-in and no MCP.' : isAdmin ? 'Enabled. Studio keeps at least one administrator enabled.' : 'Enabled.'}>
      <button className="btn is-ghost" disabled={busy} onClick={() => void toggleDisabled()}>{account.disabled ? <><Power size={14} /> Enable</> : <><Ban size={14} /> Disable</>}</button>
    </Row> : null}
    <SaveRow dirty={dirty} busy={busy} saveLabel={isNew ? 'Create Account' : 'Save Account'} canSave={isNew ? looksLikeEmail(username) && Boolean(password) && Boolean(profileId) : true} onSave={() => void save()} onDiscard={() => { setProfileId(account?.accessProfileId || ''); setPassword(''); setUsername(''); setDisplayName(''); }} note={isNew ? <><UserPlus size={12} aria-hidden="true" /> Creates a local account.</> : undefined} />
  </Group>;
}
