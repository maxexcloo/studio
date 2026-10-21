import React from 'react';
import { Ban, Check, Copy, KeyRound, Link2, Power, RefreshCw, Unlink, UserPlus, X } from 'lucide-react';
import { cachedMe, emailFieldProps, knownAccountStatus, loadMe, looksLikeEmail, updateCachedMe, type McpTokenStatus, type Me, type OwnAccount } from './accounts';
import { apiJson } from './api';
import { Skeleton, StudioSelect } from './components';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';
import { Group, GroupAction, Row, SaveRow, SwitchRow } from './SettingsControls';
import type { ShowToast } from './toast';

type Feature = 'cloudModels' | 'gallery' | 'imageGeneration' | 'imageReferences' | 'loras' | 'nsfwModels' | 'presets' | 'promptAssistant' | 'promptHistory' | 'videoGeneration' | 'videoReferences';
type AccessProfile = { id: string; name: string; generationProfiles: string[]; allModels?: boolean; features: Record<Feature, boolean> };
type Account = { id: string; username: string; displayName: string; role: 'administrator' | 'user'; accessProfileId?: string; disabled: boolean; identity?: { provider?: string }; pending?: boolean; signInLinked?: boolean };
type GatewayIdentities = { links: { identity: string; accountId: string; linkedAt: string }[]; pending: { identity: string; firstSeenAt: string; lastSeenAt: string }[]; /** Chat Gateway Admin Tools (server/account-store.js gatewayAdminTools). */ adminTools?: boolean };
type AdminData = { accessProfiles: AccessProfile[]; availableProfiles: string[]; accounts: Account[]; defaultAccessProfileId?: string; requireApproval?: boolean; lockedFeatures?: Partial<Record<Feature, boolean>>; gateway?: GatewayIdentities };
export type ProfileInfo = { label: string; kind?: string; cloud?: boolean; nsfw?: boolean };

/** Access-profile features, alphabetically (UI-PATTERNS › Settings). */
const featureLabels: [Feature, string][] = [
  ['cloudModels', 'Cloud Models'], ['gallery', 'Gallery'],
  ['imageGeneration', 'Image Generation'], ['imageReferences', 'Image References'],
  ['loras', 'LoRAs'], ['nsfwModels', 'NSFW Models'], ['presets', 'Presets & Civitai Imports'],
  ['promptAssistant', 'Prompt Assistant'], ['promptHistory', 'Prompt History'], ['videoGeneration', 'Video Generation'], ['videoReferences', 'Video References']
];
const anyGeneration = { needs: ['imageGeneration', 'videoGeneration'] as Feature[], reason: 'Needs Image or Video Generation' };
// A feature that only means something while another one is on.
const featureNeeds: Partial<Record<Feature, { needs: Feature[]; reason: string }>> = {
  cloudModels: anyGeneration,
  imageReferences: { needs: ['imageGeneration'], reason: 'Needs Image Generation' },
  loras: anyGeneration,
  nsfwModels: anyGeneration,
  promptAssistant: anyGeneration,
  videoReferences: { needs: ['videoGeneration'], reason: 'Needs Video Generation' }
};
const featureApplies = (feature: Feature, on: Set<Feature>) => !featureNeeds[feature] || featureNeeds[feature]!.needs.some((need) => on.has(need));
/**
 * Why a feature can't be granted at all: the deployment switched it off for everyone,
 * or (Presets & Civitai Imports) it stays with administrators, as saved images are shared.
 */
