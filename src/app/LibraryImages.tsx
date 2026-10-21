import React from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Image, RefreshCw, Search, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import { apiJson } from './api';
import { SafeImg } from './SafeImg';
import { ListSelect } from './SheetList';
import { cn } from './format';
import { presetFit, type ImagePreset, type PresetResource } from './presets';
import type { ModelDownload, Models, Profile } from './types';
import type { ShowToast } from './toast';
import { EmptyState } from './EmptyState';
import { Group, GroupAction, Row } from './SettingsControls';
import { FileStatus, GradeChip, LibraryFooter, percent, post, size, type Grade } from './libraryShared';

/*
 * Library › Images: the saved Civitai images as an even 4:5 grid, each with
 * its grade (Exact, Close or Partial) and how many files it still needs. A
 * card opens its review in place; Back returns to the grid. Use Prompt and
 * Use Settings sit in the footer.
 */

export type Access = { available: boolean; backend: string; note: string };
export type GradedPreset = ImagePreset & { grade?: Grade };
const NO_MODEL = 'none';
const missingCount = (preset: ImagePreset) => preset.resources.filter((item) => item.status === 'missing' || item.status === 'conflict').length;

// The last list, so reopening shows it at once while a fresh copy loads.
let lastPresets: GradedPreset[] | null = null;
let lastAccess: Access | null = null;

