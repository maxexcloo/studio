import React from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';
import { apiJson } from './api';
import { Skeleton } from './components';
import { ListSelect } from './SheetList';
import { Group, Row, SaveRow, Status } from './SettingsControls';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

/*
 * Settings › Workers › AI Control: what each GPU runs, from AI Control
 * through Studio's server (server/ai-control-routes.js). Administrators pick
 * a workload per GPU, read the preview of what stops and starts, confirm any
 * interruption and apply it; the status pill follows the change. It is
 * manual only: nothing here switches a GPU on its own.
 */

type Workload = { profile: string; label: string; runtime: string; kind: string; placements: string[] };
type Catalogue = { workloads: Workload[]; runtimeNames: Record<string, string> };
type Runtime = { running: boolean; profile: string; devices: string[]; health: string };
type Gpu = { device: string; name: string; availability: string };
type Job = { id: string; state: string; stage: string; allocation?: Card[]; restart?: { runtime: string; profile: string; devices: string[] } };
type ControlStatus = { updated: string; gpus: Gpu[]; runtimes: Record<string, Runtime>; job: Job | null };
type Card = { profile: string; devices: string[] };
type Plan = { keep: string[]; stop: string[]; start: Array<Card & { runtime: string }>; signature: string };
type StatusReply = { configured: boolean; admin?: boolean; status?: ControlStatus; catalogue?: Catalogue };

const EMPTY = 'off';
const POLL_MS = 5000;
const gpuName = (device: string) => `GPU ${Number(device) + 1}`;
const gpusName = (devices: string[]) => devices.length > 1 ? 'Both GPUs' : gpuName(devices[0]);
const canonical = (cards: Card[]) => JSON.stringify([...cards].map((card) => ({ profile: card.profile, devices: [...card.devices].sort() })).sort((a, b) => a.devices.join().localeCompare(b.devices.join())));
const healthWord = (health: string) => health === 'healthy' ? 'Ready' : health === 'starting' ? 'Starting' : health ? health.charAt(0).toUpperCase() + health.slice(1) : 'Unknown';
const post = <T,>(url: string, body: unknown) => apiJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const wordsList = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Whether this Studio knows an AI Control, known once per page so Settings draws its sections at once. */
let knownAvailability: { configured: boolean; admin: boolean } | null = null;
export function useAiControlAvailability(open: boolean) {
  const [availability, setAvailability] = React.useState(knownAvailability);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    apiJson<{ configured: boolean; admin: boolean }>('/api/ai-control', { cache: 'no-store' }).then((reply) => {
      knownAvailability = { configured: Boolean(reply.configured), admin: Boolean(reply.admin) };
      if (live) setAvailability(knownAvailability);
    }).catch(() => null);
    return () => { live = false; };
  }, [open]);
  return availability;
}

/**
 * Follows one AI Control job in the status pill until it ends, whether or
 * not Settings stays open.
 */
function followJob(job: Job, words: { running: string; done: string; failed: string }, showToast: ShowToast, onEnd: (job: Job) => void) {
  const id = `ai-control-${job.id}`;
  let misses = 0;
  const say = (current: Job) => showToast(`${words.running}${current.stage ? ` · ${current.stage}` : ''}`, 'default', { id, duration: Infinity });
  say(job);
  const tick = async () => {
    try {
      const { job: current } = await apiJson<{ job: Job }>(`/api/ai-control/jobs/${encodeURIComponent(job.id)}`, { cache: 'no-store' });
      misses = 0;
      if (current.state === 'running' || current.state === 'queued') { say(current); window.setTimeout(tick, 2000); return; }
      if (current.state === 'completed') showToast(words.done, 'success', { id });
      else showToast(`${words.failed}${current.stage && current.stage !== 'Failed' ? ` · ${current.stage}` : ''}`, 'error', { id });
      onEnd(current);
    } catch {
      // A blip while a worker restarts is normal; give up only after a minute without an answer.
      if (++misses < 30) { window.setTimeout(tick, 2000); return; }
      showToast(`${words.failed} · Check AI Control`, 'error', { id });
      onEnd({ ...job, state: 'failed' });
    }
  };
  window.setTimeout(tick, 1500);
}

