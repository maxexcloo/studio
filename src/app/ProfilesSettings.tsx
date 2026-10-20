import React from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { apiJson } from './api';
import { Skeleton, StudioSelect } from './components';
import { lineDiff } from './lineDiff';
import { Group, Row, SaveRow, Status } from './SettingsControls';
import type { ShowToast } from './toast';
import { cn } from './format';
import { usePhone } from './device';
import { useTextFocus } from './useTextFocus';

type Editable = { id: string; profileId: string; name: string; kind: 'image' | 'video'; family: string; readable: boolean; edited: { editedAt: string; by: string } | null };
type Loaded = { id: string; text: string; hash: string; edited: Editable['edited'] };
type Check = { ok: boolean; errors: string[]; warnings: string[] };
const jsonBody = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Settings › Profiles (administrators): one model profile's JSON at a time,
 * checked on the server and reviewed as a diff before it is saved over
 * Studio's copy.
 */
export function ProfilesSettings({ showToast, onSaved }: { showToast: ShowToast; onSaved?: () => void }) {
  // On the phone the editor takes the whole screen above the keyboard while it has the focus.
  const focus = useTextFocus(usePhone());
  const [list, setList] = React.useState<Editable[] | null>(null);
  const [listError, setListError] = React.useState('');
  const [id, setId] = React.useState('');
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [text, setText] = React.useState('');
  const [check, setCheck] = React.useState<Check | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const refreshList = React.useCallback(async () => {
    try {
      const data = await apiJson<{ profiles: Editable[] }>('/api/profiles/editable', { cache: 'no-store' });
      setList(data.profiles);
      setListError('');
      setId((current) => current || data.profiles[0]?.id || '');
    } catch (error) { setListError(error instanceof Error ? error.message : 'Couldn’t list the profiles'); }
  }, []);
  React.useEffect(() => { void refreshList(); }, [refreshList]);
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    setLoaded(null); setCheck(null); setReviewing(false);
    apiJson<Loaded>(`/api/profiles/editable/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((data) => { if (live) { setLoaded(data); setText(data.text); } })
      .catch((error) => { if (live) showToast(error instanceof Error ? error.message : 'Couldn’t open that profile', 'error'); });
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(loaded) && text !== loaded!.text;
  // A new edit needs a new check before it can be saved.
  React.useEffect(() => { setCheck(null); setReviewing(false); }, [text]);
  const diff = React.useMemo(() => reviewing && loaded ? lineDiff(loaded.text, text) : null, [reviewing, loaded, text]);
  const parseError = React.useMemo(() => { try { JSON.parse(text || 'null'); return ''; } catch (error) { return error instanceof Error ? error.message : 'Not valid JSON'; } }, [text]);

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
      showToast(`${list?.find((item) => item.id === id)?.name || id} saved`, 'success');
      void refreshList();
      onSaved?.();
    } catch (error) {
      // A save refused by the server (the file changed meanwhile, or a check it alone could run) reads in the review.
      if (error instanceof Error) setCheck({ ok: false, errors: [error.message], warnings: [] });
      showToast(error instanceof Error ? error.message : 'Couldn’t save the profile', 'error');
    } finally { setBusy(false); }
  };
  const discard = () => { if (loaded) setText(loaded.text); setReviewing(false); setCheck(null); };
  const pick = (next: string) => {
    if (next === id) return;
    if (dirty) { showToast('Save or discard the changes first', 'error'); return; }
    setId(next);
  };

  if (listError) return <Group><Row label="Profiles Unavailable" description={listError}><button className="btn is-ghost" onClick={() => void refreshList()}><RefreshCw size={14} /> Try Again</button></Row></Group>;
  if (list && !list.length) return <Group><Row label="No Profiles Here" description="Studio has no profile files of its own to edit. Profiles arrive from the profiles repository." /></Group>;
  const current = list?.find((item) => item.id === id);
  const lines = text ? text.split('\n').length : 0;
  return <div className="set-sections">
    <Group title="Profile" note="This edits Studio’s own copy. An edited copy stops receiving updates from the profiles repository until the edit is committed there; each save keeps the previous file in Studio’s backups.">
      <Row label="Profile" description={current ? `${current.kind === 'video' ? 'Video' : 'Image'}${current.family ? ` · ${current.family}` : ''} · ${current.id}.json` : undefined}>
        {list ? <div className="set-type-picker is-wide"><StudioSelect ariaLabel="Profile to Edit" value={id} options={list.map((item) => ({ label: `${item.name}${item.edited ? ' · Edited' : ''}`, value: item.id }))} onChange={pick} /></div> : <Skeleton className="skeleton-text short" />}
      </Row>
      <Row label="Source" description={current?.edited ? `Edited here ${new Date(current.edited.editedAt).toLocaleString('en-AU')}, so repository updates no longer reach it.` : 'As it came from the profiles repository.'}>
        {current ? <Status tone={current.edited ? 'warn' : 'ok'}>{current.edited ? 'Edited Here' : 'From the Repository'}</Status> : null}
      </Row>
    </Group>
    <Group title="JSON" note={parseError ? undefined : `${lines} line${lines === 1 ? '' : 's'}`}>
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
        <span className="list-row-text"><span className="list-row-label">Unsaved Changes</span><span className="list-row-detail">Review the changes and Studio’s check before saving.</span></span>
        <span className="list-row-control">
          <button type="button" className="btn is-ghost" disabled={busy} onClick={discard}>Discard</button>
          <button type="button" className="btn is-primary" disabled={busy || Boolean(parseError)} onClick={() => void runCheck()}>{busy ? 'Checking…' : 'Review Changes'}</button>
        </span>
      </div> : null}
    </Group>
    {reviewing && diff ? <Group title={`Changes · ${diff.added} added · ${diff.removed} removed`}>
      {check ? <div className="profile-check" role="status">
        {check.errors.length ? check.errors.map((item) => <p key={item} className="is-error">{item}</p>) : <p className="is-ok"><CheckCircle2 size={14} aria-hidden="true" /> The profile parses, keeps its id and every control points at a node that exists.</p>}
        {check.warnings.map((item) => <p key={item} className="is-warn">{item}</p>)}
      </div> : null}
      <ol className="profile-diff" aria-label="Changes">
        {diff.lines.map((line, index) => line.type === 'skip'
          ? <li key={index} className="is-skip">{line.count} unchanged line{line.count === 1 ? '' : 's'}</li>
          : <li key={index} className={`is-${line.type}`}><span className="profile-diff-num" aria-hidden="true">{line.type === 'add' ? '' : line.oldLine}</span><span className="profile-diff-num" aria-hidden="true">{line.type === 'remove' ? '' : line.newLine}</span><span className="profile-diff-mark" aria-label={line.type === 'add' ? 'Added' : line.type === 'remove' ? 'Removed' : undefined}>{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span><code>{line.text || ' '}</code></li>)}
      </ol>
      <SaveRow dirty busy={busy} saveLabel="Save Profile" canSave={Boolean(check?.ok)} onSave={() => void save()} onDiscard={discard} note={check && !check.ok ? 'Fix the problems above, then review again.' : 'Saves over Studio’s copy; the previous file goes to backups.'} />
    </Group> : null}
  </div>;
}
