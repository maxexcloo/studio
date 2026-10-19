import React from 'react';
import { Check, Lock, Pencil, PlugZap, RefreshCw, X } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { StudioSelect } from './components';
import { cn } from './format';
import { Group, Row, Switch } from './SettingsControls';
import type { ShowToast } from './toast';

/** What /api/settings/deployment reports (server/deployment-settings.js). */
type Source = { source: 'deployment' | 'studio' | 'default'; locked: boolean };
type Connection = Source & { backend: 'primary' | 'video'; label: string; key: string; value: string; routes: string };
type DefaultProfile = Source & { key: string; configured: string; effective: string };
type CatalogueFlag = Source & { key: string; label: string; description: string; value: boolean; defaultOn: boolean; applies: 'now' | 'restart' };
type TokenStatus = { set: boolean; editable: boolean; source?: string };
export type DeploymentSettings = {
  connections: Connection[];
  defaults: { image: DefaultProfile; video: DefaultProfile; profiles: { id: string; label: string; kind: string; ready: boolean }[] };
  catalogue: CatalogueFlag[];
  integrations: { civitai: { browsing: boolean; token: TokenStatus; presets: boolean }; huggingFace: { token: TokenStatus } };
  storage: Source & { outputs: 'heiss' | 'comfy'; workerToken: boolean; multiUser: boolean };
};
type BackendStatus = { connected: boolean; device?: string; restarting?: boolean };

const FIRST_READY = '__first-ready__';
const sourceWords: Record<Source['source'], string> = { deployment: 'Deployment', studio: 'This Studio', default: 'Default' };

/** Where a value comes from, and a lock when the deployment owns it. */
export function SourceTag({ source, locked }: Source) {
  return <span className={cn('set-source', `is-${source}`)} title={locked ? 'Set by the deployment configuration. Change it there.' : undefined}>
    {locked ? <Lock size={11} aria-hidden="true" /> : null}{sourceWords[source]}{locked ? ' · Locked' : ''}
  </span>;
}

export function useDeploymentSettings(enabled: boolean) {
  const [settings, setSettings] = React.useState<DeploymentSettings | null>(null);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    if (!enabled) return;
    try {
      setSettings(await apiJson<DeploymentSettings & { ok: boolean }>('/api/settings/deployment', { cache: 'no-store' }));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load deployment settings.');
    }
  }, [enabled]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  return { settings, error, refresh };
}

