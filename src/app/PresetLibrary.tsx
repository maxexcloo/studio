import React from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Image, Library, Link, RefreshCw, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import { apiJson } from './api';
import { Modal } from './Modal';
import { SafeImg } from './SafeImg';
import { Segmented } from './SettingsControls';
import { useHistoryDismiss } from './useHistoryDismiss';
import { presetFit, type ImagePreset, type PresetResource } from './presets';
import type { ModelDownload, Models, Profile } from './types';
import type { ShowToast } from './toast';
import type { ConfirmAction } from './useConfirmation';

type Access = { available: boolean; backend: string; note: string };
type ModelFile = { id: string; file: string; folder: string; label: string; bytes: number };
const post = <T,>(url: string, body: object) => apiJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const size = (bytes?: number) => bytes ? `${(bytes / 1e9).toFixed(2)} GB` : '';

export function PresetLibrary({ onClose, models, refreshModels, onApply, onPrompt, showToast, confirmAction }: {
  onClose: () => void; models: Models | null; refreshModels: (notify?: boolean) => Promise<unknown>;
  onApply: (preset: ImagePreset, profile: Profile) => void; onPrompt: (preset: ImagePreset) => void;
  showToast: ShowToast; confirmAction: ConfirmAction;
}) {
  const [tab, setTab] = React.useState('images');
  const [query, setQuery] = React.useState('');
  const [saved, setSaved] = React.useState<ImagePreset[]>([]);
  const [selected, setSelected] = React.useState<ImagePreset | null>(null);
  const [url, setUrl] = React.useState('');
  const [modelUrl, setModelUrl] = React.useState('');
  const [folder, setFolder] = React.useState('loras');
  const [file, setFile] = React.useState<ModelFile | null>(null);
  const [profileId, setProfileId] = React.useState('');
  const [access, setAccess] = React.useState<Access | null>(null);
  const [downloads, setDownloads] = React.useState<ModelDownload[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const mounted = React.useRef(true);
  const running = React.useRef(false);
  useHistoryDismiss(true, onClose);

  const load = async () => {
    const data = await apiJson<{ presets: ImagePreset[]; downloads: Access }>('/api/presets');
    if (!mounted.current) return;
    setSaved(data.presets); setAccess(data.downloads);
  };
  const select = (preset: ImagePreset) => {
    setSelected(preset);
    setProfileId(preset.resources.find((item) => item.profileId)?.profileId || (!preset.resources.some((item) => ['checkpoints', 'diffusion_models'].includes(item.folder || '')) ? preset.type === 'video' ? models?.defaults.videoModel : models?.defaults.imageModel : '') || '');
  };
  const resolve = async (id: string) => {
    const data = await post<{ preset: ImagePreset }>('/api/presets/resolve', { id });
    if (mounted.current) setSaved((current) => current.map((preset) => preset.id === id ? data.preset : preset));
    if (mounted.current && selectedRef.current?.id === id) {
      setSelected(data.preset);
      setProfileId((current) => current || data.preset.resources.find((item) => item.profileId)?.profileId || '');
    }
    return data.preset;
  };
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  React.useEffect(() => {
    mounted.current = true;
    void load().catch((error) => { if (mounted.current) setError(error.message); }).finally(() => { if (mounted.current) setLoading(false); });
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
  }, []);

  const visible = saved.filter((preset) => [preset.name, preset.prompt, preset.baseModel, preset.creator].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const profiles = (models?.profiles || []).filter((item) => item.kind === (selected?.type || 'image'));
  const profile = profiles.find((item) => item.id === profileId);
  const fit = selected ? presetFit(selected, profile) : null;
  const pending = downloads.filter((item) => ['queued', 'downloading'].includes(item.status));
  const matchesDownload = (id: string, versionId: number | string) => id === versionId || id.startsWith(`civitai:${versionId}:`);
  const activeFor = (versionId: number | string) => pending.some((item) => matchesDownload(item.id, versionId));
  const missing = selected?.resources.filter((item) => item.status === 'missing' && item.supported && !activeFor(item.versionId)) || [];
  const resourceStatus = (resource: PresetResource) => {
    if (resource.status === 'installed') return resource.nameOnly ? 'Found By Filename' : 'Installed';
    const download = downloads.find((item) => matchesDownload(item.id, resource.versionId));
    if (download?.status === 'queued') return 'Queued';
    if (download?.status === 'downloading') return download.totalBytes ? `Downloading ${Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))}%` : 'Downloading…';
    if (download && ['error', 'paused', 'canceled'].includes(download.status)) return download.status === 'error' ? 'Download Failed' : download.status === 'paused' ? 'Paused' : 'Cancelled';
    return resource.status === 'conflict' ? 'Filename Conflict' : resource.status === 'unsupported' ? 'Needs Review' : 'Missing';
  };
  const importingImage = async () => {
    setImporting(true);
    try {
      const data = await post<{ preset: ImagePreset }>('/api/presets/import', { url });
      select(data.preset); setSaved((current) => [data.preset, ...current.filter((preset) => preset.id !== data.preset.id)]);
      showToast(data.preset.downloadWarnings?.length ? 'Image saved. Check its missing model files.' : 'Image saved to your gallery.', 'success');
    } finally { if (mounted.current) setImporting(false); }
  };

  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} size="wide" title="Image & Model Library" icon={<Library size={20} />} description={tab === 'images' ? 'Save an image with its settings, then use it as a starting point.' : 'Preview and download model files for your workflows.'} className="preset-library" busy={busy}
    footer={selected && tab === 'images' ? <>
      <button className="btn" disabled={busy || !selected.prompt} onClick={() => { onPrompt(selected); onClose(); }}><Wand2 size={15} />Use Prompt</button>
      <button className="btn is-primary" disabled={busy || Boolean(fit?.blockers.length) || !profile} onClick={() => { if (profile) { onApply(selected, profile); onClose(); } }}><SlidersHorizontal size={15} />Use Settings</button>
    </> : undefined}>
    <fieldset className="preset-tabs" disabled={busy}><Segmented value={tab} onChange={(value) => { setTab(value); setError(''); }} options={[{ value: 'images', label: 'Saved Images' }, { value: 'models', label: 'Download Models' }]} label="Library View" /></fieldset>
    {error ? <div className="preset-message is-error"><p role="alert">{error}</p>{!selected && !saved.length && !loading ? <button className="btn" disabled={busy} onClick={() => void run(load)}><RefreshCw size={15} />Try Again</button> : null}</div> : null}
    {importing ? <p className="preset-message" role="status">Importing image: reading its settings, saving the original and checking model files. Large files can take a moment.</p> : null}
    {tab === 'images' ? <>
      {!selected ? <>
        <form className="preset-import" onSubmit={(event) => { event.preventDefault(); void run(importingImage); }}>
          <label htmlFor="civitai-image-link">Image Link</label>
          <div className="preset-input-row"><input id="civitai-image-link" type="url" placeholder="https://civitai.com/images/…" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="off" /><button className="btn is-primary" disabled={busy}><Link size={15} />{importing ? 'Saving…' : 'Save Image'}</button></div>
          <p>Saves the image and its settings to your gallery. Missing model and LoRA files download automatically.</p>
        </form>
        <div className="preset-section-head"><h3>Saved Images <span>{saved.length}</span></h3>{saved.length > 0 ? <input aria-label="Search Saved Images" type="search" placeholder="Search images…" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}</div>
        {loading ? <p role="status">Loading images…</p> : visible.length ? <div className="preset-grid">{visible.map((preset) => <button className="preset-card" disabled={busy} key={preset.id} onClick={() => { select(preset); void run(async () => { await resolve(preset.id); }); }}>
          <span className="preset-card-image"><SafeImg src={preset.thumbnailUrl} loading="lazy" fallback={<Image size={26} />} /></span>
          <strong>{preset.name}</strong><small>{[preset.baseModel, preset.creator && `by ${preset.creator}`].filter(Boolean).join(' · ') || 'Civitai'}</small>
        </button>)}</div> : <div className="preset-empty"><Library size={28} /><strong>{saved.length ? 'No Matching Images' : 'Save Your First Image'}</strong><p>{saved.length ? 'Try a different model, creator or prompt.' : 'Paste a Civitai image link above. Save its original image, prompt and model settings together.'}</p></div>}
      </> : <>
        <div className="preset-review-head"><button className="btn" disabled={busy} onClick={() => { setSelected(null); setError(''); }}><ArrowLeft size={15} />Library</button><a className="btn" href={selected.sourceUrl} target="_blank" rel="noreferrer">View On Civitai<ExternalLink size={14} /></a></div>
        <div className="preset-message" role="status"><strong>{selected.galleryItemId ? 'Image Saved' : 'Image Not Yet Saved'} · {selected.resources.some((resource) => activeFor(resource.versionId)) ? 'Downloading Models' : fit?.blockers.length ? 'Needs Review' : 'Ready To Use'}</strong><p>{selected.resources.filter((resource) => resource.status === 'installed').length} of {selected.resources.length} model files installed. Source settings are shown below; custom workflows and additional processing may need manual setup.</p></div>
        <div className="preset-review">
          <div className="preset-preview">{selected.type === 'video' && selected.galleryItemId ? <video src={`/api/presets/${selected.id}/media`} controls autoPlay muted playsInline loop /> : selected.thumbnailUrl ? <SafeImg src={selected.thumbnailUrl} alt="Source image" fallback={<Image size={40} />} /> : <Image size={40} />}</div>
          <div className="preset-recipe"><h3>{selected.name}</h3>
            <p className="preset-byline">{[selected.baseModel, selected.creator && `by ${selected.creator}`].filter(Boolean).join(' · ')}</p>
            <div className="preset-prompt"><strong>Prompt</strong><p>{selected.prompt || 'No prompt was included.'}</p></div>
            {selected.negative ? <details><summary>Negative Prompt</summary><p className="preset-negative">{selected.negative}</p></details> : null}
            <dl className="preset-settings">{Object.entries(selected.settings).map(([key, value]) => <div key={key}><dt>{key === 'cfg' ? 'CFG' : key[0].toUpperCase() + key.slice(1)}</dt><dd>{value}</dd></div>)}</dl>
          </div>
        </div>
        <div className="preset-model-choice"><label htmlFor="preset-model-choice">Use With Model</label><select id="preset-model-choice" disabled={busy} value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Choose An Installed Model</option>{profiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.label}{candidate.ready === false ? ' · Setup Required' : ''}</option>)}</select><p className="preset-note">The source model is selected when it is installed. Choosing another model may change the result.</p></div>
        <div className="preset-section-head"><h3>Source Models & LoRAs</h3><button className="btn" disabled={busy} onClick={() => void run(async () => { await refreshModels(false); await resolve(selected.id); })}><RefreshCw size={14} />Check Again</button></div>
        {selected.resources.length ? <div className="preset-resources">{selected.resources.map((resource) => <div className="preset-resource" key={resource.versionId}>
          <div><strong>{resource.name}</strong><small>{[resource.type, resource.version, resource.weight !== null && resource.folder === 'loras' ? `Weight ${resource.weight}` : '', size(resource.bytes)].filter(Boolean).join(' · ')}</small>{resource.note ? <small>{resource.note}</small> : null}</div>
          <span className={`preset-resource-status is-${resource.status}`}>{resource.status === 'installed' ? <Check size={14} /> : null}{resourceStatus(resource)}</span>
        </div>)}</div> : <p>No model versions were included with this image.</p>}
        {access ? <p className="preset-note">{access.note}</p> : null}
        {selected.downloadWarnings?.length ? <ul className="preset-message is-error">{selected.downloadWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {missing.length ? <p className="preset-note">Missing supported files are queued automatically. Downloads can be retried below.</p> : null}
        {missing.length ? <button className="btn" disabled={busy} onClick={() => void run(async () => { for (const resource of missing) {
          if (typeof resource.versionId === 'number') await post('/api/library/downloads', { versionId: resource.versionId });
          else if (resource.sourceUrl && resource.folder) {
            const result = await post<{ file: ModelFile }>('/api/library/downloads/preview', { url: resource.sourceUrl, folder: resource.folder });
            await post('/api/library/downloads', { id: result.file.id });
          }
        } showToast('Missing file downloads queued', 'success'); })}><RefreshCw size={15} />Retry Missing Files</button> : null}
        {fit?.warnings.length ? <ul className="preset-message">{fit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {fit?.blockers.length ? <ul className="preset-note">{fit.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        <div className="preset-save-row">
          {!selected.galleryItemId ? <button className="btn" disabled={busy} onClick={() => void run(async () => { const data = await post<{ preset: ImagePreset }>('/api/presets/import', { url: selected.sourceUrl }); select(data.preset); setSaved((current) => [data.preset, ...current.filter((preset) => preset.id !== data.preset.id)]); })}><Download size={15} />Download Image</button> : null}
          <button className="btn is-danger" disabled={busy} aria-label="Delete Saved Image" onClick={() => void run(async () => { if (!await confirmAction({ title: 'Delete Image?', description: 'Its downloaded models stay in your library.', action: 'Delete', destructive: true })) return; await apiJson(`/api/presets/${selected.id}`, { method: 'DELETE' }); setSaved((current) => current.filter((preset) => preset.id !== selected.id)); setSelected(null); })}><Trash2 size={16} />Delete Saved Image</button>
        </div>
      </>}
    </> : <form className="preset-import" onSubmit={(event) => { event.preventDefault(); void run(async () => { const data = await post<{ file: ModelFile }>('/api/library/downloads/preview', { url: modelUrl, folder }); setFile(data.file); }); }}>
      <h3>Download A Model Or LoRA</h3><p>Paste a Civitai model page or a Hugging Face file link. Preview the file and destination before downloading.</p><label htmlFor="model-download-link">Model Or LoRA Link</label><input id="model-download-link" disabled={busy} type="url" value={modelUrl} onChange={(event) => { setModelUrl(event.target.value); setFile(null); }} placeholder="Civitai model or Hugging Face file URL" required autoComplete="off" />
      {/^https:\/\/(?:www\.)?huggingface\.co\//i.test(modelUrl) ? <><label htmlFor="model-download-folder">Hugging Face Destination</label><select id="model-download-folder" disabled={busy} value={folder} onChange={(event) => { setFolder(event.target.value); setFile(null); }}>{[['checkpoints', 'Checkpoints'], ['clip_vision', 'CLIP Vision'], ['diffusion_models', 'Diffusion Models'], ['loras', 'LoRAs'], ['text_encoders', 'Text Encoders'], ['vae', 'VAE']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></> : null}
      <p>Civitai models choose their destination automatically. Hugging Face links must point to a SafeTensors or GGUF file.</p>
      <button className="btn" disabled={busy}><Link size={15} />Preview Download</button>
      {file ? <div className="preset-file"><strong>{file.file}</strong><p>{file.folder} · {size(file.bytes)}</p><button type="button" className="btn is-primary" disabled={busy || !access?.available || pending.some((item) => item.id === file.id)} onClick={() => void run(async () => { await post('/api/library/downloads', { id: file.id }); setFile(null); showToast('Download queued', 'success'); })}><Download size={15} />Download</button></div> : null}
      {access ? <p className="preset-note">{access.note}</p> : null}
    </form>}
    {downloads.length ? <details className="preset-downloads" open={Boolean(pending.length)}><summary>Downloads{pending.length ? ` · ${pending.length} In Progress` : ''}</summary>{downloads.slice(-12).reverse().map((item) => <div className="preset-download" key={`${item.id}:${item.finishedAt || item.status}`}><strong>{item.file}</strong><span>{item.status === 'downloading' ? item.totalBytes ? `${Math.min(100, Math.round(item.receivedBytes / item.totalBytes * 100))}%` : 'Downloading…' : item.status[0].toUpperCase() + item.status.slice(1)}</span>{item.error ? <p role="alert">{item.error}</p> : null}{['error', 'paused', 'canceled'].includes(item.status) ? <button className="btn" disabled={busy} onClick={() => void run(async () => { await post('/api/library/downloads', { id: item.id }); })}><RefreshCw size={15} />Retry</button> : null}</div>)}</details> : null}
  </Modal>;
}
