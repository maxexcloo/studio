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
type AssistantModel = Source & { key: string; configured: string; effective: string; vision?: boolean };
/** The prompt assistant's gateway models (server/assistant-routes.js assistantIntegration). */
type AssistantIntegration = { available: boolean; note?: string; writerModel: string; models: string[]; model: AssistantModel; spicy: AssistantModel };
export type DeploymentSettings = {
  defaults: { image: DefaultProfile; video: DefaultProfile; profiles: { id: string; label: string; kind: string; ready: boolean }[] };
  catalogue: CatalogueFlag[];
  integrations: { civitai: { token: TokenStatus; presets: boolean }; huggingFace: { token: TokenStatus }; assistant?: AssistantIntegration };
  storage: Source & { outputs: 'studio' | 'comfy'; workerToken: boolean; multiUser: boolean };
};

const FIRST_READY = '__first-ready__';
// Inpainting is switched in Studio › Features, beside Upscale.
export const inpaintFlagKey = 'STUDIO_ENABLE_INPAINT';
// LoRAs, Cloud Models and Presets & Civitai Imports are access-profile features (Settings › Users); an older server may still list them.
const hiddenCatalogueKeys = new Set([inpaintFlagKey, 'STUDIO_ENABLE_LORAS', 'STUDIO_ENABLE_GROK', 'STUDIO_ENABLE_PRESETS']);
const sourceWords: Record<Source['source'], string> = { deployment: 'Deployment', studio: 'This Studio', default: 'Default' };