async function postJson(url: string, body: unknown) {
  const response = await apiFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/** Test and keep one backend's address; the video one can also be cleared, handing videos back to the image connection. */
function AddressEditor({ connection, showToast, onSaved, onClose }: { connection: Connection; showToast: ShowToast; onSaved: () => void; onClose: () => void }) {
  const [value, setValue] = React.useState(connection.value);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  const submit = async (save: boolean, url = value) => {
    setBusy(true);
    setNote('');
    try {
      const { response, data } = await postJson('/api/comfy-url', { url, save, backend: connection.backend });
      if (!response.ok) { setNote(data.error || 'Couldn’t check that address.'); return; }
      if (data.saved && !data.url) { showToast(`${connection.label} now use the image connection`, 'success'); onSaved(); onClose(); return; }
      setValue(data.url);
      if (!data.reachable) { setNote(`${data.detail || 'ComfyUI didn’t respond at that address.'}${save ? ' The address wasn’t saved.' : ''}`); return; }
      if (data.saved) { showToast(`${connection.label} Connection Saved`, 'success'); onSaved(); onClose(); }
      else setNote('ComfyUI responds at that address.');
    } catch {
      setNote('Can’t reach HEISS UI. Make sure it’s running.');
    } finally { setBusy(false); }
  };
  const changed = value.trim() !== connection.value;
  return <Row stacked label={`${connection.label} Address`} description={note || (connection.backend === 'video' ? 'A separate ComfyUI for local video workflows. Leave empty to use the image connection.' : 'Where ComfyUI runs for images. ComfyUI Desktop usually uses port 8000, a manual install 8188.')}>
    <div className="set-address">
      <input className="modal-input set-path-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label={`${connection.label} ComfyUI address`} spellCheck={false} autoComplete="off" placeholder={connection.backend === 'video' ? 'Use the image connection' : 'http://127.0.0.1:8188'} onKeyDown={(event) => { if (event.key === 'Enter' && changed) void submit(true); if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} />
      <button className="btn" onClick={() => void submit(false)} disabled={busy || !value.trim()}><PlugZap size={14} /> Test</button>
      <button className="btn is-primary" onClick={() => void submit(true)} disabled={busy || !changed || (!value.trim() && connection.backend !== 'video')}><Check size={14} /> {busy ? 'Checking…' : 'Save'}</button>
      <button className="btn is-ghost" onClick={onClose} disabled={busy}><X size={14} /> Cancel</button>
    </div>
  </Row>;
}

/** Image and video backends in one layout: status, what each runs, its address and who owns it. */
export function ConnectionsGroup({ settings, status, showToast, onSaved, Status }: { settings: DeploymentSettings; status: (backend: 'primary' | 'video') => BackendStatus | null; showToast: ShowToast; onSaved: () => void; Status: React.ComponentType<React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>> }) {
  const [editing, setEditing] = React.useState('');
  return <Group title="Generation Connections" note="Each connection is a ComfyUI worker. Locked addresses come from the deployment configuration.">
    {settings.connections.map((connection) => {
      const current = status(connection.backend);
      const tone = current?.restarting ? 'warn' : current?.connected ? 'ok' : 'bad';
      return <React.Fragment key={connection.backend}>
        <Row label={<>{connection.label} <SourceTag source={connection.source} locked={connection.locked} /></>} description={<>{connection.value || 'Not set'} · {connection.routes}{current?.device ? ` · ${current.device}` : ''}</>}>
          {current ? <Status tone={tone}>{current.restarting ? 'Restarting' : current.connected ? 'Ready' : 'Offline'}</Status> : null}
          {connection.locked ? null : <button className="btn is-ghost" aria-label={`Edit ${connection.label} Address`} onClick={() => setEditing(editing === connection.backend ? '' : connection.backend)}><Pencil size={14} /> Edit</button>}
        </Row>
        {editing === connection.backend ? <AddressEditor connection={connection} showToast={showToast} onSaved={onSaved} onClose={() => setEditing('')} /> : null}
      </React.Fragment>;
    })}
  </Group>;
}

/** The profiles a fresh composer starts on, and what the catalogue offers. */
export function DefaultsCatalogueGroups({ settings, showToast, onSaved }: { settings: DeploymentSettings; showToast: ShowToast; onSaved: () => void }) {
  const [busy, setBusy] = React.useState('');
  const save = async (key: string, value: string | boolean) => {
    setBusy(key);
    try {
      const { response, data } = await postJson('/api/settings/deployment', { key, value });
      if (!response.ok) { showToast(data.error || 'Couldn’t save that setting.', 'error'); return; }
      showToast(data.setting?.applies === 'restart' ? 'Saved. Restart HEISS UI to apply it.' : 'Saved', 'success');
      onSaved();
    } catch { showToast('Can’t reach HEISS UI. Make sure it’s running.', 'error'); }
    finally { setBusy(''); }
  };
  const label = (id: string) => settings.defaults.profiles.find((profile) => profile.id === id)?.label || id;
  const defaultRow = (kind: 'image' | 'video') => {
    const entry = settings.defaults[kind];
    const options = [{ label: 'First Ready Profile', value: FIRST_READY }, ...settings.defaults.profiles.filter((profile) => profile.kind === kind).map((profile) => ({ label: `${profile.label}${profile.ready ? '' : ' (Not Ready)'}`, value: profile.id }))];
    if (entry.configured && !options.some((option) => option.value === entry.configured)) options.push({ label: `${entry.configured} (Unavailable)`, value: entry.configured });
    const missing = entry.configured && entry.configured !== entry.effective;
    return <Row key={kind} label={<>{kind === 'image' ? 'Default Image Profile' : 'Default Video Profile'} <SourceTag source={entry.source} locked={entry.locked} /></>} description={entry.effective ? `${missing ? `${entry.configured} isn’t ready, so new composers start on ` : 'New composers start on '}${label(entry.effective)}. Existing drafts keep their choice.` : `No ${kind} profile is ready.`} disabled={busy === entry.key}>
      {entry.locked ? <span className="set-locked-value">{entry.configured ? label(entry.configured) : 'First Ready Profile'}</span> : <div className="set-type-picker"><StudioSelect ariaLabel={kind === 'image' ? 'Default image profile' : 'Default video profile'} value={entry.configured || FIRST_READY} options={options} onChange={(value) => void save(entry.key, value === FIRST_READY ? '' : value)} /></div>}
    </Row>;
  };
  return <>
    <Group title="Model Defaults" note="Deployment settings override these until they are removed from its configuration.">
      {defaultRow('image')}
      {defaultRow('video')}
    </Group>
    <Group title="Catalogue" note="What the generation catalogue offers. Some changes apply after HEISS UI restarts.">
      {settings.catalogue.map((item) => <Row key={item.key} label={<>{item.label} <SourceTag source={item.source} locked={item.locked} /></>} description={`${item.description}${item.applies === 'restart' ? ' Applies after a restart.' : ''}`} disabled={busy === item.key}>
        <Switch label={item.label} checked={item.value} disabled={item.locked || busy === item.key} onChange={(next) => void save(item.key, next)} />
      </Row>)}
    </Group>
  </>;
}

/** Third-party services and storage at a glance: what is on, configured and available. */
export function IntegrationsOverview({ settings, Status }: { settings: DeploymentSettings; Status: React.ComponentType<React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>> }) {
  const { civitai, huggingFace } = settings.integrations;
  const state = (on: boolean, words: [string, string]) => <Status tone={on ? 'ok' : undefined}>{on ? words[0] : words[1]}</Status>;
  return <>
    <Group title="Overview">
      <Row label="Civitai" description={`Browsing ${civitai.browsing ? 'on' : 'off'} · token ${civitai.token.set ? 'saved' : 'not set'}${civitai.token.set && !civitai.token.editable ? ' by the deployment' : ''} · presets ${civitai.presets ? 'on' : 'off'}`}>{state(civitai.browsing || civitai.presets, ['On', 'Off'])}</Row>
      <Row label="Hugging Face" description={huggingFace.token.set ? `Token ${huggingFace.token.editable ? 'saved here' : 'set by the deployment'}; gated models can download.` : 'No token; public models only.'}>{state(huggingFace.token.set, ['Configured', 'Public Only'])}</Row>
      <Row label={<>Output Storage <SourceTag source={settings.storage.source} locked={settings.storage.locked} /></>} description={settings.storage.outputs === 'heiss' ? `HEISS keeps finished outputs; ComfyUI is a worker.${settings.storage.workerToken ? ' The worker node token is set.' : ''}` : 'Finished outputs stay in ComfyUI’s output folder.'}>{state(settings.storage.outputs === 'heiss', ['HEISS Media', 'ComfyUI Folder'])}</Row>
    </Group>
  </>;
}

export function DeploymentSettingsError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <Group><Row label="Deployment Settings Unavailable" description={error}><button className="btn is-ghost" onClick={onRetry}><RefreshCw size={14} /> Retry</button></Row></Group>;
}
