import React from 'react';
import { Check, ExternalLink, Pencil, PlugZap, Plus, RotateCw } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import { EmptyState } from './EmptyState';
import { SourceTag } from './DeploymentSettings';
import { MultiSelect } from './MultiSelect';
import { Group, GroupAction, Row, SaveRow, Status } from './SettingsControls';
import type { ShowToast } from './toast';
import type { ComfyStatus, WorkerState } from './types';

/*
 * Settings › Workers (UI-PATTERNS › Settings): every ComfyUI worker in one
 * standard group, headed by its name, with the same rows in the same order
 * (Address, Capabilities, Status with Test, Open, Restart) and the same words;
 * only its capabilities differ. An action that doesn't apply stays in its
 * place, off, with a short reason. Add Worker sits on the Workers heading,
 * like New Account; Studio's own workers are edited in place (Name, Address,
 * Capabilities as a multi-select, Remove) as one draft with one Save &
 * Discard row; the deployment's are locked.
 */

export type WorkerCapability = 'image' | 'video' | 'upscale' | 'models';
type Source = 'deployment' | 'studio' | 'default';
/** One worker as /api/workers lists it (server/workers.js). */
export type Worker = { id: string; name: string; url: string; capabilities: WorkerCapability[]; source: Source; locked: boolean };
type CapabilityInfo = { id: WorkerCapability; label: string; description: string };
type WorkerList = { workers: Worker[]; capabilities: CapabilityInfo[]; deployment: { variable: string } };
/** A worker being edited; `key` stays put while a new worker has no id yet. */
type Draft = { key: string; id: string; name: string; url: string; capabilities: WorkerCapability[] };

// Alphabetical by label: Image · Model Library · Upscale · Video.
const capabilityOrder: WorkerCapability[] = ['image', 'models', 'upscale', 'video'];
const fallbackCapabilities: CapabilityInfo[] = [
  { id: 'image', label: 'Image', description: '' },
  { id: 'video', label: 'Video', description: '' },
  { id: 'upscale', label: 'Upscale', description: '' },
  { id: 'models', label: 'Model Library', description: '' }
];
const toDraft = (worker: Worker): Draft => ({ key: worker.id, id: worker.id, name: worker.name, url: worker.url, capabilities: [...worker.capabilities] });
const sameDraft = (a: Draft[], b: Draft[]) => JSON.stringify(a.map(({ key: _key, ...rest }) => rest)) === JSON.stringify(b.map(({ key: _key, ...rest }) => rest));

async function sendJson<T>(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const response = await apiFetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export function useWorkers(enabled: boolean) {
  const [list, setList] = React.useState<WorkerList | null>(null);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    if (!enabled) return;
    try {
      setList(await apiJson<WorkerList & { ok: boolean }>('/api/workers', { cache: 'no-store' }));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t load the workers.');
    }
  }, [enabled]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  return { list, setList, error, refresh };
}

/** Where a worker's status stands, in one word and one line. */
function statusWords(live: WorkerState | undefined, saved: boolean): { tone?: 'ok' | 'bad' | 'warn'; word: string; detail: string } {
  if (!saved) return { word: 'Not Saved', detail: 'Save to connect' };
  if (!live) return { word: 'Checking', detail: 'Checking…' };
  if (live.restarting) return { tone: 'warn', word: 'Restarting', detail: 'Reconnects when it’s back' };
  if (live.busy) return { tone: 'warn', word: 'Busy', detail: `${live.device ? `${live.device} · ` : ''}Slow to answer; its runs carry on` };
  if (live.connected) return { tone: 'ok', word: 'Ready', detail: live.device || 'Ready to generate' };
  return { tone: 'bad', word: 'Offline', detail: 'Studio can’t reach it' };
}

/** A row's action, or the same action off with a short reason in its place. */
function Action({ reason, children }: React.PropsWithChildren<{ reason?: string }>) {
  return <>{reason ? <span className="set-action-reason">{reason}</span> : null}{children}</>;
}