const featureLock = (feature: Feature, locked: AdminData['lockedFeatures']) => locked?.[feature] ? 'Off for This Deployment' : feature === 'presets' ? 'Administrators Only' : '';
const jsonPost = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const NEW = '__new__';
const NONE = '__none__';
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));
const profileIdFrom = (name: string) => name.trim().toLocaleLowerCase('en-AU').replace(/[^a-z0-9:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128);

// Settings loads this module when its button is hovered or focused, so the account is on its way before Settings opens.
if (typeof window !== 'undefined' && knownAccountStatus()?.signedIn && !cachedMe()) void loadMe().catch(() => undefined);

/** Settings › Account: your MCP connection, then who you are and your password (alphabetical groups). */
export function AccountSettings({ showToast, copyToClipboard }: { showToast: ShowToast; copyToClipboard: (text: string) => Promise<boolean> }) {
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
    await run(async () => {
      const result = await apiJson<McpTokenStatus & { token: string }>('/api/accounts/mcp-token', { method: 'POST' });
      setIssuedToken(result.token);
      setToken({ endpoint: me?.mcp.endpoint || '', enabled: true, createdAt: result.createdAt });
    }, 'Couldn’t create the MCP token');
  };
  const revokeToken = async () => {
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
    <ProfileGroup account={account} showToast={showToast} onSaved={(next) => { setMe((current) => current ? { ...current, account: next } : current); updateCachedMe({ account: next }); }} />
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

/** Settings › Users (administrators): access profiles, accounts and chat gateway users, alphabetically. */
export function UsersSettings({ showToast, profiles }: { showToast: ShowToast; profiles?: Record<string, ProfileInfo> }) {
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
    if (await run(() => apiJson('/api/accounts/gateway-links', jsonPost('POST', { identity, ...(accountId ? { accountId } : {}) })), 'Couldn’t update the chat user')) {
      if (account) showToast(`Linked to ${account.displayName}`, 'success');
      await refresh();
    }
  };
  const dismissGatewayIdentity = async (identity: string) => {
    if (await run(() => apiJson('/api/accounts/gateway-pending/dismiss', jsonPost('POST', { identity })), 'Couldn’t dismiss the chat user')) await refresh();
  };
  // Gateway-linked administrators get MCP's admin tools only while this is on (off by default).
  const setGatewayAdminTools = async (on: boolean) => {
    if (await run(() => apiJson('/api/accounts/gateway-admin', jsonPost('POST', { on })), 'Couldn’t save Chat Gateway Admin Tools')) {
      showToast(on ? 'Admin tools on for gateway administrators' : 'Admin tools off for gateway administrators', 'success');
      await refresh();
    }
  };
  const accountOptions = (list: Account[]) => byName(list).map((account) => ({ label: `${account.displayName} (${account.username})`, value: account.id }));

  if (!admin) return loadError
    ? <Group><Row label="Users Unavailable" description={loadError}><button className="btn is-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Try Again</button></Row></Group>
    : <Group title="Access Profiles"><Row label={<Skeleton className="skeleton-text short" />} /></Group>;

  const gatewayLinks = [...(admin.gateway?.links || [])].sort((a, b) => a.identity.localeCompare(b.identity));
  const gatewayPending = [...(admin.gateway?.pending || [])].sort((a, b) => a.identity.localeCompare(b.identity));
  return <div className="set-sections">
    <AccessProfileEditor admin={admin} profiles={profiles} showToast={showToast} onSaved={refresh} />
    <AccountsGroup admin={admin} showToast={showToast} onSaved={refresh} />
    <Group title="Chat Gateway" note="A trusted chat gateway forwards its own user IDs. Each one reaches Studio only once it is linked to an account, here or automatically when the gateway forwards an enabled account's email. With a default access profile, an email no account has becomes a new account.">
      <SwitchRow label="Chat Gateway Admin Tools" description={admin.gateway?.adminTools ? 'Administrators linked here manage the Library, catalogue and profiles from chat, as with their own MCP token.' : 'Only an administrator’s own MCP token gets the Library, catalogue and profile tools in chat.'} checked={admin.gateway?.adminTools === true} disabled={busy} onChange={(next) => void setGatewayAdminTools(next)} />
      {gatewayLinks.map((link) => {
        const account = admin.accounts.find((item) => item.id === link.accountId);
        return <Row key={link.identity} label={link.identity} description={`Linked to ${account ? `${account.displayName} (${account.username})` : 'a removed account'}`}>
          <button className="btn is-ghost" disabled={busy} aria-label={`Unlink ${link.identity}`} onClick={() => void setGatewayLink(link.identity, '')}><Unlink size={14} /> Unlink</button>
        </Row>;
      })}
      {gatewayPending.map((item) => <Row key={item.identity} label={item.identity} description={`Waiting since ${new Date(item.firstSeenAt).toLocaleString('en-AU')}`}>
        <div className="set-type-picker"><StudioSelect ariaLabel={`Account for ${item.identity}`} value={gatewayChoice[item.identity] || NONE} options={[...(gatewayChoice[item.identity] ? [] : [{ label: 'Choose an Account', value: NONE }]), ...accountOptions(admin.accounts)]} onChange={(value) => setGatewayChoice((current) => ({ ...current, [item.identity]: value === NONE ? '' : value }))} /></div>
        <button className="btn is-primary" disabled={busy || !gatewayChoice[item.identity]} onClick={() => void setGatewayLink(item.identity, gatewayChoice[item.identity])}><Link2 size={14} /> Link</button>
        <button className="btn is-ghost" disabled={busy} aria-label={`Dismiss ${item.identity}`} onClick={() => void dismissGatewayIdentity(item.identity)}><X size={14} /> Dismiss</button>
      </Row>)}
      {!gatewayLinks.length && !gatewayPending.length ? <Row label="No Chat Users Yet" description="Users appear here after their first request through the gateway." /> : null}
    </Group>
  </div>;
}

const byName = <T extends { displayName: string }>(list: T[]) => [...list].sort((a, b) => a.displayName.localeCompare(b.displayName, 'en-AU', { sensitivity: 'base' }));
const byProfileName = (list: AccessProfile[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }));

