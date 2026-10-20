import React from 'react';
import { Check, ExternalLink, Lock, Pencil, PlugZap, RefreshCw, RotateCw, X } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { StudioSelect } from './components';
import { cn } from './format';
import { Group, Row, Status, SwitchRow } from './SettingsControls';
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
  integrations: { civitai: { token: TokenStatus; presets: boolean }; huggingFace: { token: TokenStatus } };
  storage: Source & { outputs: 'studio' | 'comfy'; workerToken: boolean; multiUser: boolean };
};
type BackendStatus = { connected: boolean; device?: string; restarting?: boolean };

const FIRST_READY = '__first-ready__';
// Inpainting is switched in Studio › Features, beside Smart Upscale.
export const inpaintFlagKey = 'HEISS_ENABLE_INPAINT';
const hiddenCatalogueKeys = new Set([inpaintFlagKey]);
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
      if (data.saved) { showToast(`${connection.label} connection saved`, 'success'); onSaved(); onClose(); }
      else setNote('ComfyUI responds at that address.');
    } catch {
      setNote('Can’t reach Studio. Make sure it’s running.');
    } finally { setBusy(false); }
  };
  const changed = value.trim() !== connection.value;
  return <Row stacked label={`${connection.label} Address`} description={note || (connection.backend === 'video' ? 'A separate ComfyUI for local video workflows. Leave empty to use the image connection.' : 'Where ComfyUI runs for images. ComfyUI Desktop usually uses port 8000, a manual install 8188.')}>
    <div className="set-address">
      <input className="modal-input set-path-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label={`${connection.label} ComfyUI Address`} spellCheck={false} autoComplete="off" placeholder={connection.backend === 'video' ? 'Use the image connection' : 'http://127.0.0.1:8188'} onKeyDown={(event) => { if (event.key === 'Enter' && changed) void submit(true); if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} />
      <button className="btn" onClick={() => void submit(false)} disabled={busy || !value.trim()}><PlugZap size={14} /> Test</button>
      <button className="btn is-primary" onClick={() => void submit(true)} disabled={busy || !changed || (!value.trim() && connection.backend !== 'video')}><Check size={14} /> {busy ? 'Checking…' : 'Save'}</button>
      <button className="btn is-ghost" onClick={onClose} disabled={busy}><X size={14} /> Cancel</button>
    </div>
  </Row>;
}

/** What a worker can say about itself (the app's status poll and /api/health). */
export type WorkerStatus = { connected: boolean; device?: string; restarting?: boolean; url?: string } | null;
const workerTitle = (backend: 'primary' | 'video') => backend === 'video' ? 'Video Worker' : 'Image Worker';

/**
 * Settings › Workers: one group per ComfyUI worker, with its address (locked
 * when the deployment sets it), its connection, what it runs and, where Studio
 * can, a restart. Nothing about a worker shows twice.
 */