/**
 * Restart through the worker's ComfyUI-Manager, then follow its status until
 * it went down and came back (or a while passed). Acts at once: it is
 * reversible (UI-PATTERNS › Messages).
 */
function useWorkerRestart(worker: Draft, live: WorkerState | undefined, showToast: ShowToast, onBack: () => void) {
  const [phase, setPhase] = React.useState<'' | 'asking' | 'restarting'>('');
  const sawDown = React.useRef(false);
  React.useEffect(() => {
    if (phase !== 'restarting') return;
    if (!live?.connected || live.restarting) sawDown.current = true;
    else if (sawDown.current) { setPhase(''); onBack(); showToast(`${worker.name} is back`, 'success'); }
  }, [phase, live?.connected, live?.restarting]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (phase !== 'restarting') return;
    const timer = window.setTimeout(() => setPhase(''), 120_000);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const restart = async () => {
    setPhase('asking');
    sawDown.current = false;
    try {
      const { ok, data } = await sendJson('/api/comfy/restart', 'POST', { worker: worker.id });
      if (!ok) { showToast(data.error || `Couldn’t restart ${worker.name}`, 'error'); setPhase(''); return; }
      setPhase('restarting');
      window.dispatchEvent(new CustomEvent('studio:comfy-restart'));
    } catch {
      showToast('Can’t reach Studio. Make sure it’s running.', 'error');
      setPhase('');
    }
  };
  return { phase, restart };
}

/** One worker, the same for every worker: only its capabilities differ. */
export function WorkerGroup({ worker, source, locked, saved, live, editing, capabilities, showToast, onEdit, onChange, onRemove, onCheck, onBack }: {
  worker: Draft;
  source: Source;
  locked: boolean;
  /** Saved as shown: the address and capabilities match what Studio runs. */
  saved: boolean;
  live: WorkerState | undefined;
  editing: boolean;
  capabilities: CapabilityInfo[];
  showToast: ShowToast;
  onEdit: () => void;
  onChange: (next: Draft) => void;
  onRemove: () => void;
  onCheck: () => void;
  onBack: () => void;
}) {
  const [testing, setTesting] = React.useState(false);
  const [tested, setTested] = React.useState('');
  React.useEffect(() => { setTested(''); }, [worker.url]);
  const { phase, restart } = useWorkerRestart(worker, live, showToast, onBack);
  const labels = capabilityOrder.filter((id) => worker.capabilities.includes(id)).map((id) => capabilities.find((item) => item.id === id)?.label || id);
  const status = statusWords(phase === 'restarting' && live ? { ...live, restarting: true } : live, saved);
  const test = async () => {
    setTesting(true);
    try {
      const { ok, data } = await sendJson<{ reachable: boolean; detail?: string; device?: string }>('/api/workers/test', 'POST', saved ? { id: worker.id } : { url: worker.url });
      setTested(!ok ? data.error || 'Couldn’t test it' : data.reachable ? `Answered just now${data.device ? ` · ${data.device}` : ''}` : data.detail || 'Didn’t answer');
      if (saved) onCheck();
    } catch { setTested('Can’t reach Studio'); }
    finally { setTesting(false); }
  };
  const setCapabilities = (values: string[]) => onChange({ ...worker, capabilities: capabilityOrder.filter((item) => values.includes(item)) });
  const capabilityOptions = capabilityOrder.map((id) => ({ value: id, label: capabilities.find((item) => item.id === id)?.label || id })).sort((x, y) => x.label.localeCompare(y.label));
  const openReason = !saved ? 'Save first' : !live?.connected ? 'Offline' : '';
  const restartReason = !saved ? 'Save first' : phase === 'restarting' || live?.restarting ? '' : !live?.connected ? 'Offline' : '';
  const name = worker.name.trim() || 'New Worker';
  return (
    <Group title={name} className="set-worker">
      {editing ? <Row label="Name">
        <input className="modal-input account-field" value={worker.name} onChange={(event) => onChange({ ...worker, name: event.target.value })} aria-label={`${name} Name`} autoComplete="off" maxLength={60} placeholder="Image Worker" />
      </Row> : null}
      <Row label={<>Address <SourceTag source={source} locked={locked} /></>} description={editing ? undefined : <code className="set-path is-oneline">{worker.url || 'Not set'}</code>}>
        {editing
          ? <input className="modal-input account-field" value={worker.url} onChange={(event) => onChange({ ...worker, url: event.target.value })} aria-label={`${name} Address`} spellCheck={false} autoComplete="off" placeholder="http://127.0.0.1:8188" />
          : <Action reason={locked ? 'Locked' : ''}><button type="button" className="btn is-ghost" disabled={locked} aria-label={`Edit ${name}`} onClick={onEdit}><Pencil size={14} /> Edit</button></Action>}
      </Row>
      <Row label="Capabilities" description={editing ? (worker.capabilities.length ? undefined : 'Pick at least one') : labels.join(' · ') || 'None'}>
        {editing ? <MultiSelect label={`${name} Capabilities`} values={worker.capabilities} options={capabilityOptions} onChange={setCapabilities} searchFrom={Infinity} /> : null}
      </Row>
      <Row label="Status" description={tested || status.detail}>
        <Status tone={status.tone}>{status.word}</Status>
        <button type="button" className="btn is-ghost" disabled={testing || !worker.url.trim()} aria-label={`Test ${name}`} onClick={() => void test()}><PlugZap size={14} /> {testing ? 'Testing…' : 'Test'}</button>
      </Row>
      <Row label="Open" description="Its ComfyUI page, in a new tab">
        <Action reason={openReason}>
          {openReason
            ? <button type="button" className="btn is-ghost" disabled aria-label={`Open ${name}`}><ExternalLink size={14} /> Open</button>
            : <a className="btn is-ghost" href={live?.url || worker.url} target="_blank" rel="noreferrer" aria-label={`Open ${name}`}><ExternalLink size={14} /> Open</a>}
        </Action>
      </Row>
      <Row label="Restart" description="Loads new nodes and frees memory; running and queued jobs stop">
        <Action reason={restartReason}>
          <button type="button" className="btn" disabled={Boolean(restartReason) || Boolean(phase) || Boolean(live?.restarting)} aria-label={`Restart ${name}`} onClick={() => void restart()}>
            {phase === 'restarting' || live?.restarting ? <Check size={14} /> : <RotateCw size={14} className={phase === 'asking' ? 'is-spinning' : undefined} />}
            {phase === 'restarting' || live?.restarting ? 'Restarting' : phase === 'asking' ? 'Asking…' : 'Restart'}
          </button>
        </Action>
      </Row>
      {locked ? null : <Row label="Remove" description="Takes it out of Studio when you save">
        <GroupAction className="set-group-action is-danger" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</GroupAction>
      </Row>}
    </Group>
  );
}

let newKey = 0;

/**
 * Every worker, the deployment's first (locked), then Studio's own, which
 * administrators add, edit and remove as one draft. `status` is the app's
 * status poll; `onChanged` refreshes what depends on the workers.
 */
export function WorkerSettings({ status, showToast, onChanged, onCheck }: { status: ComfyStatus | null; showToast: ShowToast; onChanged: () => void; onCheck: () => void }) {
  const { list, setList, error, refresh } = useWorkers(true);
  const [draft, setDraft] = React.useState<Draft[] | null>(null);
  const [editing, setEditing] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const saved = React.useMemo(() => (list?.workers || []).filter((worker) => !worker.locked).map(toDraft), [list]);
  const own = draft ?? saved;
  const dirty = Boolean(draft) && !sameDraft(draft || [], saved);
  const capabilities = list?.capabilities?.length ? list.capabilities : fallbackCapabilities;
  const live = (id: string) => status?.workers?.find((worker) => worker.id === id);
  const savedById = new Map((list?.workers || []).map((worker) => [worker.id, worker]));
  const isSaved = (worker: Draft) => {
    const current = worker.id ? savedById.get(worker.id) : undefined;
    return Boolean(current && current.url === worker.url.trim().replace(/\/+$/, '') && JSON.stringify(current.capabilities) === JSON.stringify(worker.capabilities));
  };
  const update = (key: string, next: Draft | null) => setDraft((own).flatMap((worker) => (worker.key === key ? (next ? [next] : []) : [worker])));
  const add = () => {
    const key = `new-${++newKey}`;
    setDraft([...own, { key, id: '', name: 'New Worker', url: '', capabilities: ['image'] }]);
    setEditing((current) => new Set(current).add(key));
  };
  const discard = () => { setDraft(null); setEditing(new Set()); };
  const save = async () => {
    setBusy(true);
    try {
      const { ok, data } = await sendJson<WorkerList>('/api/workers', 'PUT', { workers: own.map(({ id, name, url, capabilities: caps }) => ({ ...(id ? { id } : {}), name: name.trim(), url: url.trim(), capabilities: caps })) });
      if (!ok) { showToast(data.error || 'Couldn’t save the workers', 'error'); return; }
      setList(data);
      setDraft(null);
      setEditing(new Set());
      showToast('Workers saved', 'success');
      onChanged();
    } catch {
      showToast('Can’t reach Studio. Make sure it’s running.', 'error');
    } finally { setBusy(false); }
  };
  if (!list) {
    return error
      ? <Group><Row label="Workers Unavailable" description={error}><button type="button" className="btn is-ghost" onClick={() => void refresh()}>Try Again</button></Row></Group>
      : <Group title="Workers"><Row label="Loading…" /></Group>;
  }
  const locked = list.workers.filter((worker) => worker.locked);
  const canSave = own.every((worker) => worker.name.trim() && worker.url.trim() && worker.capabilities.length);
  const fromDeployment = list.deployment.variable === 'STUDIO_WORKERS';
  return (
    <>
      <Group title="Workers" action={<GroupAction onClick={add} disabled={busy}><Plus size={13} aria-hidden="true" /> Add Worker</GroupAction>} note={fromDeployment ? 'Locked workers come from the deployment; ones you add run beside them' : undefined} />
      {!locked.length && !own.length ? <EmptyState title="No Workers Yet">Add a ComfyUI worker to make images and videos.</EmptyState> : null}
      {locked.map((worker) => <WorkerGroup key={worker.id} worker={toDraft(worker)} source={worker.source} locked saved live={live(worker.id)} editing={false} capabilities={capabilities} showToast={showToast} onEdit={() => {}} onChange={() => {}} onRemove={() => {}} onCheck={onCheck} onBack={onChanged} />)}
      {own.map((worker) => <WorkerGroup
        key={worker.key}
        worker={worker}
        source={savedById.get(worker.id)?.source || 'studio'}
        locked={false}
        saved={isSaved(worker)}
        live={live(worker.id)}
        editing={editing.has(worker.key)}
        capabilities={capabilities}
        showToast={showToast}
        onEdit={() => { setDraft(own); setEditing((current) => new Set(current).add(worker.key)); }}
        onChange={(next) => update(worker.key, next)}
        onRemove={() => update(worker.key, null)}
        onCheck={onCheck}
        onBack={onChanged}
      />)}
      {dirty ? <Group>
        <SaveRow dirty busy={busy} onSave={() => void save()} onDiscard={discard} canSave={canSave} note={canSave ? 'Studio tests new and changed workers once saved' : 'Each worker needs a name, an address and a capability'} />
      </Group> : null}
    </>
  );
}