/** Where a value comes from, and a lock when the deployment owns it. */
export function SourceTag({ source, locked }: Source) {
  return <span className={cn('set-source', `is-${source}`)} title={locked ? 'Set in the server configuration; change it there' : undefined}>
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
      setError(reason instanceof Error ? reason.message : 'Couldn’t load server settings');
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

/** Saves one deployment setting, with its outcome in the status pill. */
function useSaveSetting(showToast: ShowToast, onSaved: () => void) {
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
  return { busy, save };
}

/** Settings › Models › Defaults: the profiles a fresh composer starts on. */
export function DefaultsGroup({ settings, showToast, onSaved }: { settings: DeploymentSettings; showToast: ShowToast; onSaved: () => void }) {
  const { busy, save } = useSaveSetting(showToast, onSaved);
  const label = (id: string) => settings.defaults.profiles.find((profile) => profile.id === id)?.label || id;
  const defaultRow = (kind: 'image' | 'video') => {
    const entry = settings.defaults[kind];
    const options = [{ label: 'First Ready Profile', value: FIRST_READY }, ...settings.defaults.profiles.filter((profile) => profile.kind === kind).map((profile) => ({ label: `${profile.label}${profile.ready ? '' : ' (Not Ready)'}`, value: profile.id }))];
    if (entry.configured && !options.some((option) => option.value === entry.configured)) options.push({ label: `${entry.configured} (Unavailable)`, value: entry.configured });
    const missing = entry.configured && entry.configured !== entry.effective;
    return <Row key={kind} label={<>{kind === 'image' ? 'Default Image Profile' : 'Default Video Profile'} <SourceTag source={entry.source} locked={entry.locked} /></>} description={entry.effective ? `${missing ? `${entry.configured} isn’t ready, so new drafts start on ` : 'New drafts start on '}${label(entry.effective)}` : `No ${kind} profile is ready`} disabled={busy === entry.key}>
      {entry.locked ? <span className="set-locked-value">{entry.configured ? label(entry.configured) : 'First Ready Profile'}</span> : <div className="set-type-picker"><StudioSelect ariaLabel={kind === 'image' ? 'Default Image Profile' : 'Default Video Profile'} value={entry.configured || FIRST_READY} options={options} onChange={(value) => void save(entry.key, value === FIRST_READY ? '' : value)} /></div>}
    </Row>;
  };
  return <Group title="Defaults" note="Locked values come from the server configuration and can only be changed there">
    {defaultRow('image')}
    {defaultRow('video')}
  </Group>;
}

/** Library › Models › Catalogue: the catalogue switches that remain global (none when every one is an access-profile feature). */
export function CatalogueFlagsGroup({ settings, showToast, onSaved }: { settings: DeploymentSettings; showToast: ShowToast; onSaved: () => void }) {
  const { busy, save } = useSaveSetting(showToast, onSaved);
  const catalogue = settings.catalogue.filter((item) => !hiddenCatalogueKeys.has(item.key));
  return catalogue.length ? <Group title="Catalogue" note="What the model catalogue offers">
    {catalogue.map((item) => <SwitchRow key={item.key} label={item.label} tag={<SourceTag source={item.source} locked={item.locked} />} description={`${item.description.replace(/\.$/, '')}${item.applies === 'restart' ? '; applies after a restart' : ''}`} checked={item.value} disabled={item.locked || busy === item.key} onChange={(next) => void save(item.key, next)} />)}
  </Group> : null;
}

const DEFAULT_MODEL = '__default__';

/** The prompt assistant's two models: the everyday one and the uncensored one for Spicy. */
function AssistantRows({ assistant, showToast, onSaved }: { assistant: AssistantIntegration; showToast?: ShowToast; onSaved?: () => void }) {
  const [busy, setBusy] = React.useState('');
  if (!assistant.available) return <Row label="Assistant Model" description={(assistant.note || 'The prompt assistant isn’t set up').replace(/\.$/, '')}><Status>Off</Status></Row>;
  const save = async (key: string, value: string) => {
    setBusy(key);
    try {
      const { response, data } = await postJson('/api/settings/deployment', { key, value });
      if (!response.ok) { showToast?.(data.error || 'Couldn’t save that setting.', 'error'); return; }
      showToast?.('Saved', 'success');
      onSaved?.();
    } catch { showToast?.('Can’t reach Studio. Make sure it’s running.', 'error'); }
    finally { setBusy(''); }
  };
  const options = (entry: AssistantModel, first: { label: string; value: string }) => {
    const list = [first, ...assistant.models.map((model) => ({ label: model, value: model }))];
    if (entry.configured && !assistant.models.includes(entry.configured)) list.push({ label: `${entry.configured} (Not Listed)`, value: entry.configured });
    return list;
  };
  const vision = (on?: boolean) => on ? 'reads reference images' : 'text only, reference images aren’t read';
  const row = (entry: AssistantModel, label: string, description: string, first: { label: string; value: string }) => <Row key={entry.key} label={<>{label} <SourceTag source={entry.source} locked={entry.locked} /></>} description={description} disabled={busy === entry.key}>
    {entry.locked ? <span className="set-locked-value">{entry.configured || first.label}</span> : <div className="set-type-picker"><StudioSelect ariaLabel={label} value={entry.configured || first.value} options={options(entry, first)} onChange={(value) => void save(entry.key, value === first.value ? '' : value)} /></div>}
  </Row>;
  return <>
    {row(assistant.model, 'Assistant Model', `Rewrites prompts, writes negatives and suggests LoRAs · ${vision(assistant.model.vision)}`, { label: `Prompt Writer Model (${assistant.writerModel})`, value: DEFAULT_MODEL })}
    {row(assistant.spicy, 'Assistant Spicy Model', assistant.spicy.effective ? `Uncensored model for the Spicy preset, for accounts with NSFW Models · ${vision(assistant.spicy.vision)}` : 'Uncensored model for the Spicy preset, for accounts with NSFW Models; Spicy stays hidden until one is chosen', { label: 'Off', value: DEFAULT_MODEL })}
  </>;
}

/** Third-party services and storage at a glance: what is on, configured and available. */
export function IntegrationsOverview({ settings, showToast, onSaved }: { settings: DeploymentSettings; showToast?: ShowToast; onSaved?: () => void }) {
  const { civitai, assistant } = settings.integrations;
  const state = (on: boolean, words: [string, string]) => <Status tone={on ? 'ok' : undefined}>{on ? words[0] : words[1]}</Status>;
  return <Group title="Integrations">
    {assistant ? <AssistantRows assistant={assistant} showToast={showToast} onSaved={onSaved} /> : null}
    <Row label="Civitai" description={`Token ${civitai.token.set ? 'saved' : 'not set'}${civitai.token.set && !civitai.token.editable ? ' in the server configuration' : ''} · presets ${civitai.presets ? 'on' : 'off'} · PNGs carry settings Civitai can read`}>{state(civitai.token.set || civitai.presets, ['On', 'Off'])}</Row>
    <Row label={<>Output Storage <SourceTag source={settings.storage.source} locked={settings.storage.locked} /></>} description={settings.storage.outputs === 'studio' ? `Studio keeps finished outputs${settings.storage.workerToken ? ' · worker token set' : ''}` : 'Finished outputs stay in ComfyUI’s output folder'}>{state(settings.storage.outputs === 'studio', ['Studio Media', 'ComfyUI Folder'])}</Row>
  </Group>;
}

export function DeploymentSettingsError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <Group><Row label="Deployment Settings Unavailable" description={error}><button className="btn is-ghost" onClick={onRetry}><RefreshCw size={14} /> Try Again</button></Row></Group>;
}