export function LibraryImages({ models, refreshModels, onApply, onPrompt, onClose, showToast, downloads, landed, busy, run, open: openId, onOpened, onImport, onCount }: {
  models: Models | null; refreshModels: (notify?: boolean) => Promise<unknown>;
  onApply: (preset: ImagePreset, profile: Profile) => void; onPrompt: (preset: ImagePreset) => void; onClose: () => void;
  showToast: ShowToast; downloads: ModelDownload[]; landed: number; busy: boolean; run: (action: () => Promise<void>) => void;
  /** A saved image to open as soon as the list has it (from Import). */
  open?: string; onOpened?: () => void; onImport: () => void; onCount?: (count: number) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [saved, setSaved] = React.useState<GradedPreset[]>(() => lastPresets || []);
  const [selected, setSelected] = React.useState<GradedPreset | null>(null);
  const [profileId, setProfileId] = React.useState('');
  const [access, setAccess] = React.useState<Access | null>(lastAccess);
  const [loading, setLoading] = React.useState(!lastPresets);
  const [loadError, setLoadError] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const mounted = React.useRef(true);
  const root = React.useRef<HTMLDivElement>(null);

  const keep = (next: GradedPreset[]) => { lastPresets = next; onCount?.(next.length); return next; };
  const load = async () => {
    setLoadError('');
    try {
      const data = await apiJson<{ presets: GradedPreset[]; downloads: Access }>('/api/presets');
      if (!mounted.current) return;
      lastAccess = data.downloads;
      setSaved(keep(data.presets)); setAccess(data.downloads);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : 'Couldn’t load the saved images');
    } finally { if (mounted.current) setLoading(false); }
  };
  const select = (preset: GradedPreset) => {
    setSelected(preset);
    setProfileId(preset.resources.find((item) => item.profileId)?.profileId || (!preset.resources.some((item) => ['checkpoints', 'diffusion_models'].includes(item.folder || '')) ? preset.type === 'video' ? models?.defaults.videoModel : models?.defaults.imageModel : '') || '');
    root.current?.closest('.set-panel')?.scrollTo({ top: 0 });
  };
  const resolve = async (id: string) => {
    const data = await post<{ preset: GradedPreset }>('/api/presets/resolve', { id });
    if (mounted.current) setSaved((current) => keep(current.map((preset) => preset.id === id ? data.preset : preset)));
    if (mounted.current && selectedRef.current?.id === id) {
      setSelected(data.preset);
      setProfileId((current) => current || data.preset.resources.find((item) => item.profileId)?.profileId || '');
    }
    return data.preset;
  };
  const open = (preset: GradedPreset) => {
    select(preset);
    setChecking(true);
    // Opening one image checks its files in full (the list only compares names and sizes).
    void resolve(preset.id).catch(() => { /* Keep the list's answer. */ }).finally(() => { if (mounted.current) setChecking(false); });
  };
  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from Import: the image is in the list once the list has loaded.
  React.useEffect(() => {
    if (!openId || loading) return;
    const preset = saved.find((item) => item.id === openId);
    if (preset) { open(preset); onOpened?.(); }
    else void load().then(() => undefined);
  }, [openId, loading, saved.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A file landed: check the open image again.
  React.useEffect(() => {
    if (landed && selectedRef.current) void resolve(selectedRef.current.id).catch(() => undefined);
  }, [landed]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = query.trim().toLowerCase();
  const visible = saved.filter((preset) => [preset.name, preset.prompt, preset.baseModel, preset.creator].join(' ').toLowerCase().includes(needle));
  const profiles = (models?.profiles || []).filter((item) => item.kind === (selected?.type || 'image'));
  const profile = profiles.find((item) => item.id === profileId);
  const fit = selected ? presetFit(selected, profile) : null;
  const pending = downloads.filter((item) => ['queued', 'downloading'].includes(item.status));
  const matchesDownload = (id: string, versionId: number | string) => id === versionId || id.startsWith(`civitai:${versionId}:`);
  const downloadFor = (resource: PresetResource) => downloads.find((item) => matchesDownload(item.id, resource.versionId));
  const activeFor = (versionId: number | string) => pending.some((item) => matchesDownload(item.id, versionId));
  const missing = selected?.resources.filter((item) => item.status === 'missing' && item.supported && !activeFor(item.versionId)) || [];
  const resourceStatus = (resource: PresetResource) => {
    if (resource.status === 'installed') return resource.nameOnly ? 'Found By Filename' : 'Installed';
    if (resource.unavailable) return 'Unavailable';
    const download = downloadFor(resource);
    if (download?.status === 'queued') return 'Queued';
    if (download?.status === 'downloading') return download.totalBytes ? `Downloading ${percent(download)}%` : 'Downloading…';
    if (download && ['error', 'paused', 'canceled'].includes(download.status)) return download.status === 'error' ? 'Download Failed' : download.status === 'paused' ? 'Paused' : 'Cancelled';
    return resource.status === 'conflict' ? 'Filename Conflict' : resource.status === 'unsupported' ? 'Needs Review' : 'Missing';
  };
  const state = !selected ? '' : !selected.galleryItemId ? 'Not Saved Yet' : selected.resources.some((resource) => activeFor(resource.versionId)) ? 'Downloading Models' : fit?.blockers.length ? 'Needs Review' : 'Ready To Use';
  const installed = selected?.resources.filter((resource) => resource.status === 'installed').length || 0;
  const remove = (preset: ImagePreset) => run(async () => {
    await apiJson(`/api/presets/${preset.id}`, { method: 'DELETE' });
    setSaved((current) => keep(current.filter((item) => item.id !== preset.id)));
    setSelected(null);
    showToast('Image deleted', 'removed');
  });
  const downloadMissing = () => run(async () => {
    for (const resource of missing) {
      if (typeof resource.versionId === 'number') await post('/api/library/downloads', { versionId: resource.versionId });
      else if (resource.sourceUrl && resource.folder) {
        const result = await post<{ file: { id: string } }>('/api/library/downloads/preview', { url: resource.sourceUrl, folder: resource.folder });
        await post('/api/library/downloads', { id: result.file.id });
      }
    }
    showToast(missing.length === 1 ? 'Missing file queued' : `${missing.length} missing files queued`, 'success');
  });
  const offline = access && !access.available && access.note ? <p className="set-note">{access.note}</p> : null;

  if (selected) return <div ref={root} className="library-page">
    <LibraryFooter>
      {missing.length ? <button className="btn" disabled={busy || access?.available === false} onClick={downloadMissing}><Download size={16} />Download Missing</button> : null}
      <button className="btn" disabled={busy || !selected.prompt} onClick={() => { onPrompt(selected); onClose(); }}><Wand2 size={15} />Use Prompt</button>
      <button className="btn is-primary" disabled={busy || Boolean(fit?.blockers.length) || !profile} onClick={() => { if (profile) { onApply(selected, profile); onClose(); } }}><SlidersHorizontal size={16} />Use Settings</button>
    </LibraryFooter>
    <div className="library-review-bar">
      <button type="button" className="btn is-ghost library-back" disabled={busy} onClick={() => setSelected(null)}><ArrowLeft size={16} />Images</button>
      <div className="library-review-actions">
        <a className="btn is-ghost library-icon" href={selected.sourceUrl} target="_blank" rel="noreferrer" aria-label="View on Civitai" title="View on Civitai"><ExternalLink size={16} /></a>
        <button type="button" className="btn is-ghost library-icon is-danger" disabled={busy} aria-label="Delete Saved Image" title="Delete Saved Image" onClick={() => remove(selected)}><Trash2 size={16} /></button>
      </div>
    </div>
    <div className="library-review">
      <figure className="library-preview">
        {selected.type === 'video' && selected.galleryItemId ? <video src={`/api/presets/${selected.id}/media`} controls autoPlay muted playsInline loop /> : <SafeImg src={selected.thumbnailUrl} alt="Source image" fallback={<Image size={40} />} />}
      </figure>
      <div className="library-recipe">
        <header className="set-page-head">
          <h3 id="library-panel-title">{selected.name}</h3>
          <p>{[selected.baseModel, selected.creator && `by ${selected.creator}`].filter(Boolean).join(' · ') || 'Civitai'}</p>
        </header>
        <p className={cn('library-state', state === 'Ready To Use' ? 'is-ready' : 'is-pending')} role="status">
          {state === 'Ready To Use' ? <Check size={14} /> : null}<strong>{state}</strong>
          <span>{installed} of {selected.resources.length} model files installed{checking ? ' · Checking…' : ''}</span>
        </p>
        {selected.grade ? <section className="library-grade-block" aria-label="Grade">
          <GradeChip grade={selected.grade} />
          <ul className="set-note library-notes">{selected.grade.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section> : null}
        <section className="library-prompt"><h4 className="list-section-title">Prompt</h4><p>{selected.prompt || 'No prompt was included.'}</p></section>
        {selected.negative ? <section className="library-prompt"><h4 className="list-section-title">Negative Prompt</h4><p>{selected.negative}</p></section> : null}
        <dl className="library-settings">{Object.entries(selected.settings).map(([key, value]) => <div key={key}><dt>{key === 'cfg' ? 'CFG' : key === 'fps' ? 'FPS' : key[0].toUpperCase() + key.slice(1)}</dt><dd>{value}</dd></div>)}</dl>
      </div>
    </div>

    <Group title="Use With">
      <Row label="Model" description="The source model is picked when it’s installed; another model may change the result">
        <span className="library-model-choice">
          <ListSelect label="Use With Model" value={profileId || NO_MODEL} onChange={(value) => setProfileId(value === NO_MODEL ? '' : value)}
            options={[{ value: NO_MODEL, label: 'Choose a Model' }, ...profiles.map((candidate) => ({ value: candidate.id, label: `${candidate.displayName || candidate.label}${candidate.ready === false ? ' · Setup Required' : ''}` }))]} />
        </span>
      </Row>
    </Group>
    {fit?.warnings.length ? <ul className="set-note library-notes">{fit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {fit?.blockers.length ? <ul className="set-note library-notes is-blocking">{fit.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}

    <Group title="Files" action={<GroupAction disabled={busy} onClick={() => run(async () => { await refreshModels(false); await resolve(selected.id); })}>Check Again</GroupAction>}>
      {selected.resources.length ? selected.resources.map((resource) => {
        const download = downloadFor(resource);
        const moving = download && ['queued', 'downloading'].includes(download.status) && resource.status !== 'installed';
        return <Row className="library-resource" key={resource.versionId} label={resource.name} description={<>
          <span className="library-line">{[resource.type, resource.version, resource.weight !== null && resource.folder === 'loras' ? `Weight ${resource.weight}` : '', size(resource.bytes)].filter(Boolean).join(' · ')}</span>
          {resource.unavailable ? <span className="library-line">{resource.unavailable.note || resource.note}</span> : resource.note ? <span className="library-line">{resource.note}</span> : null}
          {moving ? <span className="set-progress" aria-hidden="true"><span style={{ width: `${percent(download)}%` }} /></span> : null}
        </>}>
          <FileStatus status={resource.unavailable ? 'unavailable' : resource.status || 'missing'}>{resourceStatus(resource)}</FileStatus>
        </Row>;
      }) : <EmptyState compact title="No Model Files Listed">The source didn’t name its models.</EmptyState>}
    </Group>
    {selected.downloadWarnings?.length ? <ul className="set-note library-notes is-blocking">{selected.downloadWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {offline}
    {!selected.galleryItemId ? <button type="button" className="btn library-save-legacy" disabled={busy} onClick={() => run(async () => { const data = await post<{ preset: GradedPreset }>('/api/presets/import', { url: selected.sourceUrl }); select(data.preset); setSaved((current) => keep([data.preset, ...current.filter((preset) => preset.id !== data.preset.id)])); })}><Download size={16} />Save to Gallery</button> : null}
  </div>;

  return <div ref={root} className="library-page">
    <header className="set-page-head">
      <h3 id="library-panel-title">Images</h3>
      <p>Saved Civitai images with their prompt and settings, graded by how closely they can be recreated.</p>
    </header>
    {saved.length > 1 ? <label className="library-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label="Search Images" placeholder="Search Images" value={query} onChange={(event) => setQuery(event.target.value)} />
    </label> : null}
    {loading ? <div className="library-grid" aria-busy="true" aria-label="Loading Images">{Array.from({ length: 8 }, (_, index) => <span key={index} className="library-card is-skeleton"><span className="library-card-image" /><span className="library-card-text"><i /><i /></span></span>)}</div>
      : loadError && !saved.length ? <EmptyState title="Couldn’t Load Images" action={<button className="btn" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16} />Try Again</button>}><span role="alert">{loadError}</span></EmptyState>
      : visible.length ? <div className="library-grid">{visible.map((preset) => {
        const count = missingCount(preset);
        return <button type="button" className="library-card" disabled={busy} key={preset.id} onClick={() => open(preset)}>
          <span className="library-card-image"><SafeImg src={preset.thumbnailUrl} loading="lazy" decoding="async" fallback={<Image size={24} />} />{preset.grade ? <GradeChip grade={preset.grade} count={count} className="library-card-badge" /> : count ? <small className="library-card-badge">{count} Missing</small> : null}</span>
          <span className="library-card-text"><strong>{preset.name}</strong><small>{[preset.baseModel, preset.creator && `by ${preset.creator}`].filter(Boolean).join(' · ') || 'Civitai'}</small></span>
        </button>;
      })}</div>
      : <EmptyState title={saved.length ? 'No Matching Images' : 'No Images Yet'} action={saved.length ? <button className="btn" onClick={() => setQuery('')}>Clear Search</button> : <button className="btn" onClick={onImport}>Import</button>}>{saved.length ? 'Try a different name, model or creator.' : 'Paste a Civitai image link in Import to save its image, prompt and settings.'}</EmptyState>}
  </div>;
}
