import React from 'react';
import { Ban, Copy, FileJson, KeyRound, Link2, Power, RefreshCw, Unlink, UserPlus, X } from 'lucide-react';
import { cachedMe, emailFieldProps, knownAccountStatus, loadMe, looksLikeEmail, updateCachedMe, type McpTokenStatus, type Me, type OwnAccount } from './accounts';
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
    <Group title="MCP" note="The token belongs to your account and uses its current access. It only works for MCP, never for account or Studio administration.">
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
  </div>;
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
    <SaveRow dirty={dirty} busy={busy} onSave={() => void save()} onDiscard={discard} canSave={Boolean(name.trim()) && !emailInvalid && (!emailChanged || Boolean(current))} note={error || undefined} />
    <PasswordRows account={account} showToast={showToast} />
  </Group>;
}

/** Password, inside Profile: a Change button opens the fields in place; other browsers sign out, this one stays. */
function PasswordRows({ account, showToast }: { account: OwnAccount | null; showToast: ShowToast }) {
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  if (account && !account.canChangePassword) {
    return <Row label="Password" description={account.provider === 'pocket-id' ? 'You sign in through single sign-on; change your password there.' : 'This account has no Studio password. An administrator can link single sign-on.'} />;
  }
  const mismatch = Boolean(again) && again !== next;
  const short = Boolean(next) && next.length < 8;
  const discard = () => { setCurrent(''); setNext(''); setAgain(''); setError(''); setOpen(false); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiJson('/api/accounts/me', jsonPost('PATCH', { currentPassword: current, newPassword: next }));
      discard();
      showToast('Password changed · other browsers signed out', 'success');
    } catch (reason) { setError(message(reason, 'Couldn’t change your password')); }
    finally { setBusy(false); }
  };
  if (!open) return <Row label="Password" description="Changing it signs you out of every other browser. Your MCP token keeps working.">
    <button className="btn is-ghost" disabled={!account} onClick={() => setOpen(true)}><KeyRound size={14} /> Change</button>
  </Row>;
  return <>
    <Row label="Current Password"><input className="modal-input account-field" aria-label="Current Password" type="password" autoComplete="current-password" autoFocus value={current} onChange={(event) => setCurrent(event.target.value)} /></Row>
    <Row label="New Password" description={short ? 'Use at least 8 characters.' : undefined}><input className="modal-input account-field" aria-label="New Password" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></Row>
    <Row label="Confirm New Password" description={mismatch ? 'The two new passwords differ.' : undefined}><input className="modal-input account-field" aria-label="Confirm New Password" type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} /></Row>
    <SaveRow dirty busy={busy} saveLabel="Change Password" onSave={() => void save()} onDiscard={discard} canSave={Boolean(current) && next.length >= 8 && next === again} note={error || 'Other browsers sign out; this one stays.'} />
  </>;
}