type Draft = { name: string; models: string[]; allModels: boolean; features: Feature[] };

/**
 * One access profile at a time, picked from a list with New, edited with multi-selects and
 * saved or discarded. New profiles take their ID from the name. Cloud models are not listed:
 * the Cloud Models feature grants them. All Models also grants local models added later.
 */
function AccessProfileEditor({ admin, profiles, showToast, onSaved }: { admin: AdminData; profiles?: Record<string, ProfileInfo>; showToast: ShowToast; onSaved: () => Promise<void> }) {
  const sorted = byProfileName(admin.accessProfiles);
  const [choice, setChoice] = React.useState(sorted[0]?.id || NEW);
  const saved = admin.accessProfiles.find((profile) => profile.id === choice) || null;
  const blank: Draft = { name: '', models: [], allModels: false, features: ['gallery', 'imageGeneration', 'imageReferences', 'promptAssistant', 'promptHistory'] };
  const fromSaved = (profile: AccessProfile | null): Draft => profile ? { name: profile.name, models: profile.generationProfiles, allModels: profile.allModels === true, features: featureLabels.map(([key]) => key).filter((key) => profile.features?.[key]) } : blank;
  const [draft, setDraft] = React.useState(() => fromSaved(saved));
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setDraft(fromSaved(saved)); }, [choice, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = fromSaved(saved);
  const dirty = choice === NEW ? Boolean(draft.name.trim() || draft.models.length || draft.allModels) : draft.name !== base.name || draft.allModels !== base.allModels || !sameSet(draft.models, base.models) || !sameSet(draft.features, base.features);
  const on = new Set(draft.features);
  const lockOf = (feature: Feature) => featureLock(feature, admin.lockedFeatures);

  // Stored grants stay listed while discovery is degraded, marked unavailable; cloud profiles never are.
  const local = (id: string) => !profiles?.[id]?.cloud;
  const grantable = [...new Set([...admin.availableProfiles, ...draft.models])].filter(local);
  const kindOn = (kind?: string) => kind === 'video' ? on.has('videoGeneration') : on.has('imageGeneration');
  const usable = (id: string) => kindOn(profiles?.[id]?.kind) && (!profiles?.[id]?.nsfw || on.has('nsfwModels'));
  const modelOptions: MultiSelectOption[] = grantable.map((id) => {
    const info = profiles?.[id];
    const unavailable = !admin.availableProfiles.includes(id);
    const kindWord = info?.kind === 'video' ? 'Video' : 'Image';
    const reason = !kindOn(info?.kind) ? `Turn on ${kindWord} Generation first` : info?.nsfw && !on.has('nsfwModels') ? 'Turn on NSFW Models first' : undefined;
    return { value: id, label: info?.label || id, detail: unavailable ? 'Unavailable' : info?.nsfw ? `${kindWord} · NSFW` : kindWord, disabled: Boolean(reason) && !draft.models.includes(id), reason };
  }).sort((a, b) => a.label.localeCompare(b.label));
  // All Models shows every model it currently opens as picked.
  const modelValues = draft.allModels ? grantable.filter((id) => admin.availableProfiles.includes(id) && usable(id)) : draft.models;

  // Presets & Civitai Imports stays with administrators, so it isn't offered here (the saved value is kept).
  const featureOptions: MultiSelectOption[] = featureLabels.filter(([key]) => key !== 'presets').map(([key, label]) => {
    const lock = lockOf(key);
    return { value: key, label, disabled: Boolean(lock) || (!featureApplies(key, on) && !on.has(key)), reason: lock || featureNeeds[key]?.reason };
  });
  const grantableFeatures = featureLabels.map(([key]) => key).filter((key) => !lockOf(key));
  const setFeatures = (values: string[]) => {
    // A feature whose prerequisite went off goes with it.
    const next = new Set(values as Feature[]);
    for (const [key] of featureLabels) if (next.has(key) && !featureApplies(key, next)) next.delete(key);
    setDraft((current) => ({ ...current, features: featureLabels.map(([key]) => key).filter((key) => next.has(key)) }));
  };

  const save = async () => {
    const name = draft.name.trim();
    const id = choice === NEW ? profileIdFrom(name) : choice;
    if (!name) return;
    if (!id) { showToast('Use letters or numbers in the name', 'error'); return; }
    if (choice === NEW && admin.accessProfiles.some((profile) => profile.id === id)) { showToast('An access profile with that name already exists', 'error'); return; }
    setBusy(true);
    try {
      const models = draft.allModels ? [] : draft.models.filter((model) => usable(model) || !admin.availableProfiles.includes(model));
      await apiJson('/api/accounts/profiles', jsonPost('POST', { id, name, generationProfiles: models, allModels: draft.allModels, features: Object.fromEntries(featureLabels.map(([key]) => [key, on.has(key)])) }));
      showToast(`${name} saved`, 'success');
      await onSaved();
      setChoice(id);
    } catch (error) { showToast(message(error, 'Couldn’t save the access profile'), 'error'); }
    finally { setBusy(false); }
  };
  const options = [...sorted.map((profile) => ({ label: profile.name, value: profile.id })), { label: 'New Access Profile', value: NEW }];
  const offModels = draft.allModels ? 0 : draft.models.filter((model) => admin.availableProfiles.includes(model) && !usable(model)).length;
  const accounts = saved ? admin.accounts.filter((account) => account.accessProfileId === saved.id).length : 0;
  const generation = on.has('imageGeneration') || on.has('videoGeneration');
  return <Group title="Access Profiles" note="Each ordinary account gets one access profile. Administrators always have full access. Cloud models follow the Cloud Models feature; other new models stay administrator-only until granted here or through All.">
    <Row label="Access Profile" description={saved ? `${saved.allModels ? 'All models' : `${saved.generationProfiles.length} model${saved.generationProfiles.length === 1 ? '' : 's'}`} · ${accounts} account${accounts === 1 ? '' : 's'}` : 'A new access profile.'}>
      <div className="set-type-picker"><StudioSelect ariaLabel="Access Profile to Edit" value={choice} options={options} onChange={(value) => { if (!dirty || value === choice) setChoice(value); else showToast('Save or discard the changes first', 'error'); }} /></div>
    </Row>
    <Row label="Name"><input className="modal-input account-field" aria-label="Profile Name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Studio Artists" /></Row>
    <Row label="Features" description="What accounts with this profile can use.">
      <MultiSelect label="Features" values={draft.features} options={featureOptions} onChange={setFeatures} allPicked={grantableFeatures.every((key) => on.has(key))} onAll={() => setFeatures(grantableFeatures)} />
    </Row>
    <Row label="Models" description={!generation ? 'Turn on Image or Video Generation first.' : draft.allModels ? 'Every local model these accounts’ features allow, including ones added later.' : offModels ? `${offModels} picked model${offModels === 1 ? '' : 's'} won’t be granted while ${offModels === 1 ? 'it is' : 'they are'} switched off.` : 'The local models these accounts may generate with.'} disabled={!generation}>
      <MultiSelect label="Models" values={modelValues} options={modelOptions} disabled={!generation} searchFrom={Infinity} allPicked={draft.allModels} onAll={() => setDraft((current) => ({ ...current, allModels: true, models: [] }))} onChange={(values) => setDraft((current) => ({ ...current, allModels: false, models: values }))} />
    </Row>
    <SaveRow dirty={dirty} busy={busy} saveLabel={choice === NEW ? 'Create Profile' : 'Save Profile'} canSave={Boolean(draft.name.trim())} onSave={() => void save()} onDiscard={() => { setDraft(fromSaved(saved)); if (choice === NEW && sorted[0]) setChoice(sorted[0].id); }} />
  </Group>;
}

