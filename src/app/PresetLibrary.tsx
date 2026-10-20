import React from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Image, Link, RefreshCw, Search, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import { apiJson } from './api';
import { Modal } from './Modal';
import { SafeImg } from './SafeImg';
import { ListSelect } from './SheetList';
import { usePhone } from './device';
import { cn } from './format';
import { useHistoryDismiss } from './useHistoryDismiss';
import { presetFit, type ImagePreset, type PresetResource } from './presets';
import type { ModelDownload, Models, Profile } from './types';
import type { ShowToast } from './toast';
import type { ConfirmAction } from './useConfirmation';
import { EmptyState } from './EmptyState';

/*
 * The Image & Model Library (UI-PATTERNS › Library): the Settings panel's
 * anatomy, with two sections. Saved Images is a grid of Civitai imports, each
 * opening its review in place (Back returns to the grid); Download Models takes
 * a model or LoRA link and lists the downloads with one progress style.
 * Messages go to the status pill; the panel only says what is on it.
 */

type Access = { available: boolean; backend: string; note: string };
type ModelFile = { id: string; file: string; folder: string; label: string; bytes: number };
type Section = 'images' | 'models';
const post = <T,>(url: string, body: object) => apiJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const size = (bytes?: number) => bytes ? `${(bytes / 1e9).toFixed(2)} GB` : '';
const NO_MODEL = 'none';
const FOLDERS: Record<string, string> = { checkpoints: 'Checkpoints', clip_vision: 'CLIP Vision', diffusion_models: 'Diffusion Models', loras: 'LoRAs', text_encoders: 'Text Encoders', unet: 'Diffusion Models', vae: 'VAE' };
const folderName = (folder?: string) => folder ? FOLDERS[folder] || folder : '';
const percent = (item: ModelDownload) => item.totalBytes ? Math.min(100, Math.round(item.receivedBytes / item.totalBytes * 100)) : 0;
const downloadWords = (item: ModelDownload) => item.status === 'downloading' ? item.totalBytes ? `${percent(item)}%` : 'Downloading…'
  : item.status === 'done' ? 'Done' : item.status === 'error' ? 'Failed' : item.status === 'canceled' ? 'Cancelled' : item.status === 'paused' ? 'Paused' : 'Queued';
const missingCount = (preset: ImagePreset) => preset.resources.filter((item) => item.status === 'missing' || item.status === 'conflict').length;

// The last list, so reopening shows it at once while a fresh copy loads.
let lastPresets: ImagePreset[] | null = null;
let lastAccess: Access | null = null;