/** The heading for AI Control under Settings › Workers. Ordinary accounts see it read only. */
export function AiControlGroup({ admin, phone, showToast, confirmAction }: { admin: boolean; phone: boolean; showToast: ShowToast; confirmAction: ConfirmAction }) {
  const [reply, setReply] = React.useState<StatusReply | null>(null);
  const [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState<Card[] | null>(null);
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [planError, setPlanError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [following, setFollowing] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const refresh = React.useCallback(async () => {
    try {
      const next = await apiJson<StatusReply>('/api/ai-control/status', { cache: 'no-store' });
      if (!mounted.current) return;
      setReply(next);
      setError('');
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'AI Control is unavailable.');
    }
  }, []);
  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const status = reply?.status;
  const catalogue = reply?.catalogue;
  const workloads = React.useMemo(() => new Map((catalogue?.workloads || []).map((item) => [item.profile, item])), [catalogue]);
  const label = (profile: string) => workloads.get(profile)?.label || profile;
  const runtimeLabel = (name: string) => {
    const running = status?.runtimes[name];
    return running?.running && running.profile ? label(running.profile) : catalogue?.runtimeNames[name] || name;
  };
  const live = React.useMemo<Card[]>(() => Object.values(status?.runtimes || {}).filter((item) => item.running).map((item) => ({ profile: item.profile, devices: [...item.devices].sort() })), [status]);
  const board = draft ?? live;
  const dirty = Boolean(draft) && canonical(board) !== canonical(live);
  const liveKey = canonical(live);
  const boardKey = canonical(board);
  const job = status?.job && status.job.state === 'running' ? status.job : null;

  // A draft that the live board caught up with is no draft any more.
  React.useEffect(() => { if (draft && boardKey === liveKey && !following) setDraft(null); }, [boardKey, liveKey, following]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview follows the draft and the live board: a change elsewhere makes the old one stale.
  React.useEffect(() => {
    if (!admin || !dirty) { setPlan(null); setPlanError(''); return; }
    let current = true;
    setPlan(null);
    setPlanError('');
    post<{ plan: Plan }>('/api/ai-control/plan', { allocation: board }).then((result) => { if (current) setPlan(result.plan); })
      .catch((reason) => { if (current) setPlanError(reason instanceof Error ? reason.message : 'Couldn’t preview the change'); });
    return () => { current = false; };
  }, [admin, dirty, boardKey, liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Puts a workload on its GPUs, taking off whatever shared them or ran the same runtime, as AI Control's board does. */
  const place = (device: string, value: string) => {
    if (value === EMPTY) { setDraft(board.filter((card) => !card.devices.includes(device))); return; }
    const [profile, placement] = value.split(':');
    const devices = placement.split(',');
    const runtime = workloads.get(profile)?.runtime;
    setDraft([...board.filter((card) => workloads.get(card.profile)?.runtime !== runtime && !card.devices.some((used) => devices.includes(used))), { profile, devices }]);
  };

  const apply = async () => {
    if (!plan || busy) return;
    if (plan.stop.length && !await confirmAction({
      title: `Stop ${wordsList(plan.stop.map(runtimeLabel))}?`,
      description: 'What it is running now is interrupted: generations, chats and queued work on it stop. The change takes a minute or two.',
      action: 'Apply',
      destructive: true
    })) return;
    setBusy(true);
    try {
      const { job: started } = await post<{ job: Job }>('/api/ai-control/apply', { allocation: board, signature: plan.signature });
      setFollowing(true);
      followJob(started, { running: 'Applying the GPU change', done: 'GPU change applied', failed: 'Couldn’t apply the GPU change' }, showToast, (ended) => {
        if (!mounted.current) return;
        setFollowing(false);
        if (ended.state === 'completed') setDraft(null);
        void refresh();
      });
      void refresh();
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Couldn’t apply the GPU change', 'error');
      void refresh();
    } finally { if (mounted.current) setBusy(false); }
  };

  const restart = async (runtime: string, item: Runtime) => {
    const name = label(item.profile);
    if (!await confirmAction({ title: `Restart ${name}?`, description: `It starts again on ${gpusName(item.devices)}. What it is running now stops.`, action: 'Restart', destructive: true })) return;
    setBusy(true);
    try {
      const { job: started } = await post<{ job: Job }>('/api/ai-control/restart', { runtime, profile: item.profile, devices: item.devices });
      followJob(started, { running: `Restarting ${name}`, done: `${name} restarted`, failed: `Couldn’t restart ${name}` }, showToast, () => { if (mounted.current) void refresh(); });
      void refresh();
    } catch (reason) { showToast(reason instanceof Error ? reason.message : `Couldn’t restart ${name}`, 'error'); }
    finally { if (mounted.current) setBusy(false); }
  };

  const title = 'AI Control';
  if (!reply && !error) return <Group title={title}><Row label={<Skeleton className="skeleton-text short" />} /></Group>;
  if (reply && !reply.configured) {
    return admin ? <Group title={title}>
      <Row label="Status" description="Set CONTROL_URL and CONTROL_API_KEY in the deployment to choose what each GPU runs from here."><Status>Not Connected</Status></Row>
    </Group> : null;
  }
  if (!status || !catalogue) {
    return <Group title={title}>
      <Row label="Status" description={error || 'AI Control is unavailable.'}>
        <Status tone="bad">Unavailable</Status>
        <button className="btn is-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Try Again</button>
      </Row>
    </Group>;
  }

  // One row per GPU, or one for both when a workload spans them.
  const rows: Array<{ devices: string[]; card?: Card }> = [];
  for (const gpu of status.gpus) {
    if (rows.some((row) => row.devices.includes(gpu.device))) continue;
    const card = board.find((item) => item.devices.includes(gpu.device));
    rows.push({ devices: card && card.devices.length > 1 ? card.devices : [gpu.device], card });
  }
  const hardware = (devices: string[]) => [...new Set(devices.map((device) => status.gpus.find((gpu) => gpu.device === device)?.name).filter(Boolean))].join(' · ');
  const liveOn = (devices: string[]) => Object.entries(status.runtimes).filter(([, item]) => item.running && item.devices.some((device) => devices.includes(device)));
  const planWords = (current: Plan) => {
    if (!current.stop.length && !current.start.length) return 'No changes needed.';
    return [
      current.stop.length ? `Stops ${wordsList(current.stop.map(runtimeLabel))}.` : '',
      current.start.length ? `Starts ${wordsList(current.start.map((item) => `${label(item.profile)} on ${gpusName(item.devices)}`))}.` : '',
      current.keep.length ? `Keeps ${wordsList(current.keep.map(runtimeLabel))}.` : '',
      current.stop.length ? 'What the stopped workloads are running is interrupted.' : ''
    ].filter(Boolean).join(' ');
  };

  return <Group title={title} note={admin ? 'GPUs change only when you apply a change here or in AI Control. A preview shows what stops and starts first.' : 'Administrators choose what each GPU runs.'}>
    {rows.map(({ devices, card }) => {
      const key = devices.join(',');
      const owners = liveOn(devices);
      const nowLabel = owners.length ? wordsList(owners.map(([, item]) => label(item.profile))) : 'Nothing';
      const health = owners.length ? (owners.every(([, item]) => item.health === 'healthy') ? 'Ready' : healthWord(owners.find(([, item]) => item.health !== 'healthy')![1].health)) : 'Idle';
      const tone = health === 'Ready' ? 'ok' : health === 'Idle' ? undefined : health === 'Starting' ? 'warn' : 'bad';
      const changed = dirty && canonical(card ? [card] : []) !== canonical(live.filter((item) => item.devices.some((device) => devices.includes(device))));
      const rowLabel = devices.length > 1 ? 'GPU 1 & 2' : gpuName(devices[0]);
      const description = changed ? `Now ${nowLabel}` : [hardware(devices), owners.length ? health : ''].filter(Boolean).join(' · ') || health;
      if (!admin) {
        return <Row key={key} label={rowLabel} description={[hardware(devices), nowLabel === 'Nothing' ? 'Nothing running' : nowLabel].filter(Boolean).join(' · ')}><Status tone={tone}>{health}</Status></Row>;
      }
      const options = [{ value: EMPTY, label: 'Empty' }, ...catalogue.workloads.flatMap((workload) => workload.placements
        .filter((placement) => devices.length > 1 ? true : placement === devices[0] || placement.split(',').length > 1)
        .map((placement) => ({ value: `${workload.profile}:${placement}`, label: placement.split(',').length > 1 || devices.length > 1 ? `${workload.label} · ${gpusName(placement.split(','))}` : workload.label })))];
      const restartable = !dirty && !job && owners.length === 1 && owners[0][1].running ? owners[0] : null;
      return <Row key={key} label={rowLabel} description={description}>
        <span className="set-gpu-picker">
          <ListSelect label={`${rowLabel} Workload`} value={card ? `${card.profile}:${card.devices.join(',')}` : EMPTY} options={options} onChange={(value) => place(devices[0], value)} native={phone} />
        </span>
        {restartable ? <button type="button" className="btn is-ghost" disabled={busy} aria-label={`Restart ${label(restartable[1].profile)}`} title={`Restart ${label(restartable[1].profile)} on the Same GPUs`} onClick={() => void restart(restartable[0], restartable[1])}><RotateCw size={14} /> Restart</button> : null}
      </Row>;
    })}
    {job ? <Row label={job.restart ? `Restarting ${label(job.restart.profile)}` : 'Applying a Change'} description={job.stage || 'Preparing'}><Status tone="warn">Running</Status></Row> : null}
    {admin ? <SaveRow dirty={dirty} busy={busy} saveLabel="Apply" onSave={() => void apply()} onDiscard={() => setDraft(null)} canSave={Boolean(plan) && !job && !following && Boolean(plan && (plan.stop.length || plan.start.length))} note={planError || (following || job ? 'Applying…' : plan ? planWords(plan) : 'Checking what changes…')} /> : null}
  </Group>;
}
