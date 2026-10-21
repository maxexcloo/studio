import React from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { StudioSelect } from './components';
import { cn } from './format';
import { Group, Row, Status, SwitchRow } from './SettingsControls';
import type { ShowToast } from './toast';

/** What /api/settings/deployment reports (server/deployment-settings.js). */
export type Source = { source: 'deployment' | 'studio' | 'default'; locked: boolean };
type DefaultProfile = Source & { key: string; configured: string; effective: string };
type CatalogueFlag = Source & { key: string; label: string; description: string; value: boolean; defaultOn: boolean; applies: 'now' | 'restart' };
type TokenStatus = { set: boolean; editable: boolean; source?: string };
export type DeploymentSettings = {
  defaults: { image: DefaultProfile; video: DefaultProfile; profiles: { id: string; label: string; kind: string; ready: boolean }[] };
  catalogue: CatalogueFlag[];
  integrations: { civitai: { token: TokenStatus; presets: boolean }; huggingFace: { token: TokenStatus } };
  storage: Source & { outputs: 'studio' | 'comfy'; workerToken: boolean; multiUser: boolean };
};

const FIRST_READY = '__first-ready__';
// Inpainting is switched in Studio › Features, beside Upscale.
export const inpaintFlagKey = 'HEISS_ENABLE_INPAINT';
// LoRAs, Cloud Models and Presets & Civitai Imports are access-profile features (Settings › Users); an older server may still list them.
const hiddenCatalogueKeys = new Set([inpaintFlagKey, 'STUDIO_ENABLE_LORAS', 'STUDIO_ENABLE_GROK', 'STUDIO_ENABLE_PRESETS']);
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
  const catalogue = settings.catalogue.filter((item) => !hiddenCatalogueKeys.has(item.key));
  return <>
    <Group title="Defaults" note="Deployment settings override these until they are removed from its configuration.">
      {defaultRow('image')}
      {defaultRow('video')}
    </Group>
    {catalogue.length ? <Group title="Catalogue" note="What the model catalogue offers. Some changes apply after Studio restarts.">
      {catalogue.map((item) => <SwitchRow key={item.key} label={item.label} tag={<SourceTag source={item.source} locked={item.locked} />} description={`${item.description}${item.applies === 'restart' ? ' Applies after a restart.' : ''}`} checked={item.value} disabled={item.locked || busy === item.key} onChange={(next) => void save(item.key, next)} />)}
    </Group> : null}
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