/**
 * Every account in one list (by name), each with its access profile and Enable or Disable,
 * after the default access profile for new accounts. New Account, on the heading's line,
 * opens its form in place.
 */
function AccountsGroup({ admin, showToast, onSaved }: { admin: AdminData; showToast: ShowToast; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const startingProfile = () => admin.defaultAccessProfileId || byProfileName(admin.accessProfiles)[0]?.id || '';
  const [profileId, setProfileId] = React.useState(startingProfile);
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
    await run(account.id, () => patch(account, { disabled: !account.disabled }), 'Couldn’t update the account');
  };
  const setDefault = async (value: string) => {
    const next = value === NONE ? '' : value;
    if (next === (admin.defaultAccessProfileId || '')) return;
    if (await run('default', () => apiJson('/api/accounts/default-profile', jsonPost('POST', { accessProfileId: next })), 'Couldn’t save the default access profile')) showToast('Default access profile saved', 'success');
  };
  const approval = admin.requireApproval !== false;
  const setApproval = async (next: boolean) => {
    if (await run('approval', () => apiJson('/api/accounts/default-profile', jsonPost('POST', { requireApproval: next })), 'Couldn’t save Require Approval')) showToast(next ? 'New sign-ins wait for approval' : 'New sign-ins start at once', 'success');
  };
  const reset = () => { setUsername(''); setDisplayName(''); setPassword(''); setProfileId(startingProfile()); setCreating(false); };
  const create = async () => {
    if (await run('new', () => apiJson('/api/accounts/users', jsonPost('POST', { username: username.trim(), displayName, ...(password ? { password } : {}), accessProfileId: profileId })), 'Couldn’t create the account')) {
      showToast(`${displayName || username.trim()} created`, 'success');
      reset();
    }
  };
  const profileOptions = (current: string) => [...(current ? [] : [{ label: 'Choose a Profile', value: NONE }]), ...byProfileName(admin.accessProfiles).map((profile) => ({ label: profile.name, value: profile.id }))];
  const pending = admin.accounts.filter((item) => item.pending).length;
  const defaultId = admin.defaultAccessProfileId || '';
  return <Group title="Accounts" action={creating ? null : <GroupAction onClick={() => { setProfileId(startingProfile()); setCreating(true); }}><UserPlus size={13} aria-hidden="true" /> New Account</GroupAction>} note={pending ? `${pending} sign-in${pending === 1 ? '' : 's'} waiting: choose an access profile to approve.` : 'Accounts are never deleted, only disabled, so their outputs stay.'}>
    {creating ? <>
      <Row label="Email" description={username.trim() && !looksLikeEmail(username) ? 'Enter an email address. It is the account’s sign-in name.' : 'The sign-in name; single sign-on links to it.'}><input className="modal-input account-field" aria-label="Email" autoComplete="off" autoFocus {...emailFieldProps} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="artist@example.com" /></Row>
      <Row label="Display Name"><input className="modal-input account-field" aria-label="Display Name" autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="New Artist" /></Row>
      <Row label="Temporary Password" description="Optional. Without one the account signs in through single sign-on only."><input className="modal-input account-field" aria-label="Temporary Password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Row>
      <Row label="Access Profile"><div className="set-type-picker"><StudioSelect ariaLabel="Access Profile for the New Account" value={profileId || NONE} options={profileOptions(profileId)} onChange={(value) => setProfileId(value === NONE ? '' : value)} /></div></Row>
      <SaveRow dirty busy={busy === 'new'} saveLabel="Create Account" canSave={looksLikeEmail(username) && Boolean(profileId)} onSave={() => void create()} onDiscard={reset} />
    </> : null}
    <Row label="Default Access Profile" description={defaultId ? 'New accounts start on it: added here, through single sign-on or the chat gateway.' : 'New single sign-on accounts wait for approval, and the chat gateway adds no accounts.'} disabled={busy === 'default'}>
      <div className="set-type-picker"><StudioSelect ariaLabel="Default Access Profile" value={defaultId || NONE} options={[{ label: 'None · Approve Each', value: NONE }, ...byProfileName(admin.accessProfiles).map((profile) => ({ label: profile.name, value: profile.id }))]} onChange={(value) => void setDefault(value)} /></div>
    </Row>
    {defaultId ? <SwitchRow label="Require Approval" description={approval ? 'New single sign-on and chat gateway accounts wait here, then get the default access profile when approved.' : 'New single sign-on and chat gateway accounts start on the default access profile at once.'} checked={approval} disabled={busy === 'approval'} onChange={(next) => void setApproval(next)} /> : null}
    {byName(admin.accounts).map((account) => {
      const isAdmin = account.role === 'administrator';
      return <Row key={account.id} label={account.displayName} description={`${account.username} · ${isAdmin ? 'Administrator' : 'User'}${account.signInLinked ? ' · single sign-on' : ''}${account.identity?.provider === 'gateway' ? ' · chat gateway' : ''}${account.pending ? ' · waiting for approval' : ''}${account.disabled ? ' · disabled' : ''}`} disabled={account.disabled}>
        {account.pending && defaultId ? <button className="btn is-primary" disabled={Boolean(busy)} aria-label={`Approve ${account.displayName}`} onClick={() => void assign(account, defaultId)}><Check size={14} /> Approve</button> : null}
        {isAdmin ? <span className="set-locked-value">Full Access</span> : <div className="set-type-picker"><StudioSelect ariaLabel={`Access Profile for ${account.username}`} value={account.accessProfileId || NONE} options={profileOptions(account.accessProfileId || '')} onChange={(value) => void assign(account, value)} /></div>}
        <button className="btn is-ghost" disabled={Boolean(busy)} onClick={() => void toggleDisabled(account)}>{account.disabled ? <><Power size={14} /> Enable</> : <><Ban size={14} /> Disable</>}</button>
      </Row>;
    })}
  </Group>;
}