export function WorkerGroups({ settings, status, showToast, onSaved, onCheck, restart }: {
  settings: DeploymentSettings;
  status: (backend: 'primary' | 'video') => WorkerStatus;
  showToast: ShowToast;
  onSaved: () => void;
  onCheck: () => void;
  /** The restart control for a worker. */
  restart: (backend: 'primary' | 'video') => React.ReactNode;
}) {
  const [editing, setEditing] = React.useState('');
  const [testing, setTesting] = React.useState('');
  const [tested, setTested] = React.useState<Record<string, string>>({});
  // Asks the worker at its saved address without changing anything, then refreshes the status.
  const test = async (connection: Connection) => {
    setTesting(connection.backend);
    try {
      const { response, data } = await postJson('/api/comfy-url', { url: connection.value, save: false, backend: connection.backend });
      setTested((current) => ({ ...current, [connection.backend]: !response.ok ? data.error || 'Couldn’t test it.' : data.reachable ? 'Answered just now.' : data.detail || 'Didn’t answer.' }));
      onCheck();
    } catch { setTested((current) => ({ ...current, [connection.backend]: 'Can’t reach Studio.' })); }
    finally { setTesting(''); }
  };
  return <>
    {settings.connections.map((connection) => {
      const current = status(connection.backend);
      const shared = connection.backend === 'video' && !connection.value;
      const tone = current?.restarting ? 'warn' : current?.connected ? 'ok' : 'bad';
      const restartControl = shared ? null : restart(connection.backend);
      return <Group key={connection.backend} title={workerTitle(connection.backend)} note={connection.locked ? 'The address comes from the deployment configuration. Change it there.' : undefined}>
        <Row label={<>Address <SourceTag source={connection.source} locked={connection.locked} /></>} description={shared ? 'Not set: videos run on the image worker.' : <code className="set-path is-oneline">{connection.value || 'Not set'}</code>}>
          {connection.locked ? null : <button className="btn is-ghost" aria-label={`Edit ${connection.label} Address`} onClick={() => setEditing(editing === connection.backend ? '' : connection.backend)}><Pencil size={14} /> Edit</button>}
        </Row>
        {editing === connection.backend ? <AddressEditor connection={connection} showToast={showToast} onSaved={onSaved} onClose={() => setEditing('')} /> : null}
        {shared ? null : <Row label="Status" description={tested[connection.backend] || (current ? (current.restarting ? 'Reconnects when it’s back.' : current.connected ? current.device || 'Ready to generate.' : 'Studio can’t reach it.') : 'Checking…')}>
          {current ? <Status tone={tone}>{current.restarting ? 'Restarting' : current.connected ? 'Ready' : 'Offline'}</Status> : null}
          <button className="btn is-ghost" disabled={testing === connection.backend} aria-label={`Test the ${workerTitle(connection.backend)}`} onClick={() => void test(connection)}><PlugZap size={14} /> {testing === connection.backend ? 'Testing…' : 'Test'}</button>
          {current?.connected && (current.url || connection.value) ? <a className="btn is-ghost" href={current.url || connection.value} target="_blank" rel="noreferrer" aria-label={`Open the ${workerTitle(connection.backend)}`}><ExternalLink size={14} /> Open</a> : null}
        </Row>}
        <Row label="Runs" description={connection.routes} />
        {restartControl ? <Row label="Restart" description="Loads new custom nodes and files, and frees memory. Running and queued generations stop.">{restartControl}</Row> : null}
      </Group>;
    })}
  </>;
}

/** The profiles a fresh composer starts on, and what the catalogue offers. */
export function DefaultsCatalogueGroups({ settings, showToast, onSaved }: { settings: DeploymentSettings; showToast: ShowToast; onSaved: () => void }) {
  const [busy, setBusy] = React.useState('');
  const save = async (key: string, value: string | boolean) => {
    setBusy(key);
    try {
      const { response, data } = await postJson('/api/settings/deployment', { key, value });
      if (!response.ok) { showToast(data.error || 'Couldn’t save that setting.', 'error'); return; }
      showToast(data.setting?.applies === 'restart' ? 'Saved. Restart Studio to apply it.' : 'Saved', 'success');
      onSaved();
    } catch { showToast('Can’t reach Studio. Make sure it’s running.', 'error'); }
    finally { setBusy(''); }
  };
  const label = (id: string) => settings.defaults.profiles.find((profile) => profile.id === id)?.label || id;
  const defaultRow = (kind: 'image' | 'video') => {
    const entry = settings.defaults[kind];
    const options = [{ label: 'First Ready Profile', value: FIRST_READY }, ...settings.defaults.profiles.filter((profile) => profile.kind === kind).map((profile) => ({ label: `${profile.label}${profile.ready ? '' : ' (Not Ready)'}`, value: profile.id }))];
    if (entry.configured && !options.some((option) => option.value === entry.configured)) options.push({ label: `${entry.configured} (Unavailable)`, value: entry.configured });
    const missing = entry.configured && entry.configured !== entry.effective;
    return <Row key={kind} label={<>{kind === 'image' ? 'Default Image Profile' : 'Default Video Profile'} <SourceTag source={entry.source} locked={entry.locked} /></>} description={entry.effective ? `${missing ? `${entry.configured} isn’t ready, so new composers start on ` : 'New composers start on '}${label(entry.effective)}. Existing drafts keep their choice.` : `No ${kind} profile is ready.`} disabled={busy === entry.key}>
      {entry.locked ? <span className="set-locked-value">{entry.configured ? label(entry.configured) : 'First Ready Profile'}</span> : <div className="set-type-picker"><StudioSelect ariaLabel={kind === 'image' ? 'Default Image Profile' : 'Default Video Profile'} value={entry.configured || FIRST_READY} options={options} onChange={(value) => void save(entry.key, value === FIRST_READY ? '' : value)} /></div>}
    </Row>;
  };
  return <>
    <Group title="Defaults" note="Deployment settings override these until they are removed from its configuration.">
      {defaultRow('image')}
      {defaultRow('video')}
    </Group>
    <Group title="Catalogue" note="What the model catalogue offers. Some changes apply after Studio restarts.">
      {settings.catalogue.filter((item) => !hiddenCatalogueKeys.has(item.key)).map((item) => <SwitchRow key={item.key} label={item.label} tag={<SourceTag source={item.source} locked={item.locked} />} description={`${item.description}${item.applies === 'restart' ? ' Applies after a restart.' : ''}`} checked={item.value} disabled={item.locked || busy === item.key} onChange={(next) => void save(item.key, next)} />)}
    </Group>
  </>;
}

