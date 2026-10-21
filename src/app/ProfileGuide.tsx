import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiJson } from './api';
import { Skeleton } from './components';
import { DiffView, originWords, VersionList, type VersionEntry } from './ProfileVersions';
import { Group, GroupAction, Row, SaveRow, Status } from './SettingsControls';
import type { ShowToast } from './toast';
import { cn } from './format';

type GuideMeta = { version: number; origin: VersionEntry['origin']; aiDrafted: boolean; by: string; editedAt: string } | null;
type GuideView =
  | { source: 'owned'; owned: Record<string, unknown> }
  | { source: 'none' }
  | { source: 'profile' | 'family'; packId: string; variant?: string; pack?: Record<string, unknown>; hash?: string; meta?: GuideMeta; readOnly?: boolean };
const jsonBody = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Settings › Profiles › Guide: the prompting guide that applies to one profile. A pack (the
 * profile's own binding, or its family's) is edited as JSON with Save & Discard and has its
 * versions, Revert and Approve; guidance kept in the profile's JSON is shown as it is.
 */
export function ProfileGuide({ profileId, profileName, showToast }: { profileId: string; profileName: string; showToast: ShowToast }) {
  const [view, setView] = React.useState<GuideView | null>(null);
  const [text, setText] = React.useState('');
  const [versions, setVersions] = React.useState<VersionEntry[] | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const packId = view && 'packId' in view ? view.packId : '';

  const load = React.useCallback(async () => {
    const data = await apiJson<GuideView>(`/api/profiles/editable/${encodeURIComponent(profileId)}/guide`, { cache: 'no-store' });
    setView(data);
    setText('pack' in data && data.pack ? pretty(data.pack) : '');
    setReviewing(false);
    if ('packId' in data && data.pack) {
      const list = await apiJson<{ versions: VersionEntry[] }>(`/api/profiles/guides/${encodeURIComponent(data.packId)}/versions`, { cache: 'no-store' });
      setVersions(list.versions);
    } else setVersions([]);
  }, [profileId]);
  React.useEffect(() => {
    setView(null); setVersions(null);
    load().catch((error) => showToast(error instanceof Error ? error.message : 'Couldn’t open the guide', 'error'));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const original = view && 'pack' in view && view.pack ? pretty(view.pack) : '';
  const dirty = Boolean(original) && text !== original;
  const parseError = React.useMemo(() => { if (!dirty) return ''; try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? '' : 'A guide is a JSON object'; } catch (error) { return error instanceof Error ? error.message : 'Not valid JSON'; } }, [dirty, text]);
  React.useEffect(() => { setReviewing(false); }, [text]);

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try { await work(); } catch (error) { showToast(error instanceof Error ? error.message : failure, 'error'); } finally { setBusy(false); }
  };
  const save = () => act(async () => {
    if (!view || !('hash' in view)) return;
    await apiJson(`/api/profiles/guides/${encodeURIComponent(packId)}`, jsonBody('PUT', { pack: text, baseHash: view.hash }));
    showToast('Guide saved', 'success');
    await load();
  }, 'Couldn’t save the guide');
  const approve = () => act(async () => {
    await apiJson(`/api/profiles/guides/${encodeURIComponent(packId)}/approve`, jsonBody('POST', {}));
    showToast('Guide approved', 'success');
    await load();
  }, 'Couldn’t approve the guide');
  const revert = (version: number) => act(async () => {
    if (!view || !('hash' in view)) return;
    await apiJson(`/api/profiles/guides/${encodeURIComponent(packId)}/revert`, jsonBody('POST', { version, baseHash: view.hash }));
    showToast(`Guide back to version ${version}`, 'success');
    await load();
  }, 'Couldn’t revert the guide');

  if (!view) return <Group title="Guide"><div className="list-row is-static set-row" aria-busy="true"><Skeleton className="skeleton-text short" /></div></Group>;
  if (view.source === 'none') return <Group title="Guide"><Row label="No Guide" description={`No prompting guide applies to ${profileName}: its family has none and it isn’t bound to one`} /></Group>;
  if (view.source === 'owned') return <Group title="Guide" note="This profile carries its own guidance in its JSON (prompting), which wins over any guide; edit it in the JSON view">
    <div className="profile-editor"><pre className="profile-editor-text is-readonly" aria-label="Profile Guidance">{pretty(view.owned)}</pre></div>
  </Group>;
  const meta = view.meta || null;
  return <div className="set-sections">
    <Group title="Guide" action={meta?.aiDrafted ? <GroupAction disabled={busy} onClick={() => void approve()}>Approve</GroupAction> : undefined}>
      <Row label={String((view.pack as { name?: string } | undefined)?.name || view.packId)} description={view.source === 'profile' ? 'Bound to this profile.' : 'Its family’s guide, shared with the family’s other profiles.'}>
        {meta ? <Status tone={meta.aiDrafted ? 'warn' : 'ok'}>{meta.aiDrafted ? 'AI-Drafted' : originWords[meta.origin] || meta.origin}</Status> : null}
      </Row>
      {meta ? <Row label="Version" description={[meta.by, meta.editedAt ? new Date(meta.editedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : ''].filter(Boolean).join(' · ') || undefined}>{`Version ${meta.version}`}</Row> : null}
    </Group>
    {view.readOnly ? <Group title="JSON"><Row label="Only in the Seed" description="Studio takes this guide in on its next start; then you can edit it here" /></Group> : <Group title="JSON">
      <div className="profile-editor">
        <textarea className={cn('profile-editor-text', parseError && 'is-invalid')} aria-label="Guide JSON" aria-invalid={Boolean(parseError)} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" value={text} onChange={(event) => setText(event.target.value)} />
        {parseError ? <p className="list-note is-error" role="alert">Not valid JSON: {parseError}</p> : null}
      </div>
      {dirty && !reviewing ? <div className="list-row is-static set-row set-save-row" role="group" aria-label="Unsaved Changes">
        <span className="list-row-text"><span className="list-row-label">Unsaved Changes</span><span className="list-row-detail">Review the changes before saving.</span></span>
        <span className="list-row-control">
          <button type="button" className="btn is-ghost" disabled={busy} onClick={() => setText(original)}>Discard</button>
          <button type="button" className="btn is-primary" disabled={busy || Boolean(parseError)} onClick={() => setReviewing(true)}>Review Changes</button>
        </span>
      </div> : null}
    </Group>}
    {reviewing && dirty ? <Group title="Changes">
      <div className="profile-check" role="status"><p className="is-ok"><CheckCircle2 size={14} aria-hidden="true" /> Studio checks the guides load before saving, and keeps the version this replaces.</p></div>
      <DiffView before={original} after={text} />
      <SaveRow dirty busy={busy} saveLabel="Save Guide" canSave={!parseError} onSave={() => void save()} onDiscard={() => setText(original)} note={view.source === 'family' ? 'Every profile of this family uses this guide.' : 'Saved as a new version.'} />
    </Group> : null}
    {!view.readOnly ? <VersionList title="Guide Versions" versions={versions} current={meta?.version || 0} busy={busy}
      load={async (version) => pretty((await apiJson<{ version: { pack: unknown } }>(`/api/profiles/guides/${encodeURIComponent(packId)}/versions/${version}`)).version.pack)}
      onRevert={(version) => void revert(version)} /> : null}
  </div>;
}