export function PresetLibrary({ onClose, models, refreshModels, onApply, onPrompt, showToast, confirmAction }: {
  onClose: () => void; models: Models | null; refreshModels: (notify?: boolean) => Promise<unknown>;
  onApply: (preset: ImagePreset, profile: Profile) => void; onPrompt: (preset: ImagePreset) => void;
  showToast: ShowToast; confirmAction: ConfirmAction;
}) {
  const phone = usePhone();
  const [section, setSection] = React.useState<Section>('images');
  const [query, setQuery] = React.useState('');
  const [saved, setSaved] = React.useState<ImagePreset[]>(() => lastPresets || []);
  const [selected, setSelected] = React.useState<ImagePreset | null>(null);
  const [url, setUrl] = React.useState('');
  const [modelUrl, setModelUrl] = React.useState('');
  const [folder, setFolder] = React.useState('loras');
  const [file, setFile] = React.useState<ModelFile | null>(null);
  const [profileId, setProfileId] = React.useState('');
  const [access, setAccess] = React.useState<Access | null>(lastAccess);
  const [downloads, setDownloads] = React.useState<ModelDownload[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [loading, setLoading] = React.useState(!lastPresets);
  const [loadError, setLoadError] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const mounted = React.useRef(true);
  const running = React.useRef(false);
  const panel = React.useRef<HTMLDivElement>(null);
  useHistoryDismiss(true, onClose);

  const keep = (next: ImagePreset[]) => { lastPresets = next; return next; };
  const load = async () => {
    setLoadError('');
    try {
      const data = await apiJson<{ presets: ImagePreset[]; downloads: Access }>('/api/presets');
      if (!mounted.current) return;
      lastAccess = data.downloads;
      setSaved(keep(data.presets)); setAccess(data.downloads);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : 'Couldn’t load the saved images');
    } finally { if (mounted.current) setLoading(false); }
  };
  const select = (preset: ImagePreset) => {
    setSelected(preset);
    setProfileId(preset.resources.find((item) => item.profileId)?.profileId || (!preset.resources.some((item) => ['checkpoints', 'diffusion_models'].includes(item.folder || '')) ? preset.type === 'video' ? models?.defaults.videoModel : models?.defaults.imageModel : '') || '');
    panel.current?.scrollTo({ top: 0 });
  };
  const resolve = async (id: string) => {
    const data = await post<{ preset: ImagePreset }>('/api/presets/resolve', { id });
    if (mounted.current) setSaved((current) => keep(current.map((preset) => preset.id === id ? data.preset : preset)));
    if (mounted.current && selectedRef.current?.id === id) {
      setSelected(data.preset);
      setProfileId((current) => current || data.preset.resources.find((item) => item.profileId)?.profileId || '');
    }
    return data.preset;
  };
  // One action at a time; a failure goes to the status pill, which says what happened.
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await action(); } catch (error) { if (mounted.current) showToast(error instanceof Error ? error.message : 'Something went wrong. Try again.', 'error'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const open = (preset: ImagePreset) => {
    select(preset);
    setChecking(true);
    // Opening one image checks its files in full (the list only compares names and sizes).
    void resolve(preset.id).catch(() => { /* Keep the list's answer. */ }).finally(() => { if (mounted.current) setChecking(false); });
  };
  React.useEffect(() => {
    mounted.current = true;
    void load();
    let timer = 0;
    const seen = new Set<string>();
    let initial = true;
    const poll = async () => {
      try {
        const data = await apiJson<{ downloads: ModelDownload[]; access: Access }>('/api/library/downloads');
        if (!mounted.current) return;
        setDownloads(data.downloads); setAccess(data.access);
        const landed = data.downloads.filter((item) => item.status === 'done' && !seen.has(`${item.id}:${item.finishedAt}`));
        if (landed.length && !initial) {
          await refreshModels(false);
          if (!mounted.current) return;
          if (selectedRef.current) await resolve(selectedRef.current.id);
          showToast('Models refreshed', 'success');
        }
        for (const item of landed) seen.add(`${item.id}:${item.finishedAt}`);
        initial = false;
      } catch { /* Keep the library usable through a short reconnection. */ }
      if (mounted.current) timer = window.setTimeout(poll, document.hidden ? 10000 : 3000);
    };
    void poll();
    return () => { mounted.current = false; window.clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const download = downloadFor(resource);
    if (download?.status === 'queued') return 'Queued';
    if (download?.status === 'downloading') return download.totalBytes ? `Downloading ${percent(download)}%` : 'Downloading…';
    if (download && ['error', 'paused', 'canceled'].includes(download.status)) return download.status === 'error' ? 'Download Failed' : download.status === 'paused' ? 'Paused' : 'Cancelled';
    return resource.status === 'conflict' ? 'Filename Conflict' : resource.status === 'unsupported' ? 'Needs Review' : 'Missing';
  };
  const state = !selected ? '' : !selected.galleryItemId ? 'Not Saved Yet' : selected.resources.some((resource) => activeFor(resource.versionId)) ? 'Downloading Models' : fit?.blockers.length ? 'Needs Review' : 'Ready To Use';
  const installed = selected?.resources.filter((resource) => resource.status === 'installed').length || 0;
  const importingImage = async () => {
    setImporting(true);
    try {
      const data = await post<{ preset: ImagePreset }>('/api/presets/import', { url });
      select(data.preset); setUrl('');
      setSaved((current) => keep([data.preset, ...current.filter((preset) => preset.id !== data.preset.id)]));
      showToast(data.preset.downloadWarnings?.length ? 'Image saved. Check its missing model files' : 'Image saved to your gallery', data.preset.downloadWarnings?.length ? 'warning' : 'success');
    } finally { if (mounted.current) setImporting(false); }
  };
  const remove = (preset: ImagePreset) => void run(async () => {
    if (!await confirmAction({ title: 'Delete Image?', description: 'It leaves your gallery too. Its downloaded models stay in the library.', action: 'Delete', destructive: true })) return;
    await apiJson(`/api/presets/${preset.id}`, { method: 'DELETE' });
    setSaved((current) => keep(current.filter((item) => item.id !== preset.id)));
    setSelected(null);
    showToast('Image deleted', 'removed');
  });
  const retryMissing = () => void run(async () => {
    for (const resource of missing) {
      if (typeof resource.versionId === 'number') await post('/api/library/downloads', { versionId: resource.versionId });
      else if (resource.sourceUrl && resource.folder) {
        const result = await post<{ file: ModelFile }>('/api/library/downloads/preview', { url: resource.sourceUrl, folder: resource.folder });
        await post('/api/library/downloads', { id: result.file.id });
      }
    }
    showToast('Missing files queued', 'success');
  });
  const huggingFace = /^https:\/\/(?:www\.)?huggingface\.co\//i.test(modelUrl);
  const sections: Array<{ id: Section; label: string; icon: typeof Image; count?: number }> = [
    { id: 'images', label: 'Saved Images', icon: Image, count: saved.length || undefined },
    { id: 'models', label: 'Models', icon: Download, count: pending.length || undefined },
  ];
  const offline = access && !access.available && access.note ? <p className="set-note">{access.note}</p> : null;

  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" title="Image & Model Library" className="settings-modal library-modal" bodyClassName="set-layout" busy={busy}
    footer={selected && section === 'images' ? <>
      <button className="btn" disabled={busy || !selected.prompt} onClick={() => { onPrompt(selected); onClose(); }}><Wand2 size={15} />Use Prompt</button>
      <button className="btn is-primary" disabled={busy || Boolean(fit?.blockers.length) || !profile} onClick={() => { if (profile) { onApply(selected, profile); onClose(); } }}><SlidersHorizontal size={15} />Use Settings</button>
    </> : undefined}>
    <nav className="set-nav" aria-label="Library Sections">
      {sections.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} aria-controls="library-panel" data-section={item.id} disabled={busy} onClick={() => { setSection(item.id); setSelected(null); }}>
          <Icon size={15} /><span>{item.label}</span>{item.count ? <small className="library-nav-count">{item.count}</small> : null}
        </button>;
      })}
    </nav>

    <div className="set-panel library-panel" ref={panel} key={section} id="library-panel" role="region" aria-labelledby="library-panel-title" data-library-ready={loading ? undefined : ''}>
      {section === 'images' && selected ? <>
        <div className="library-review-bar">
          <button type="button" className="btn is-ghost library-back" disabled={busy} onClick={() => setSelected(null)}><ArrowLeft size={15} />Saved Images</button>
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
            <section className="library-prompt"><h4 className="set-group-title">Prompt</h4><p>{selected.prompt || 'No prompt was included.'}</p></section>
            {selected.negative ? <section className="library-prompt"><h4 className="set-group-title">Negative Prompt</h4><p>{selected.negative}</p></section> : null}
            <dl className="library-settings">{Object.entries(selected.settings).map(([key, value]) => <div key={key}><dt>{key === 'cfg' ? 'CFG' : key === 'fps' ? 'FPS' : key[0].toUpperCase() + key.slice(1)}</dt><dd>{value}</dd></div>)}</dl>
          </div>
        </div>

        <section className="set-group">
          <h4 className="set-group-title">Use With</h4>
          <div className="set-card">
            <div className="set-row">
              <div className="set-row-text"><strong>Model</strong><span>The source model is picked when it is installed. Another model may change the result.</span></div>
              <div className="set-row-control library-model-choice">
                <ListSelect native={phone} label="Use With Model" value={profileId || NO_MODEL} onChange={(value) => setProfileId(value === NO_MODEL ? '' : value)}
                  options={[{ value: NO_MODEL, label: 'Choose a Model' }, ...profiles.map((candidate) => ({ value: candidate.id, label: `${candidate.displayName || candidate.label}${candidate.ready === false ? ' · Setup Required' : ''}` }))]} />
              </div>
            </div>
          </div>
          {fit?.warnings.length ? <ul className="set-note library-notes">{fit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
          {fit?.blockers.length ? <ul className="set-note library-notes is-blocking">{fit.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        </section>

        <section className="set-group">
          <div className="library-group-head">
            <h4 className="set-group-title">Models & LoRAs</h4>
            <div className="library-group-actions">
              {missing.length ? <button type="button" className="btn is-sm" disabled={busy} onClick={retryMissing}><Download size={14} />Retry Missing Files</button> : null}
              <button type="button" className="btn is-sm is-ghost" disabled={busy} onClick={() => void run(async () => { await refreshModels(false); await resolve(selected.id); })}><RefreshCw size={14} />Check Again</button>
            </div>
          </div>
          {selected.resources.length ? <div className="set-card">{selected.resources.map((resource) => {
            const download = downloadFor(resource);
            const moving = download && ['queued', 'downloading'].includes(download.status) && resource.status !== 'installed';
            return <div className="set-row library-resource" key={resource.versionId}>
              <div className="set-row-text">
                <strong>{resource.name}</strong>
                <span>{[resource.type, resource.version, resource.weight !== null && resource.folder === 'loras' ? `Weight ${resource.weight}` : '', size(resource.bytes)].filter(Boolean).join(' · ')}</span>
                {resource.note ? <span>{resource.note}</span> : null}
                {moving ? <div className="set-progress" aria-hidden="true"><div style={{ width: `${percent(download)}%` }} /></div> : null}
              </div>
              <span className={cn('library-status', `is-${resource.status}`)}>{resource.status === 'installed' ? <Check size={14} /> : null}{resourceStatus(resource)}</span>
            </div>;
          })}</div> : <EmptyState compact title="No Model Files Listed">The source didn’t name its models.</EmptyState>}
          {selected.downloadWarnings?.length ? <ul className="set-note library-notes is-blocking">{selected.downloadWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
          {missing.length ? <p className="set-note">Missing files queue on their own when an image is saved.</p> : null}
          {offline}
        </section>
        {!selected.galleryItemId ? <button type="button" className="btn library-save-legacy" disabled={busy} onClick={() => void run(async () => { const data = await post<{ preset: ImagePreset }>('/api/presets/import', { url: selected.sourceUrl }); select(data.preset); setSaved((current) => keep([data.preset, ...current.filter((preset) => preset.id !== data.preset.id)])); })}><Download size={15} />Save to Gallery</button> : null}
      </> : null}

      {section === 'images' && !selected ? <>
        <header className="set-page-head">
          <h3 id="library-panel-title">Saved Images</h3>
          <p>Civitai images with their prompt and settings, to start from. Missing models & LoRAs download on their own.</p>
        </header>
        <form className="library-link" onSubmit={(event) => { event.preventDefault(); void run(importingImage); }}>
          <label className="sr-only" htmlFor="civitai-image-link">Image Link</label>
          <input id="civitai-image-link" type="url" placeholder="Paste a Civitai image link" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="off" />
          <button className={cn('btn', url.trim() && 'is-primary')} disabled={busy || !url.trim()}><Link size={15} />{importing ? 'Saving…' : 'Save Image'}</button>
        </form>
        {importing ? <p className="set-note" role="status">Importing image: reading its settings, saving the original and checking its model files.</p> : null}
        {saved.length > 1 ? <label className="library-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label="Search Saved Images" placeholder="Search Saved Images" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label> : null}
        {loading ? <div className="library-grid" aria-busy="true" aria-label="Loading Saved Images">{Array.from({ length: 8 }, (_, index) => <span key={index} className="library-card is-skeleton"><span className="library-card-image" /><span className="library-card-text"><i /><i /></span></span>)}</div>
          : loadError && !saved.length ? <EmptyState title="Couldn’t Load Saved Images" action={<button className="btn" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={15} />Try Again</button>}><span role="alert">{loadError}</span></EmptyState>
          : visible.length ? <div className="library-grid">{visible.map((preset) => {
            const count = missingCount(preset);
            return <button type="button" className="library-card" disabled={busy} key={preset.id} onClick={() => open(preset)}>
              <span className="library-card-image"><SafeImg src={preset.thumbnailUrl} loading="lazy" decoding="async" fallback={<Image size={24} />} />{count ? <small className="library-card-badge">{count} Missing</small> : null}</span>
              <span className="library-card-text"><strong>{preset.name}</strong><small>{[preset.baseModel, preset.creator && `by ${preset.creator}`].filter(Boolean).join(' · ') || 'Civitai'}</small></span>
            </button>;
          })}</div>
          : <EmptyState title={saved.length ? 'No Matching Images' : 'No Saved Images Yet'} action={saved.length ? <button className="btn" onClick={() => setQuery('')}>Clear Search</button> : undefined}>{saved.length ? 'Try a different name, model or creator.' : 'Paste a Civitai image link to save its image, prompt and settings.'}</EmptyState>}
      </> : null}

      {section === 'models' ? <>
        <header className="set-page-head">
          <h3 id="library-panel-title">Download Models</h3>
          <p>Add a model or LoRA to the shared library from Civitai or Hugging Face. Check the file and where it goes, then download it.</p>
        </header>
        <form className="library-link" onSubmit={(event) => { event.preventDefault(); void run(async () => { const data = await post<{ file: ModelFile }>('/api/library/downloads/preview', { url: modelUrl, folder }); setFile(data.file); }); }}>
          <label className="sr-only" htmlFor="model-download-link">Model Or LoRA Link</label>
          <input id="model-download-link" disabled={busy} type="url" value={modelUrl} onChange={(event) => { setModelUrl(event.target.value); setFile(null); }} placeholder="Paste a Civitai model or Hugging Face file link" required autoComplete="off" />
          <button className="btn" disabled={busy || !modelUrl.trim()}><Search size={15} />Preview Download</button>
        </form>
        {huggingFace ? <section className="set-group"><div className="set-card"><div className="set-row">
          <div className="set-row-text"><strong>Destination</strong><span>Hugging Face links name a SafeTensors or GGUF file; choose its folder.</span></div>
          <div className="set-row-control library-model-choice"><ListSelect native={phone} label="Hugging Face Destination" value={folder} onChange={(value) => { setFolder(value); setFile(null); }}
            options={['checkpoints', 'clip_vision', 'diffusion_models', 'loras', 'text_encoders', 'vae'].map((value) => ({ value, label: FOLDERS[value] }))} /></div>
        </div></div></section> : <p className="set-note">Civitai models choose their folder on their own.</p>}
        {file ? <section className="set-group"><h4 className="set-group-title">Ready to Download</h4><div className="set-card"><div className="set-row">
          <div className="set-row-text"><strong>{file.file}</strong><span>{[folderName(file.folder), size(file.bytes)].filter(Boolean).join(' · ')}</span></div>
          <div className="set-row-control"><button type="button" className="btn is-primary" disabled={busy || !access?.available || pending.some((item) => item.id === file.id)} onClick={() => void run(async () => { await post('/api/library/downloads', { id: file.id }); setFile(null); setModelUrl(''); showToast('Download queued', 'success'); })}><Download size={15} />Download</button></div>
        </div></div></section> : null}
        {offline}
        <section className="set-group">
          <h4 className="set-group-title">Downloads</h4>
          {downloads.length ? <div className="set-card">{downloads.slice(-12).reverse().map((item) => <div className="set-row library-download" key={`${item.id}:${item.finishedAt || item.status}`}>
            <div className="set-row-text">
              <strong>{item.file}</strong>
              <span>{[folderName(item.folder), item.totalBytes ? size(item.totalBytes) : ''].filter(Boolean).join(' · ')}</span>
              {item.status === 'downloading' ? <div className="set-progress" aria-hidden="true"><div style={{ width: `${percent(item)}%` }} /></div> : null}
              {item.error ? <span className="library-error" role="alert">{item.error}</span> : null}
            </div>
            <div className="set-row-control">
              <span className={cn('library-status', `is-${item.status}`)}>{item.status === 'done' ? <Check size={14} /> : null}{downloadWords(item)}</span>
              {['error', 'paused', 'canceled'].includes(item.status) && item.retryable !== false ? <button type="button" className="btn is-sm" disabled={busy} onClick={() => void run(async () => { await post('/api/library/downloads', { id: item.id }); })}><RefreshCw size={14} />Retry</button> : null}
            </div>
          </div>)}</div> : <EmptyState compact title="No Downloads Yet">Downloads from here and from saved images show here.</EmptyState>}
        </section>
      </> : null}
    </div>
  </Modal>;
}