/** Third-party services and storage at a glance: what is on, configured and available. */
export function IntegrationsOverview({ settings }: { settings: DeploymentSettings }) {
  const { civitai } = settings.integrations;
  const state = (on: boolean, words: [string, string]) => <Status tone={on ? 'ok' : undefined}>{on ? words[0] : words[1]}</Status>;
  return <Group title="Integrations">
    <Row label="Civitai" description={`Token ${civitai.token.set ? 'saved' : 'not set'}${civitai.token.set && !civitai.token.editable ? ' by the deployment' : ''} · presets ${civitai.presets ? 'on' : 'off'}. New PNGs always carry their settings in the form Civitai reads.`}>{state(civitai.token.set || civitai.presets, ['On', 'Off'])}</Row>
    <Row label={<>Output Storage <SourceTag source={settings.storage.source} locked={settings.storage.locked} /></>} description={settings.storage.outputs === 'studio' ? `Studio keeps finished outputs; ComfyUI is a worker.${settings.storage.workerToken ? ' The worker node token is set.' : ''}` : 'Finished outputs stay in ComfyUI’s output folder.'}>{state(settings.storage.outputs === 'studio', ['Studio Media', 'ComfyUI Folder'])}</Row>
  </Group>;
}

export function DeploymentSettingsError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <Group><Row label="Deployment Settings Unavailable" description={error}><button className="btn is-ghost" onClick={onRetry}><RefreshCw size={14} /> Try Again</button></Row></Group>;
}

/** The video worker's Restart: it asks its ComfyUI-Manager, then the status row follows it down and back. */
export function VideoWorkerRestart({ confirm, showToast }: { confirm: () => Promise<boolean>; showToast: ShowToast }) {
  const [phase, setPhase] = React.useState<'' | 'busy' | 'sent'>('');
  const restart = async () => {
    if (!await confirm()) return;
    setPhase('busy');
    try {
      const { response, data } = await postJson('/api/comfy/restart', { backend: 'video' });
      if (!response.ok) { showToast(data.error || 'Couldn’t restart the video worker', 'error'); setPhase(''); return; }
      setPhase('sent');
      window.setTimeout(() => setPhase(''), 20_000);
    } catch { showToast('Can’t reach Studio. Make sure it’s running.', 'error'); setPhase(''); }
  };
  return <button type="button" className="btn" disabled={Boolean(phase)} onClick={() => void restart()}>
    {phase === 'sent' ? <Check size={14} /> : <RotateCw size={14} className={phase === 'busy' ? 'is-spinning' : undefined} />}
    {phase === 'sent' ? 'Restarting' : phase === 'busy' ? 'Asking…' : 'Restart'}
  </button>;
}
