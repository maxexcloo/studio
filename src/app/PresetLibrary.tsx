import React from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Image, Library, Link, RefreshCw, Save, Trash2 } from 'lucide-react';
import { apiJson } from './api';
import { Modal } from './Modal';
import { Segmented } from './SettingsControls';
import { useHistoryDismiss } from './useHistoryDismiss';
import { useThisComputer } from './device';
import { presetFit, type ImagePreset } from './presets';
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
  const thisComputer = useThisComputer();
  const [tab, setTab] = React.useState('presets');
  const [saved, setSaved] = React.useState<ImagePreset[]>([]);
  const [selected, setSelected] = React.useState<ImagePreset | null>(null);
  const [url, setUrl] = React.useState('');
  const [modelUrl, setModelUrl] = React.useState('');
  const [folder, setFolder] = React.useState('loras');
  const [file, setFile] = React.useState<ModelFile | null>(null);
  const [name, setName] = React.useState('');
  const [profileId, setProfileId] = React.useState('');
  const [access, setAccess] = React.useState<Access | null>(null);
  const [downloads, setDownloads] = React.useState<ModelDownload[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [token, setToken] = React.useState('');
  const [tokenStatus, setTokenStatus] = React.useState<{ set: boolean; editable: boolean } | null>(null);
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const mounted = React.useRef(true);
  useHistoryDismiss(true, onClose);

  const load = async () => {
    const data = await apiJson<{ presets: ImagePreset[]; downloads: Access }>('/api/presets');
    if (!mounted.current) return;
    setSaved(data.presets); setAccess(data.downloads);
  };
  const select = (preset: ImagePreset) => {
    setSelected(preset); setName(preset.name);
    setProfileId(preset.resources.find((item) => item.profileId)?.profileId || '');
  };
  const resolve = async (id: string) => {
    const data = await post<{ preset: ImagePreset }>('/api/presets/resolve', { id });
    if (mounted.current && selectedRef.current?.id === id) {
      setSelected(data.preset);
      setProfileId((current) => current || data.preset.resources.find((item) => item.profileId)?.profileId || '');
    }
    return data.preset;
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  React.useEffect(() => {
    mounted.current = true;
    void load().catch((error) => setError(error.message)).finally(() => setLoading(false));
    void apiJson<{ set: boolean; editable: boolean }>('/api/settings/civitai-token').then(setTokenStatus).catch(() => {});
    let timer = 0;
    const seen = new Set<string>();
    let initial = true;
    const poll = async () => {
      try {
        const data = await apiJson<{ downloads: ModelDownload[]; access: Access }>('/api/library/downloads');
        if (!mounted.current) return;
        setDownloads(data.downloads); setAccess(data.access);
        const landed = data.downloads.filter((item) => item.status === 'done' && !seen.has(`${item.id}:${item.finishedAt}`));
        for (const item of landed) seen.add(`${item.id}:${item.finishedAt}`);
        if (landed.length && !initial) {
          await refreshModels(false);
          if (selectedRef.current) await resolve(selectedRef.current.id);
          showToast('Models refreshed', 'success');
        }
        initial = false;
      } catch { /* Keep the library usable through a short reconnection. */ }
      if (mounted.current) timer = window.setTimeout(poll, 1500);
    };
    void poll();
    return () => { mounted.current = false; window.clearTimeout(timer); };
  }, []);

  const profiles = (models?.profiles || []).filter((item) => item.kind === 'image');
  const profile = profiles.find((item) => item.id === profileId);
  const fit = selected ? presetFit(selected, profile) : null;
  const pending = downloads.filter((item) => ['queued', 'downloading'].includes(item.status));
  const activeFor = (versionId: number) => pending.some((item) => item.id.startsWith(`civitai:${versionId}:`));
  const missing = selected?.resources.filter((item) => item.status === 'missing' && item.supported && !activeFor(item.versionId)) || [];

  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} size="wide" title="Presets & Models" icon={<Library size={20} />} description="Start from a Civitai image, keep its recipe, or add a model to your library." className="preset-library" busy={busy}
    footer={selected && tab === 'presets' ? <>
      <button className="btn" disabled={!selected.prompt} onClick={() => { onPrompt(selected); onClose(); }}>Use Prompt Only</button>
      <button className="btn is-primary" disabled={Boolean(fit?.blockers.length) || !profile} onClick={() => { if (profile) { onApply(selected, profile); onClose(); } }}>Use Preset</button>
    </> : undefined}>
    <Segmented value={tab} onChange={(value) => { setTab(value); setError(''); }} options={[{ value: 'presets', label: 'Presets' }, { value: 'models', label: 'Get Models' }]} label="Library View" />
    {error ? <p className="preset-message is-error" role="alert">{error}</p> : null}
    {tab === 'presets' ? <>
      {!selected ? <>
        <form className="preset-import" onSubmit={(event) => { event.preventDefault(); void run(async () => { const data = await post<{ preset: ImagePreset }>('/api/presets/import', { url }); select(data.preset); }); }}>
          <label htmlFor="civitai-image-link">Civitai Image Link</label>
          <div className="preset-input-row"><input id="civitai-image-link" type="url" placeholder="https://civitai.com/images/…" value={url} onChange={(event) => setUrl(event.target.value)} required autoComplete="off" /><button className="btn is-primary" disabled={busy || !thisComputer}><Link size={15} />{busy ? 'Reading…' : 'Import'}</button></div>
          <p>Bring in the prompt, settings and exact model versions when the creator included them.</p>
        </form>
        <h3>Saved Presets</h3>
        {loading ? <p role="status">Loading presets…</p> : saved.length ? <div className="preset-grid">{saved.map((preset) => <button className="preset-card" key={preset.id} onClick={() => { select(preset); void run(async () => { await resolve(preset.id); }); }}>
          <span className="preset-card-image">{preset.thumbnailUrl ? <img src={preset.thumbnailUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Image size={26} />}</span>
          <strong>{preset.name}</strong><small>{[preset.baseModel, preset.creator && `by ${preset.creator}`].filter(Boolean).join(' · ') || 'Civitai'}</small>
        </button>)}</div> : <div className="preset-empty"><Library size={28} /><strong>Your Starting Points, In One Place</strong><p>Paste a Civitai image link above, review its recipe, then save it here to use again.</p></div>}
      </> : <>
        <div className="preset-review-head"><button className="btn" onClick={() => { setSelected(null); setError(''); }}><ArrowLeft size={15} />Library</button><a className="btn" href={selected.sourceUrl} target="_blank" rel="noreferrer">View On Civitai<ExternalLink size={14} /></a></div>
        <div className="preset-review">
          <div className="preset-preview">{selected.thumbnailUrl ? <img src={selected.thumbnailUrl} alt="Source image" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Image size={40} />}</div>
          <div className="preset-recipe"><label htmlFor="preset-name">Preset Name</label><input id="preset-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            <p className="preset-byline">{[selected.baseModel, selected.creator && `by ${selected.creator}`].filter(Boolean).join(' · ')}</p>
            <div className="preset-prompt"><strong>Prompt</strong><p>{selected.prompt || 'No prompt was included.'}</p></div>
            {selected.negative ? <details><summary>Negative Prompt</summary><p className="preset-negative">{selected.negative}</p></details> : null}
            <dl className="preset-settings">{Object.entries(selected.settings).map(([key, value]) => <div key={key}><dt>{key === 'cfg' ? 'CFG' : key[0].toUpperCase() + key.slice(1)}</dt><dd>{value}</dd></div>)}</dl>
          </div>
        </div>
        <div className="preset-section-head"><h3>Models & LoRAs</h3><button className="btn" disabled={busy} onClick={() => void run(async () => { await refreshModels(false); await resolve(selected.id); })}><RefreshCw size={14} />Check Again</button></div>
        {selected.resources.length ? <div className="preset-resources">{selected.resources.map((resource) => <div className="preset-resource" key={resource.versionId}>
          <div><strong>{resource.name}</strong><small>{[resource.type, resource.version, resource.weight !== null && resource.folder === 'loras' ? `Weight ${resource.weight}` : '', size(resource.bytes)].filter(Boolean).join(' · ')}</small>{resource.note ? <small>{resource.note}</small> : null}</div>
          <span className={`preset-resource-status is-${resource.status}`}>{resource.status === 'installed' ? <><Check size={14} />Installed</> : activeFor(resource.versionId) ? 'Downloading…' : resource.status === 'conflict' ? 'Filename Conflict' : resource.status === 'unsupported' ? 'Needs Review' : 'Missing'}</span>
        </div>)}</div> : <p>No model versions were included. Choose an installed model below.</p>}
        {access ? <p className="preset-note">{access.note}</p> : null}
        {missing.length ? <button className="btn" disabled={busy || !access?.available || !thisComputer} onClick={() => void run(async () => {
          for (const resource of missing) await post('/api/library/downloads', { versionId: resource.versionId });
          const data = await apiJson<{ downloads: ModelDownload[] }>('/api/library/downloads'); setDownloads(data.downloads);
          showToast('Downloads queued. You can close this library while they finish.', 'success');
        })}><Download size={15} />Download Missing Files{size(missing.reduce((sum, item) => sum + (item.bytes || 0), 0)) ? ` · ${size(missing.reduce((sum, item) => sum + (item.bytes || 0), 0))}` : ''}</button> : null}
        <label className="preset-model-label" htmlFor="preset-model">Use With Model</label><select id="preset-model" value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Choose An Installed Image Model</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.label}</option>)}</select>
        {fit?.warnings.length ? <ul className="preset-message">{fit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        {fit?.blockers.length ? <ul className="preset-note">{fit.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        <div className="preset-save-row"><button className="btn" disabled={busy || !name.trim() || !thisComputer} onClick={() => void run(async () => { const data = await post<{ preset: ImagePreset }>('/api/presets', { id: selected.id, name }); setSelected(data.preset); await load(); showToast('Preset saved', 'success'); })}><Save size={15} />Save Preset</button>
          {saved.some((item) => item.id === selected.id) && thisComputer ? <button className="icon-button" aria-label="Delete Preset" onClick={() => void run(async () => { if (!await confirmAction({ title: 'Delete Preset?', description: 'Its downloaded models stay in your library.', action: 'Delete', destructive: true })) return; await apiJson(`/api/presets/${selected.id}`, { method: 'DELETE' }); setSelected(null); await load(); })}><Trash2 size={16} /></button> : null}</div>
      </>}
    </> : <form className="preset-import" onSubmit={(event) => { event.preventDefault(); void run(async () => { const data = await post<{ file: ModelFile }>('/api/library/downloads/preview', { url: modelUrl, folder }); setFile(data.file); }); }}>
      <label htmlFor="model-download-link">Model Or LoRA Link</label><input id="model-download-link" type="url" value={modelUrl} onChange={(event) => { setModelUrl(event.target.value); setFile(null); }} placeholder="Civitai model or Hugging Face file URL" required autoComplete="off" />
      <label htmlFor="model-download-folder">Hugging Face Destination</label><select id="model-download-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setFile(null); }}>{[['checkpoints', 'Checkpoints'], ['clip_vision', 'CLIP Vision'], ['diffusion_models', 'Diffusion Models'], ['loras', 'LoRAs'], ['text_encoders', 'Text Encoders'], ['vae', 'VAE']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <p>Civitai models choose their destination automatically. Hugging Face links must point to a SafeTensors or GGUF file.</p>
      <button className="btn" disabled={busy || !thisComputer}><Link size={15} />Preview Download</button>
      {file ? <div className="preset-file"><strong>{file.file}</strong><p>{file.folder} · {size(file.bytes)}</p><button type="button" className="btn is-primary" disabled={busy || !access?.available || pending.some((item) => item.id === file.id)} onClick={() => void run(async () => { await post('/api/library/downloads', { id: file.id }); setFile(null); showToast('Download queued', 'success'); })}><Download size={15} />Download</button></div> : null}
      {access ? <p className="preset-note">{access.note}</p> : null}
    </form>}
    {downloads.length ? <details className="preset-downloads" open={Boolean(pending.length)}><summary>Downloads{pending.length ? ` · ${pending.length} In Progress` : ''}</summary>{downloads.slice(-12).reverse().map((item) => <div className="preset-download" key={`${item.id}:${item.finishedAt || item.status}`}><strong>{item.file}</strong><span>{item.status === 'downloading' ? item.totalBytes ? `${Math.min(100, Math.round(item.receivedBytes / item.totalBytes * 100))}%` : 'Downloading…' : item.status[0].toUpperCase() + item.status.slice(1)}</span>{item.error ? <p role="alert">{item.error}</p> : null}{['error', 'paused', 'canceled'].includes(item.status) ? <button className="btn" disabled={busy || !thisComputer} onClick={() => void run(async () => { await post('/api/library/downloads', { id: item.id }); })}>Retry</button> : null}</div>)}</details> : null}
    <details className="preset-access"><summary>Civitai Access{tokenStatus?.set ? ' · Token Set' : ''}</summary><p>Public images can be imported without a token. Restricted resources may need one. Shared-library downloads use AI Control’s provider credentials.</p>
      {thisComputer ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => { const status = await post<{ set: boolean; editable: boolean }>('/api/settings/civitai-token', { token }); setTokenStatus(status); setToken(''); showToast('Civitai access saved', 'success'); }); }}><label htmlFor="civitai-api-token">Civitai API Token</label><div className="preset-input-row"><input id="civitai-api-token" type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} disabled={tokenStatus?.editable === false} placeholder={tokenStatus?.set ? 'Token is stored securely' : 'Paste your API token'} /><button className="btn" disabled={busy || tokenStatus?.editable === false}>{token ? 'Save Token' : tokenStatus?.set ? 'Clear Token' : 'Save Token'}</button></div></form> : <p>Manage provider access at the computer running HEISS.</p>}
    </details>
    {!thisComputer ? <p className="preset-note">Importing, saving and downloading are managed at the computer running HEISS. Saved presets can be used here.</p> : null}
  </Modal>;
}
