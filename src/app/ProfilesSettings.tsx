import React from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { Skeleton, StudioSelect } from './components';
import { lineDiff } from './lineDiff';
import { Group, GroupAction, Row, SaveRow, Segmented, Status } from './SettingsControls';
import { ProfileGuide } from './ProfileGuide';
import { DiffView, originWords, VersionList, type VersionEntry } from './ProfileVersions';
import type { ShowToast } from './toast';
import { cn } from './format';
import { usePhone } from './device';
import { useTextFocus } from './useTextFocus';

type Editable = {
  id: string; profileId: string; name: string; kind: 'image' | 'video'; family: string; readable: boolean; edited: { editedAt: string; by: string } | null;
  version: number; origin: VersionEntry['origin']; aiDrafted: boolean; nsfw?: boolean;
};
type VersionMeta = { version: number; origin: VersionEntry['origin']; aiDrafted: boolean; by: string; editedAt: string } | null;
type Loaded = { id: string; text: string; hash: string; edited: Editable['edited']; version?: VersionMeta };
type Check = { ok: boolean; errors: string[]; warnings: string[] };
type View = 'json' | 'guide' | 'versions';
const jsonBody = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Where a profile stands: an unreviewed AI draft, Studio's own edit, or as the seed brought it. */
function standing(item: Editable) {
  if (item.aiDrafted) return { tone: 'warn' as const, words: 'AI-Drafted', note: 'Drafted by the assistant from an import; only administrators see it until approved' };
  if (item.origin === 'seed' && !item.edited) return { tone: 'ok' as const, words: 'From the Seed', note: 'As the seed had it; Studio owns it now and Export takes changes back' };
  return { tone: 'ok' as const, words: originWords[item.origin] || 'Edited in Studio', note: 'Studio’s own; Export takes it back to the profiles repository' };
}

