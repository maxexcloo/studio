import React from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { apiJson } from './api';
import { EmptyState } from './EmptyState';
import { PickerTools } from './PickerTools';
import { Group, GroupAction, Row } from './SettingsControls';
import { CatalogueFlagsGroup, useDeploymentSettings } from './DeploymentSettings';
import { cn } from './format';
import type { ShowToast } from './toast';
import { errorText, FileStatus, folderName, post, size, SourceLinks, type Links } from './libraryShared';

/*
 * Library › LoRAs and › Models: what is installed (Installed) or catalogued
 * (Catalogue), each with its provenance, version, links and file, and
 * Updates: installed files with a newer version, found by the daily check or
 * Check Updates. An update never downloads on its own; Update downloads the
 * new file under its own name, and once it verifies the old file goes when
 * nothing uses it any more. Paid and early-access versions stay refused,
 * with the free version to update to instead. Compact PickerTools search,
 * then kind or family pills. Models also keeps the catalogue switches that
 * used to sit in Settings › Models.
 */

type Choice = { name: string; file: string; bytes?: number; downloadable: boolean; url?: string; unavailable?: { reason: string; note?: string } };
export type ItemUpdate = { state: 'available' | 'current' | 'error'; latest?: Choice; freeAlternative?: Choice; note?: string; checkedAt?: string };
export type ItemApplied = { state: 'downloading' | 'kept' | 'removed' | 'failed'; note?: string; to?: { file: string; name?: string } };
type UpdatesMeta = { checkedAt: string; available: number };

export type LibraryItem = {
  key: string; folder: string; file: string; kind: string; installed: boolean;
  title?: string; version?: string; baseModel?: string; families?: string[]; role?: 'effect' | 'acceleration' | 'supporting';
  triggers?: string[]; strength?: { default?: number; min?: number; max?: number }; note?: string; description?: string; nsfw?: boolean | null;
  links?: Links; source?: { provider: string; modelId?: number; versionId?: number; repo?: string }; origin?: string; sha256?: string; bytes?: number; aiDrafted?: boolean;
  update?: ItemUpdate; applied?: ItemApplied;
};
type View = 'installed' | 'catalogue' | 'updates';
const viewWords: Record<View, string> = { installed: 'Installed', catalogue: 'Catalogue', updates: 'Updates' };
const refusedWords: Record<string, string> = { paid: 'Paid', 'early-access': 'Early Access', licence: 'Restricted', 'no-checksum': 'No Checksum' };
const when = (value?: string) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
/** An update to offer: available, and not already on its way or done. */
export const hasUpdate = (item: LibraryItem) => item.installed && item.update?.state === 'available' && !['downloading', 'kept', 'removed'].includes(item.applied?.state || '');

const roleWords = { effect: 'Effect LoRA', acceleration: 'Acceleration Adapter', supporting: 'Supporting File' } as const;
const originWords: Record<string, string> = { seed: 'From the Seed', import: 'Imported', admin: 'Added by Hand', ai: 'AI-Drafted', chat: 'From Chat', manifest: 'From the Manifest' };
const providerWords: Record<string, string> = { civitai: 'Civitai', hf: 'Hugging Face', manifest: 'Manifest' };
const modelKinds = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'clip_vision'];

let cached: LibraryItem[] | null = null;
let cachedMeta: UpdatesMeta | null = null;
let pending: Promise<LibraryItem[]> | null = null;
/** One answer for both pages, asked again on each Library open (and on Try Again or a landed file). */
export function loadLibraryItems(fresh = false) {
  if (pending && !fresh) return pending;
  pending = apiJson<{ items: LibraryItem[]; updates?: UpdatesMeta }>('/api/library/items').then((data) => { cached = data.items; cachedMeta = data.updates || null; return data.items; }).finally(() => { pending = null; });
  return pending;
}