/** Settings › Users (administrators): access profiles, accounts and chat gateway users. */
export function UsersSettings({ showToast, confirmAction, profiles, onOpenProfiles }: { showToast: ShowToast; confirmAction: ConfirmAction; profiles?: Record<string, ProfileInfo>; onOpenProfiles: () => void }) {
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
    : <Group title="Accounts"><Row label={<Skeleton className="skeleton-text short" />} /></Group>;

  return <div className="set-sections">
    <AccountsGroup admin={admin} showToast={showToast} confirmAction={confirmAction} onSaved={refresh} />
    <AccessProfileEditor admin={admin} profiles={profiles} showToast={showToast} onSaved={refresh} />
    <Group title="Chat Gateway" note="A trusted chat gateway forwards its own user IDs. Each one reaches Studio only once it is linked to an account, here or automatically when the gateway forwards an enabled account's email.">
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
    <Group title="Profiles" note="Model profiles arrive from the profiles repository. An edited copy stops receiving its updates until the edit is committed there.">
      <Row label="Profile JSON" description="Edit one model profile’s JSON, checked and reviewed before it is saved, including its starting values such as steps and frames.">
        <button className="btn is-ghost" onClick={onOpenProfiles}><FileJson size={14} /> Edit Profiles</button>
      </Row>
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

/** Every account in one list, each with its access profile and Enable or Disable; New Account opens its form in place. */
function AccountsGroup({ admin, showToast, confirmAction, onSaved }: { admin: AdminData; showToast: ShowToast; confirmAction: ConfirmAction; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [profileId, setProfileId] = React.useState(admin.accessProfiles[0]?.id || '');
  const run = async (key: string, action: () => Promise<unknown>, failure: string) => {
    setBusy(key);
    try { await action(); await onSaved(); return true; }
    catch (error) { showToast(message(error, failure), 'error'); return false; }
    finally { setBusy(''); }
  };
  const patch = (account: Account, body: Record<string, unknown>) => apiJson(`/api/accounts/users/${encodeURIComponent(account.id)}`, jsonPost('PATCH', body));
  const assign = async (account: Account, value: string) => {
    if (value === NONE || value === account.accessProfileId) return;
    if (await run(account.id, () => patch(account, { accessProfileId: value }), 'Couldn’t update the account')) showToast(account.pending ? `${account.displayName} approved` : `${account.displayName} updated`, 'success');
  };
  const toggleDisabled = async (account: Account) => {
    if (!account.disabled && !await confirmAction({ title: `Disable ${account.displayName}?`, description: 'Their browser sessions end and their MCP token stops working. Their outputs are kept.', action: 'Disable Account', destructive: true })) return;
    await run(account.id, () => patch(account, { disabled: !account.disabled }), 'Couldn’t update the account');
  };
  const reset = () => { setUsername(''); setDisplayName(''); setPassword(''); setCreating(false); };
  const create = async () => {
    if (await run('new', () => apiJson('/api/accounts/users', jsonPost('POST', { username: username.trim(), displayName, ...(password ? { password } : {}), accessProfileId: profileId })), 'Couldn’t create the account')) {
      showToast(`${displayName || username.trim()} created`, 'success');
      reset();
    }
  };
  const profileOptions = (current: string) => [...(current ? [] : [{ label: 'Choose a Profile', value: NONE }]), ...admin.accessProfiles.map((profile) => ({ label: profile.name, value: profile.id }))];
  const pending = admin.accounts.filter((item) => item.pending).length;
  return <Group title="Accounts" note={pending ? `${pending} sign-in${pending === 1 ? '' : 's'} waiting: choose an access profile to approve.` : 'Accounts are never deleted, only disabled, so their outputs stay.'}>
    {admin.accounts.map((account) => {
      const isAdmin = account.role === 'administrator';
      return <Row key={account.id} label={account.displayName} description={`${account.username} · ${isAdmin ? 'Administrator' : 'User'}${account.signInLinked ? ' · single sign-on' : ''}${account.pending ? ' · waiting for approval' : ''}${account.disabled ? ' · disabled' : ''}`} disabled={account.disabled}>
        {isAdmin ? <span className="set-locked-value">Full Access</span> : <div className="set-type-picker"><StudioSelect ariaLabel={`Access Profile for ${account.username}`} value={account.accessProfileId || NONE} options={profileOptions(account.accessProfileId || '')} onChange={(value) => void assign(account, value)} /></div>}
        <button className="btn is-ghost" disabled={Boolean(busy)} onClick={() => void toggleDisabled(account)}>{account.disabled ? <><Power size={14} /> Enable</> : <><Ban size={14} /> Disable</>}</button>
      </Row>;
    })}
    {creating ? <>
      <Row label="Email" description={username.trim() && !looksLikeEmail(username) ? 'Enter an email address. It is the account’s sign-in name.' : 'The sign-in name; single sign-on links to it.'}><input className="modal-input account-field" aria-label="Email" autoComplete="off" autoFocus {...emailFieldProps} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="artist@example.com" /></Row>
      <Row label="Display Name"><input className="modal-input account-field" aria-label="Display Name" autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="New Artist" /></Row>
      <Row label="Temporary Password" description="Optional. Without one the account signs in through single sign-on only."><input className="modal-input account-field" aria-label="Temporary Password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Row>
      <Row label="Access Profile"><div className="set-type-picker"><StudioSelect ariaLabel="Access Profile for the New Account" value={profileId || NONE} options={profileOptions(profileId)} onChange={(value) => setProfileId(value === NONE ? '' : value)} /></div></Row>
      <SaveRow dirty busy={busy === 'new'} saveLabel="Create Account" canSave={looksLikeEmail(username) && Boolean(profileId)} onSave={() => void create()} onDiscard={reset} />
    </> : <Row label="New Account" description="A local account with an access profile.">
      <button className="btn is-ghost" onClick={() => setCreating(true)}><UserPlus size={14} /> New Account</button>
    </Row>}
  </Group>;
}