/** Downloads the export bundle and says what it held. */
async function downloadExport(showToast: ShowToast) {
  const response = await apiFetch('/api/profiles/export', { cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : 'Couldn’t export the profiles');
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'studio-profiles.zip';
  let counts = { profiles: 0, guides: 0, unreviewed: 0 };
  try { counts = { ...counts, ...JSON.parse(response.headers.get('x-studio-export') || '{}') }; } catch { /* Counts are a nicety. */ }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  showToast(`Exported ${counts.profiles} profile${counts.profiles === 1 ? '' : 's'} and ${counts.guides} guide${counts.guides === 1 ? '' : 's'}${counts.unreviewed ? `, ${counts.unreviewed} not yet approved` : ''}`, 'success');
}

/**
 * Settings › Profiles (administrators): Studio owns every live profile and guide. One profile at
 * a time: its JSON (checked on the server and reviewed as a diff before it is saved), the guide
 * that applies to it, and its versions with Revert. An AI draft is Approved here. Export packs
 * everything in the profiles repository's layout.
 */
export function ProfilesSettings({ showToast, onSaved }: { showToast: ShowToast; onSaved?: () => void }) {
  // On the phone the editor takes the whole screen above the keyboard while it has the focus.
  const focus = useTextFocus(usePhone());
  const [list, setList] = React.useState<Editable[] | null>(null);
  const [listError, setListError] = React.useState('');
  const [id, setId] = React.useState('');
  const [view, setView] = React.useState<View>('json');
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [text, setText] = React.useState('');
  const [check, setCheck] = React.useState<Check | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [versions, setVersions] = React.useState<VersionEntry[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshList = React.useCallback(async () => {
    try {
      const data = await apiJson<{ profiles: Editable[] }>('/api/profiles/editable', { cache: 'no-store' });
      setList(data.profiles);
      setListError('');
      setId((current) => current || data.profiles.find((item) => item.aiDrafted)?.id || data.profiles[0]?.id || '');
    } catch (error) { setListError(error instanceof Error ? error.message : 'Couldn’t list the profiles'); }
  }, []);
  React.useEffect(() => { void refreshList(); }, [refreshList]);
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    setLoaded(null); setCheck(null); setReviewing(false); setVersions(null);
    apiJson<Loaded>(`/api/profiles/editable/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((data) => { if (live) { setLoaded(data); setText(data.text); } })
      .catch((error) => { if (live) showToast(error instanceof Error ? error.message : 'Couldn’t open that profile', 'error'); });
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (view !== 'versions' || !id || versions) return;
    apiJson<{ versions: VersionEntry[] }>(`/api/profiles/editable/${encodeURIComponent(id)}/versions`, { cache: 'no-store' })
      .then((data) => setVersions(data.versions))
      .catch((error) => showToast(error instanceof Error ? error.message : 'Couldn’t list the versions', 'error'));
  }, [view, id, versions]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(loaded) && text !== loaded!.text;
  // A new edit needs a new check before it can be saved.
  React.useEffect(() => { setCheck(null); setReviewing(false); }, [text]);
  const diff = React.useMemo(() => reviewing && loaded ? lineDiff(loaded.text, text) : null, [reviewing, loaded, text]);
  const parseError = React.useMemo(() => { try { JSON.parse(text || 'null'); return ''; } catch (error) { return error instanceof Error ? error.message : 'Not valid JSON'; } }, [text]);
  const current = list?.find((item) => item.id === id);
  // After any change: the list's markers, the versions and the models everyone sees catch up.
  const changed = async () => { await refreshList(); setVersions(null); onSaved?.(); };

  const runCheck = async () => {
    setBusy(true);
    try {
      const data = await apiJson<{ check: Check }>(`/api/profiles/editable/${encodeURIComponent(id)}/check`, jsonBody('POST', { text }));
      setCheck(data.check);
      setReviewing(true);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Couldn’t check the profile', 'error'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      const data = await apiJson<Loaded & { warnings: string[] }>(`/api/profiles/editable/${encodeURIComponent(id)}`, jsonBody('PUT', { text, baseHash: loaded.hash }));
      setLoaded(data); setText(data.text); setReviewing(false); setCheck(null);
      showToast(`${current?.name || id} saved`, 'success');
      await changed();
    } catch (error) {
      // A save refused by the server (the file changed meanwhile, or a check it alone could run) reads in the review.
      if (error instanceof Error) setCheck({ ok: false, errors: [error.message], warnings: [] });
      showToast(error instanceof Error ? error.message : 'Couldn’t save the profile', 'error');
    } finally { setBusy(false); }
  };
  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try { await work(); } catch (error) { showToast(error instanceof Error ? error.message : failure, 'error'); } finally { setBusy(false); }
  };
  const approve = () => act(async () => {
    await apiJson(`/api/profiles/editable/${encodeURIComponent(id)}/approve`, jsonBody('POST', {}));
    showToast(`${current?.name || id} approved. Access profiles decide who sees it`, 'success');
    await changed();
  }, 'Couldn’t approve the profile');
  const revert = (version: number) => act(async () => {
    if (!loaded) return;
    const data = await apiJson<Loaded>(`/api/profiles/editable/${encodeURIComponent(id)}/revert`, jsonBody('POST', { version, baseHash: loaded.hash }));
    setLoaded(data); setText(data.text);
    showToast(`${current?.name || id} back to version ${version}`, 'success');
    await changed();
  }, 'Couldn’t revert the profile');
  const discard = () => { if (loaded) setText(loaded.text); setReviewing(false); setCheck(null); };
  const pick = (next: string) => {
    if (next === id) return;
    if (dirty) { showToast('Save or discard the changes first', 'error'); return; }
    setId(next);
  };
  const changeView = (next: View) => {
    if (next !== 'json' && dirty) { showToast('Save or discard the changes first', 'error'); return; }
    setView(next);
  };
  const exportAll = () => act(() => downloadExport(showToast), 'Couldn’t export the profiles');

  if (listError) return <Group><Row label="Profiles Unavailable" description={listError}><button className="btn is-ghost" onClick={() => void refreshList()}><RefreshCw size={14} /> Try Again</button></Row></Group>;
  if (list && !list.length) return <Group><Row label="No Profiles Here" description="Studio has none yet; a new install takes them from the seed and a checkpoint import drafts one" /></Group>;
  const state = current ? standing(current) : null;
  const lines = text ? text.split('\n').length : 0;
  return <div className="set-sections">
    <Group title="Profile" action={<GroupAction disabled={busy || !list} onClick={() => void exportAll()}>Export</GroupAction>}
      note="Studio owns live profiles and guides; Export packs them with the catalogue for the profiles repository">
      <Row label="Profile" description={current ? `${current.kind === 'video' ? 'Video' : 'Image'}${current.family ? ` · ${current.family}` : ''} · ${current.id}.json` : undefined}>
        {list ? <div className="set-type-picker is-wide"><StudioSelect ariaLabel="Profile to Edit" value={id} options={list.map((item) => ({ label: `${item.name}${item.aiDrafted ? ' · AI-Drafted' : ''}`, value: item.id }))} onChange={pick} /></div> : <Skeleton className="skeleton-text short" />}
      </Row>
      <Row label="Source" description={state ? `${state.note}${current?.version ? ` · version ${current.version}` : ''}` : undefined}>
        {current && state ? <span className="profile-standing">
          <Status tone={state.tone}>{state.words}</Status>
          {current.aiDrafted ? <button type="button" className="btn is-primary is-sm" disabled={busy || dirty} onClick={() => void approve()}>Approve</button> : null}
        </span> : null}
      </Row>
      <Row label="Show"><Segmented label="Show" value={view} onChange={changeView} options={[{ value: 'json', label: 'JSON' }, { value: 'guide', label: 'Guide' }, { value: 'versions', label: 'Versions' }]} /></Row>
    </Group>
    {view === 'guide' && current ? <ProfileGuide key={current.id} profileId={current.id} profileName={current.name} showToast={showToast} /> : null}
    {view === 'versions' && current ? <VersionList title="Versions" versions={versions} current={loaded?.version?.version || current.version} busy={busy || dirty}
      note="Revert saves that version again as the newest; nothing is lost"
      load={async (version) => (await apiJson<{ version: { text: string } }>(`/api/profiles/editable/${encodeURIComponent(id)}/versions/${version}`)).version.text}
      onRevert={(version) => void revert(version)} /> : null}
    {view === 'json' ? <Group title="JSON" note={parseError ? undefined : `${lines} line${lines === 1 ? '' : 's'}`}>
      <div className="profile-editor">
        {loaded ? <div {...focus.bind} className={cn('text-focus-field', focus.focused && 'is-text-focused')}>
          {focus.focused ? <div className="text-focus-bar"><strong>Profile JSON</strong><button type="button" className="btn is-primary text-focus-done" {...focus.keepFocus} onClick={focus.done}>Done</button></div> : null}
          <textarea className={cn('profile-editor-text', parseError && 'is-invalid')} aria-label="Profile JSON" aria-invalid={Boolean(parseError)} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
          // Tab indents inside the editor; Escape leaves it for the keyboard.
          if (event.key !== 'Tab' || event.shiftKey) return;
          event.preventDefault();
          const field = event.currentTarget;
          const { selectionStart: from, selectionEnd: to } = field;
          setText(`${text.slice(0, from)}  ${text.slice(to)}`);
          requestAnimationFrame(() => { field.selectionStart = field.selectionEnd = from + 2; });
        }} />
        </div> : <Skeleton className="profile-editor-text" />}
        {parseError ? <p className="list-note is-error" role="alert">Not valid JSON: {parseError}</p> : null}
      </div>
      {dirty && !reviewing ? <div className="list-row is-static set-row set-save-row" role="group" aria-label="Unsaved Changes">
        <span className="list-row-text"><span className="list-row-label">Unsaved Changes</span><span className="list-row-detail">Review the changes and Studio’s check before you save</span></span>
        <span className="list-row-control">
          <button type="button" className="btn is-ghost" disabled={busy} onClick={discard}>Discard</button>
          <button type="button" className="btn is-primary" disabled={busy || Boolean(parseError)} onClick={() => void runCheck()}>{busy ? 'Checking…' : 'Review Changes'}</button>
        </span>
      </div> : null}
    </Group> : null}
    {view === 'json' && reviewing && diff ? <Group title={`Changes · ${diff.added} added · ${diff.removed} removed`}>
      {check ? <div className="profile-check" role="status">
        {check.errors.length ? check.errors.map((item) => <p key={item} className="is-error">{item}</p>) : <p className="is-ok"><CheckCircle2 size={14} aria-hidden="true" /> The JSON is valid, the ID is unchanged and every control points at a real node</p>}
        {check.warnings.map((item) => <p key={item} className="is-warn">{item}</p>)}
      </div> : null}
      {loaded ? <DiffView before={loaded.text} after={text} /> : null}
      <SaveRow dirty busy={busy} saveLabel="Save Profile" canSave={Boolean(check?.ok)} onSave={() => void save()} onDiscard={discard} note={check && !check.ok ? 'Fix the problems above, then review again' : current?.aiDrafted ? 'Saves a new version and approves the draft' : 'Saves a new version; Versions keeps every earlier one'} />
    </Group> : null}
  </div>;
}