export function LibraryItems({ page, landed, showToast, busy = false, run, onUpdates }: {
  page: 'loras' | 'models'; landed: number; showToast: ShowToast; busy?: boolean;
  run?: (action: () => Promise<void>) => void;
  /** Update states changed: the dock's dot catches up. */
  onUpdates?: () => void;
}) {
  const [items, setItems] = React.useState<LibraryItem[] | null>(cached);
  const [meta, setMeta] = React.useState<UpdatesMeta | null>(cachedMeta);
  const [error, setError] = React.useState('');
  const [view, setView] = React.useState<View>('installed');
  const [pill, setPill] = React.useState('');
  const [query, setQuery] = React.useState('');
  const deployment = useDeploymentSettings(page === 'models');
  const load = React.useCallback((fresh = false) => {
    setError('');
    loadLibraryItems(fresh).then((next) => { setItems(next); setMeta(cachedMeta); }).catch((reason) => setError(errorText(reason, 'Couldn’t load the list')));
  }, []);
  const act = (action: () => Promise<void>) => (run ? run(action) : void action().catch((reason) => showToast(errorText(reason), 'error')));
  const checkNow = () => act(async () => {
    const result = await post<{ available: number }>('/api/library/updates/check', {});
    await loadLibraryItems(true).then((next) => { setItems(next); setMeta(cachedMeta); });
    onUpdates?.();
    showToast(result.available ? `${result.available} update${result.available === 1 ? '' : 's'} available` : 'Everything is up to date', 'success');
  });
  const update = (item: LibraryItem, alternative = false) => act(async () => {
    await post('/api/library/updates/apply', { key: item.key, alternative });
    await loadLibraryItems(true).then((next) => { setItems(next); setMeta(cachedMeta); });
    onUpdates?.();
    showToast(`${(alternative ? item.update?.freeAlternative : item.update?.latest)?.name || 'The update'} is downloading. The old file goes once it verifies and nothing uses it`, 'success');
  });
  React.useEffect(() => { load(true); }, [landed, load]);
  React.useEffect(() => { setPill(''); setQuery(''); setView('installed'); }, [page]);

  const mine = (items || []).filter((item) => page === 'loras' ? item.folder === 'loras' : modelKinds.includes(item.folder));
  const inView = mine.filter((item) => view === 'installed' ? item.installed : view === 'updates' ? hasUpdate(item) || (item.applied && item.applied.state !== 'removed' && item.installed) : Boolean(item.origin));
  const updateCount = mine.filter(hasUpdate).length;
  const views: View[] = page === 'loras' ? ['installed', 'catalogue', 'updates'] : ['installed', 'updates'];
  const pills = page === 'models'
    ? modelKinds.filter((folder) => inView.some((item) => item.folder === folder)).map((folder) => ({ id: folder, label: folderName(folder) }))
    : [...new Set(inView.flatMap((item) => item.families || []))].sort().slice(0, 8).map((family) => ({ id: family, label: family }));
  const needle = query.trim().toLowerCase();
  const visible = inView.filter((item) => (!pill || (page === 'models' ? item.folder === pill : item.families?.includes(pill)))
    && (!needle || [item.title, item.file, item.baseModel, item.version, ...(item.triggers || [])].join(' ').toLowerCase().includes(needle)));
  const label = page === 'loras' ? 'LoRAs' : 'Models';

  return <div className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">{label}</h3>
      <p>{page === 'loras' ? 'LoRAs and supporting files with where they came from. Choose acceleration through a prepared recipe; supporting files stay out of the optional LoRA picker.' : 'Checkpoints, diffusion models, text encoders and VAEs with where they came from.'}</p>
    </header>
    <PickerTools query={query} onClearSearch={() => setQuery('')} onType={(key) => setQuery((current) => current + key)} searchLabel={`Search ${label}`} className="library-tools"
      search={<label className="lora-picker-search picker-search"><Search size={14} /><input value={query} placeholder={`Search ${label}`} aria-label={`Search ${label}`} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} /></label>}>
      <div className="reference-tabs" role="group" aria-label={`${label} View`}>
        {views.map((id) => <button key={id} type="button" className={cn(view === id && 'active')} aria-pressed={view === id} onClick={() => { setView(id); setPill(''); }}>{viewWords[id]}{id === 'updates' && updateCount ? <small className="library-view-count">{updateCount}</small> : null}</button>)}
      </div>
      {pills.length > 1 ? <div className="model-filters library-pills" role="group" aria-label={page === 'models' ? 'Kind' : 'Family'}>
        <span className="model-filter-group">
          <button type="button" className={cn(!pill && 'active')} aria-pressed={!pill} onClick={() => setPill('')}>All</button>
          {pills.map((item) => <button key={item.id} type="button" className={cn(pill === item.id && 'active')} aria-pressed={pill === item.id} onClick={() => setPill(pill === item.id ? '' : item.id)}>{item.label}</button>)}
        </span>
      </div> : null}
    </PickerTools>
    {error && !items ? <EmptyState title={`Couldn’t Load ${label}`} action={<button className="btn" onClick={() => load(true)}><RefreshCw size={16} />Try Again</button>}><span role="alert">{error}</span></EmptyState>
      : items === null ? <Group><Row label={`Loading ${label}…`} /></Group>
      : view === 'updates' ? <Group className="library-items" title="Updates" action={<GroupAction disabled={busy} onClick={checkNow}>Check Updates</GroupAction>}
        note={meta?.checkedAt ? `Checked ${when(meta.checkedAt)}. Studio checks once a day and never downloads an update on its own.` : 'Studio checks once a day and never downloads an update on its own.'}>
        {visible.length ? visible.map((item) => <ItemRow key={item.key} item={item} page={page} busy={busy} onUpdate={update} updates />)
          : <EmptyState compact title={inView.length ? `No Matching ${label}` : 'Everything Is Up to Date'}>{inView.length ? 'Try a different name or filter.' : `Installed ${label.toLowerCase()} from Civitai or Hugging Face are checked for newer versions.`}</EmptyState>}
      </Group>
      : visible.length ? <Group className="library-items">{visible.map((item) => <ItemRow key={item.key} item={item} page={page} busy={busy} onUpdate={update} />)}</Group>
      : <EmptyState title={inView.length ? `No Matching ${label}` : view === 'installed' ? `No ${label} Installed` : `No ${label} Catalogued`} action={inView.length ? <button className="btn" onClick={() => { setQuery(''); setPill(''); }}>Clear Search</button> : undefined}>
        {inView.length ? 'Try a different name or filter.' : view === 'installed' ? `${label} on the workers show here.` : 'Imports and the seed catalogue show here.'}
      </EmptyState>}
    {page === 'models' && deployment.settings ? <CatalogueFlagsGroup settings={deployment.settings} showToast={showToast} onSaved={() => void deployment.refresh()} /> : null}
  </div>;
}

function ItemRow({ item, page, busy, onUpdate, updates = false }: { item: LibraryItem; page: 'loras' | 'models'; busy: boolean; onUpdate: (item: LibraryItem, alternative?: boolean) => void; updates?: boolean }) {
  const name = item.title || item.file;
  const available = hasUpdate(item);
  const latest = item.update?.latest;
  const free = item.update?.freeAlternative;
  const refused = latest?.unavailable;
  const what = page === 'loras' ? item.role ? roleWords[item.role] : 'LoRA · Role Unknown' : folderName(item.folder);
  const provenance = [item.source?.provider ? providerWords[item.source.provider] : '', item.origin ? originWords[item.origin] || item.origin : '', item.aiDrafted ? 'AI-Drafted' : '', item.nsfw ? 'NSFW' : ''].filter(Boolean).join(' · ');
  return <Row className="library-item" label={<span className="library-item-title">{name}</span>} description={<>
    <span className="library-line">{[what, item.version, item.baseModel, size(item.bytes)].filter(Boolean).join(' · ')}</span>
    {provenance ? <span className="library-line">{provenance}</span> : null}
    {item.triggers?.length ? <span className="library-line">Trigger Words: {item.triggers.join(', ')}{Number.isFinite(item.strength?.default) ? ` · Strength ${item.strength!.default}` : ''}</span> : Number.isFinite(item.strength?.default) ? <span className="library-line">Strength {item.strength!.default}</span> : null}
    <code className="set-path library-line">{item.key}</code>
    {item.note ? <span className="library-line">{item.note}</span> : null}
    {available && latest ? <span className="library-line library-update-line">Update Available: {latest.name}{latest.bytes ? ` · ${size(latest.bytes)}` : ''}{refused ? ` · ${refusedWords[refused.reason] || 'Unavailable'}: ${refused.note || ''}` : ''}{free ? ` · ${free.name} is free` : ''}</span> : null}
    {item.applied && (updates || item.applied.state !== 'removed') ? <span className={cn('library-line', item.applied.state === 'failed' && 'library-error')}>{item.applied.note}</span> : null}
  </>}>
    <SourceLinks links={item.links} label={name} />
    {updates && available && latest?.downloadable ? <button type="button" className="btn is-sm" disabled={busy} aria-label={`Update ${name} to ${latest.name}`} onClick={() => onUpdate(item)}><Download size={14} />Update</button> : null}
    {updates && available && !latest?.downloadable && free?.downloadable ? <button type="button" className="btn is-sm" disabled={busy} aria-label={`Update ${name} to ${free.name}`} onClick={() => onUpdate(item, true)}><Download size={14} />Update to {free.name}</button> : null}
    {item.applied?.state === 'downloading' ? <FileStatus status="downloading">Updating…</FileStatus>
      : available ? <FileStatus status="update">Update Available</FileStatus>
        : <FileStatus status={item.installed ? 'installed' : 'missing'}>{item.installed ? 'Installed' : 'Not Installed'}</FileStatus>}
  </Row>;
}
