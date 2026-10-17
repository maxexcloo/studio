import React from 'react';
import { ArrowLeft, Check, Cpu, Download, ExternalLink, FolderOpen, Package, Pause, RefreshCw, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { NodeInstall, ShellCommand } from './NodeInstall';
import { FamilySetupHero, type FamilySetupHeroStage } from './FamilySetupHero';
import { CellBar, Watcher } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadActivity';
import { apiJson } from './api';
import { cn } from './format';
import { useThisComputer } from './device';
import { downloadFor, useModelDownloads } from './useModelDownloads';
import type { MissingPart, ModelDownload, ShellPlan } from './types';
import type { StarterPick } from './StarterModels';
import type { ShowToast } from './toast';

/**
 * Guided setup for a model family people go and get on purpose (MOSS-Image
 * first; server/family-setup.js holds the data). Four steps under one hero:
 * which version, how ComfyUI runs it (its own nodes, or the makers' pack),
 * every file it needs, and the moment it is ready. It watches ComfyUI the
 * whole time, so installing nodes or updating ComfyUI elsewhere moves it on.
 */

type SetupDownload = { id: string; file: string; folder: string; label: string; bytes: number; url: string; fp8: boolean; part: 'model' | 'encoder' | 'vae'; onDisk: boolean; listed: boolean };
type SetupVersion = {
  id: string; label: string; detail: string; repo: string;
  builds: Record<string, { model: SetupDownload; ready: string }>;
  folder: { name: string; present: boolean; bytes: number; ready: string };
};
type FolderJob = { status: 'running' | 'done' | 'error' | 'cancelled'; receivedBytes: number; totalBytes: number; bytesPerSecond: number; error: string; folder: string; version: string; target: string };
export type FamilySetupPlan = {
  family: string; title: string; maker: string; blurb: string; license: string; page: string;
  builds: Array<{ id: string; label: string; detail: string }>;
  versions: SetupVersion[];
  shared: Array<{ part: 'encoder' | 'vae'; label: string; have: string; download: SetupDownload | null }>;
  comfy: {
    online: boolean; local: boolean; version: string; native: boolean; folderDownload: boolean; folderTarget: string;
    pack: { id: string; name: string; loaded: boolean; ready: boolean; part: MissingPart | null } | null;
  };
  recommended: Route;
  folderJob: FolderJob | null;
  folderCommands: Record<string, (ShellPlan & { target: string }) | null>;
  hardware?: { unified?: boolean } | null;
};
type Route = 'native' | 'pack';
type Step = 'version' | 'route' | 'files' | 'ready';

/* ------------------------------------------------------------ Opening it from anywhere */

const openListeners = new Set<(family: string) => void>();
/** Opens the guided setup for a family from any panel (the setup panel, the model sheet). */
export function openFamilySetup(family: string) {
  openListeners.forEach((listener) => listener(family));
}
export function useFamilySetupRequests(onOpen: (family: string) => void) {
  const latest = React.useRef(onOpen);
  latest.current = onOpen;
  React.useEffect(() => {
    const listener = (family: string) => latest.current(family);
    openListeners.add(listener);
    return () => { openListeners.delete(listener); };
  }, []);
}

/* ------------------------------------------------------------ Helpers */

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'version', label: 'Version' },
  { id: 'route', label: 'ComfyUI' },
  { id: 'files', label: 'Files' },
  { id: 'ready', label: 'Ready' }
];

function SetupSteps({ step }: { step: Step }) {
  const current = STEPS.findIndex((item) => item.id === step);
  return (
    <ol className="upscale-stepper" aria-label="Setup steps">
      {STEPS.map((item, index) => {
        const state = step === 'ready' || index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={item.id} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <i aria-hidden="true">{state === 'done' ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The plan, read again every few seconds while the dialog is open (faster while a folder downloads). */
function useFamilySetupPlan(family: string, open: boolean) {
  const [plan, setPlan] = React.useState<FamilySetupPlan | null>(null);
  const [checkedAt, setCheckedAt] = React.useState(0);
  const [error, setError] = React.useState('');
  const load = React.useCallback(async () => {
    try {
      const data = await apiJson<FamilySetupPlan & { ok: boolean }>(`/api/family-setup/${encodeURIComponent(family)}`);
      setPlan(data);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'HEISS UI didn’t answer.');
    } finally {
      setCheckedAt(Date.now());
    }
  }, [family]);
  const running = plan?.folderJob?.status === 'running';
  React.useEffect(() => {
    if (!open || !family) return;
    load();
    const timer = window.setInterval(load, running ? 1500 : 3000);
    return () => window.clearInterval(timer);
  }, [open, family, load, running]);
  return { plan, checkedAt, error, reload: load };
}

/* ------------------------------------------------------------ The dialog */

export function FamilySetupDialog({ family, open, onOpenChange, showToast, onUse, onStarted, comfyUrl }: {
  family: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showToast: ShowToast;
  /** Select the finished model in the composer, by its file (or folder) name. */
  onUse: (file: string) => void;
  /** Remember what is on its way, so the studio selects it the moment it is ready. */
  onStarted?: (pick: StarterPick) => void;
  comfyUrl?: string;
}) {
  const { plan, checkedAt, reload } = useFamilySetupPlan(family, open);
  const { state: downloads, landed, start, pause } = useModelDownloads();
  const admin = useThisComputer();
  const [step, setStep] = React.useState<Step>('version');
  const [versionId, setVersionId] = React.useState('');
  const [routeChoice, setRouteChoice] = React.useState<Route | ''>('');
  const [buildId, setBuildId] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Each opening starts from the top, unless the model is already there.
  React.useEffect(() => { if (open) { setStep('version'); setRouteChoice(''); } }, [open]);

  const version = plan?.versions.find((item) => item.id === versionId) || plan?.versions[0];
  const route: Route = routeChoice || plan?.recommended || 'native';
  const builds = plan?.builds || [];
  // Macs load the compact int8 build too; the full one is there for anyone with room.
  const build = buildId || builds[0]?.id || '';
  const chosen = version?.builds[build];
  const anyBuildReady = version ? Object.values(version.builds).find((item) => item.ready) : undefined;
  const readyProfile = !version ? '' : route === 'pack' ? version.folder.ready : chosen?.ready || anyBuildReady?.ready || '';
  const readyFile = !version ? '' : route === 'pack' ? version.folder.name : chosen?.ready ? chosen.model.file : anyBuildReady?.model.file || '';
  const routeOk = Boolean(plan && (route === 'native' ? plan.comfy.native : plan.comfy.pack?.ready));

  // Files land, ComfyUI lists them, a profile turns ready: the dialog moves on by itself.
  React.useEffect(() => {
    if (step === 'files' && readyProfile) setStep('ready');
  }, [step, readyProfile]);

  // Native: the model plus whichever shared parts ComfyUI doesn't have yet. The model comes last,
  // so it shows in the studio only once it can run.
  const nativeFiles = React.useMemo(() => {
    if (!plan || !chosen) return [] as Array<{ label: string; download: SetupDownload | null; have: string; part: string }>;
    return [
      ...plan.shared.map((item) => ({ label: item.label, download: item.download, have: item.have, part: item.part })),
      { label: `${plan.title} ${version?.label}`, download: chosen.model, have: chosen.model.listed ? chosen.model.file : '', part: 'model' }
    ];
  }, [plan, chosen, version]);
  const rowState = (download: SetupDownload | null, have: string) => {
    if (have) return 'installed' as const;
    if (!download) return 'installed' as const;
    const current = downloadFor(downloads, download.file);
    if (current?.status === 'downloading' || current?.status === 'queued') return 'downloading' as const;
    if (current?.status === 'paused') return 'paused' as const;
    if (current?.status === 'error') return 'error' as const;
    if (download.onDisk || landed.has(download.file) || current?.status === 'done') return 'landed' as const;
    return 'idle' as const;
  };
  const pending = nativeFiles.filter((row) => ['idle', 'paused', 'error'].includes(rowState(row.download, row.have)));
  const moving = nativeFiles.filter((row) => rowState(row.download, row.have) === 'downloading');
  const nativeTotals = nativeFiles.reduce((sum, row) => {
    const state = rowState(row.download, row.have);
    const size = row.download?.bytes || 0;
    if (state === 'installed') return sum;
    const current = row.download ? downloadFor(downloads, row.download.file) : undefined;
    const received = state === 'landed' ? size : current?.receivedBytes || 0;
    return { total: sum.total + size, received: sum.received + Math.min(size, received), speed: sum.speed + (current?.status === 'downloading' ? current.bytesPerSecond || 0 : 0) };
  }, { total: 0, received: 0, speed: 0 });
  const remaining = pending.reduce((sum, row) => sum + Math.max(0, (row.download?.bytes || 0) - (downloadFor(downloads, row.download!.file)?.receivedBytes || 0)), 0);
  const space = downloads?.space?.diffusion_models;
  const short = space && remaining ? remaining + 1024 ** 3 > space.free : false;

  const job = plan?.folderJob && plan.folderJob.version === version?.id ? plan.folderJob : null;
  const folderRunning = job?.status === 'running';
  const folderProgress = job?.totalBytes ? job.receivedBytes / job.totalBytes : 0;

  const downloading = route === 'native' ? moving.length > 0 : folderRunning;
  const progress = route === 'native' ? (nativeTotals.total ? nativeTotals.received / nativeTotals.total : 0) : folderProgress;
  const failed = route === 'native' ? nativeFiles.some((row) => rowState(row.download, row.have) === 'error') : job?.status === 'error';

  const heroStage: FamilySetupHeroStage = !plan ? 'checking'
    : !plan.comfy.online ? 'offline'
    : step === 'version' ? 'version'
    : step === 'route' ? (routeOk ? 'version' : 'comfy')
    : step === 'ready' ? 'ready'
    : downloading ? 'downloading'
    : failed ? 'error'
    : 'files';

  const title = plan?.title || 'Model setup';
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } catch (error) {
      showToast(error instanceof Error ? error.message : 'That didn’t work.', 'error');
    } finally {
      setBusy(false);
      reload();
    }
  };
  const remember = (file: string) => onStarted?.({ family, file, title: `${title} ${version?.label || ''}`.trim() });
  const getAllNative = () => run(async () => {
    if (!chosen) return;
    remember(chosen.model.file);
    for (const row of pending) if (row.download) await start(row.download.id);
  });
  const startFolder = () => run(async () => {
    if (!version) return;
    remember(version.folder.name);
    await apiJson(`/api/family-setup/${encodeURIComponent(family)}/folder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: version.id }) });
  });
  const cancelFolder = () => run(() => apiJson(`/api/family-setup/${encodeURIComponent(family)}/folder/cancel`, { method: 'POST' }));
  const close = () => onOpenChange(false);
  const use = () => { if (readyFile) onUse(readyFile); close(); };

  /* ---------------------------------------------------------- Copy */

  let heading = title;
  let description: React.ReactNode = plan?.blurb || 'Checking ComfyUI…';
  if (plan && !plan.comfy.online) { heading = 'Waiting for ComfyUI'; description = 'Start ComfyUI to set this model up.'; }
  else if (step === 'route') { heading = 'How ComfyUI runs it'; description = `${title} came out in October 2026. ComfyUI can run it two ways.`; }
  else if (step === 'files') {
    heading = downloading ? `Downloading ${title}` : failed ? 'The download stopped' : `Get ${title} ${version?.label || ''}`.trim();
    description = downloading ? 'It’s selected as soon as it’s ready. The download continues if you close this.'
      : route === 'native' ? 'The model, and the text encoder and VAE it reads prompts and draws pixels with.'
      : 'The makers’ nodes load the official model folder, text encoder and VAE included.';
  } else if (step === 'ready') { heading = `${title} is ready`; description = 'Set up with the settings its makers use.'; }

  /* ---------------------------------------------------------- Body */

  let body: React.ReactNode = null;
  let footer: React.ReactNode = <button className="btn is-ghost" onClick={close}>Not now</button>;
  const recheck = <button className="btn" onClick={() => reload()}><RefreshCw size={13} /> Check again</button>;

  if (!plan) {
    body = <Watcher>Checking ComfyUI…</Watcher>;
  } else if (!plan.comfy.online) {
    body = <Watcher lastChecked={checkedAt}>Waiting for ComfyUI{comfyUrl ? <> at <code>{comfyUrl.replace(/^https?:\/\//, '')}</code></> : null}</Watcher>;
    footer = <>{footer}{recheck}</>;
  } else if (step === 'version') {
    body = (
      <>
        <div className="family-setup-choices is-two" role="radiogroup" aria-label={`${title} version`}>
          {plan.versions.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === version?.id}
              className={cn(item.id === version?.id && 'is-active')}
              onClick={() => setVersionId(item.id)}
            >
              <strong>{item.label}{index === 0 ? <em>Recommended</em> : null}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </div>
        <ul className="family-setup-facts">
          <li><Sparkles size={13} aria-hidden="true" /> Sets text in pictures, in any language, and keeps layouts in place</li>
          <li><Cpu size={13} aria-hidden="true" /> 5B parameters, read by a Qwen3.5 9B text encoder</li>
          <li><Package size={13} aria-hidden="true" /> {plan.maker} · {plan.license} · <a href={plan.page} target="_blank" rel="noreferrer">Model page <ExternalLink size={11} /></a></li>
        </ul>
      </>
    );
    footer = <>{footer}<button className="btn is-primary" onClick={() => setStep(readyProfile ? 'ready' : 'route')}>Continue</button></>;
  } else if (step === 'route') {
    const pack = plan.comfy.pack;
    const routes: Array<{ id: Route; label: string; detail: string; size: string; status: string; ok: boolean }> = [
      {
        id: 'native', label: 'ComfyUI’s own nodes', detail: 'Built in. Compact single files from Comfy-Org.',
        size: `from ${formatBytes(Math.min(...Object.values(version?.builds || {}).map((item) => item.model.bytes)) + plan.shared.reduce((sum, item) => sum + (item.download?.bytes || 0), 0))}`,
        status: plan.comfy.native ? 'Ready' : 'Needs an update', ok: plan.comfy.native
      },
      {
        id: 'pack', label: `${pack?.name || title} nodes`, detail: 'From its makers, with the layer skip they sample with.',
        size: formatBytes(version?.folder.bytes), status: pack?.ready ? 'Installed' : pack?.loaded ? 'Needs an update' : 'One install', ok: Boolean(pack?.ready)
      }
    ];
    body = (
      <>
        <div className="family-setup-choices is-two" role="radiogroup" aria-label="How ComfyUI runs it">
          {routes.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={route === item.id} className={cn(route === item.id && 'is-active')} onClick={() => setRouteChoice(item.id)}>
              <strong>{item.label}{plan.recommended === item.id ? <em>Recommended</em> : null}</strong>
              <span>{item.detail}</span>
              <small className={cn('family-setup-status', item.ok && 'is-ok')}><i aria-hidden="true" />{item.status} · {item.size}</small>
            </button>
          ))}
        </div>
        <div className="family-setup-route" key={route}>
          {route === 'native' && !plan.comfy.native ? (
            <>
              <div className="upscale-callout">
                <strong>Update ComfyUI to its newest version</strong>
                <span>ComfyUI learned {title} on 16 October 2026, after release 0.41.3{plan.comfy.version ? `. This one is ${plan.comfy.version}` : ''}. Update it (<code>git pull</code> in its folder, or the nightly in ComfyUI-Manager), then restart it. The makers’ nodes work on the version you have.</span>
              </div>
              <Watcher lastChecked={checkedAt}>Waiting for ComfyUI to know {title}…</Watcher>
            </>
          ) : route === 'pack' && pack && !pack.loaded && pack.part?.nodePack ? (
            <>
              <NodeInstall pack={pack.part.nodePack} plan={pack.part.install} autoInstall={pack.part.autoInstall} showToast={showToast} onRestarted={() => reload()} afterRestart={`${title} setup continues after that.`} />
              <Watcher lastChecked={checkedAt}>Waiting for the {pack.name} nodes…</Watcher>
            </>
          ) : route === 'pack' && pack && !pack.ready ? (
            <div className="upscale-callout">
              <strong>Update ComfyUI</strong>
              <span>The {pack.name} nodes are in, but this ComfyUI lacks the layer skip node they sample with. Version 0.38 or newer has it.</span>
            </div>
          ) : (
            <p className="family-setup-ok"><Check size={13} strokeWidth={2.6} aria-hidden="true" /> {route === 'native' ? `This ComfyUI runs ${title} on its own.` : `The ${pack?.name} nodes are in.`}</p>
          )}
        </div>
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep('version')}><ArrowLeft size={13} /> Back</button>
        {!routeOk ? recheck : null}
        <button className="btn is-primary" disabled={!routeOk} onClick={() => setStep(readyProfile ? 'ready' : 'files')}>Continue</button>
      </>
    );
  } else if (step === 'files' && route === 'native') {
    const rows = nativeFiles;
    body = (
      <>
        {!downloading ? (
          <div className="upscale-efforts family-setup-builds" role="radiogroup" aria-label="Precision">
            {builds.map((item) => {
              const model = version?.builds[item.id]?.model;
              return (
                <button key={item.id} type="button" role="radio" aria-checked={build === item.id} className={cn(build === item.id && 'is-active')} onClick={() => setBuildId(item.id)}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                  <small>{formatBytes(model?.bytes)}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="upscale-meter">
            <strong>{Math.floor(progress * 100)}<small>%</small></strong>
            <div>
              <span>{formatBytes(nativeTotals.received) || '0 MB'} of {formatBytes(nativeTotals.total)}</span>
              <span>{nativeTotals.speed > 0 ? `${formatBytes(nativeTotals.speed)}/s · ${formatEta((nativeTotals.total - nativeTotals.received) / nativeTotals.speed)}` : 'Connecting to Hugging Face'}</span>
            </div>
          </div>
        )}
        <ul className="upscale-files is-live">
          {rows.map((row) => {
            const state = rowState(row.download, row.have);
            const current: ModelDownload | undefined = row.download ? downloadFor(downloads, row.download.file) : undefined;
            const done = state === 'installed' || state === 'landed';
            const value = done ? 1 : current?.totalBytes ? current.receivedBytes / current.totalBytes : 0;
            return (
              <li key={row.part} className={cn(done && 'is-done')}>
                <div>
                  <strong>{row.label}<em>{row.part === 'encoder' ? 'reads your prompt' : row.part === 'vae' ? 'draws the pixels' : version?.detail.split('.')[0].toLowerCase()}</em></strong>
                  {state === 'downloading' || state === 'paused' ? <CellBar value={value} /> : <code>{row.have || row.download?.file}</code>}
                </div>
                <span>
                  {done ? <><Check size={12} strokeWidth={3} /> {state === 'installed' ? 'In place' : 'Downloaded'}</>
                    : state === 'downloading' ? `${Math.floor(value * 100)}%`
                    : state === 'paused' ? 'Paused'
                    : state === 'error' ? 'Stopped'
                    : formatBytes(row.download?.bytes)}
                </span>
              </li>
            );
          })}
        </ul>
        {!admin ? <p className="upscale-fine">Files download on the computer running HEISS UI. Set {title} up there.</p>
          : downloads?.local === false ? <p className="upscale-fine">ComfyUI runs on another computer. Put these files in its model folders there.</p>
          : short ? <p className="upscale-fine is-warn">These need {formatBytes(remaining)} and the disk has {formatBytes(space?.free)} free.</p>
          : null}
        {!pending.length && !moving.length && !readyProfile ? <Watcher lastChecked={checkedAt}>Waiting for ComfyUI to list the files…</Watcher> : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep('route')}><ArrowLeft size={13} /> Back</button>
        {moving.length ? (
          <>
            <button className="btn" onClick={() => run(async () => { for (const row of moving) await pause(row.download!.id); })}><Pause size={13} /> Pause</button>
            <button className="btn is-primary" onClick={close}>Continue in background</button>
          </>
        ) : pending.length && admin && downloads?.local !== false ? (
          <button className="btn is-primary" disabled={busy || short} onClick={getAllNative}>
            <Download size={14} /> {failed || pending.some((row) => rowState(row.download, row.have) === 'paused') ? 'Resume' : 'Download'} · {formatBytes(remaining)}
          </button>
        ) : null}
      </>
    );
  } else if (step === 'files') {
    const command = version ? plan.folderCommands[version.id] : null;
    const present = Boolean(version?.folder.present);
    body = (
      <>
        {folderRunning ? (
          <div className="upscale-meter">
            <strong>{Math.floor(folderProgress * 100)}<small>%</small></strong>
            <div>
              <span>{formatBytes(job?.receivedBytes) || '0 MB'} of {formatBytes(job?.totalBytes)}</span>
              <span>{job?.bytesPerSecond ? `${formatBytes(job.bytesPerSecond)}/s · ${formatEta((job.totalBytes - job.receivedBytes) / job.bytesPerSecond)}` : 'Connecting to Hugging Face'}</span>
            </div>
          </div>
        ) : null}
        <ul className="upscale-files is-live">
          <li className={cn(present && 'is-done')}>
            <div>
              <strong>{version?.folder.name}<em>model, Qwen3.5 9B and VAE, full precision</em></strong>
              {folderRunning ? <CellBar value={folderProgress} /> : <code>{version?.repo}</code>}
            </div>
            <span>{present ? <><Check size={12} strokeWidth={3} /> In place</> : folderRunning ? `${Math.floor(folderProgress * 100)}%` : formatBytes(version?.folder.bytes)}</span>
          </li>
        </ul>
        {plan.comfy.folderTarget && !present ? (
          <div className="upscale-dest"><FolderOpen size={14} aria-hidden="true" /><code title={plan.comfy.folderTarget}>{plan.comfy.folderTarget}</code></div>
        ) : null}
        {job?.status === 'error' ? <div className="upscale-callout is-danger family-setup-gap"><strong>{job.error}</strong></div> : null}
        {!present && !folderRunning && (!plan.comfy.folderDownload || !admin) && command ? (
          <div className="family-setup-command">
            <p className="upscale-fine">{admin ? 'Run this on the computer with ComfyUI. It resumes if it stops.' : 'Run this on the computer running HEISS UI and ComfyUI.'}</p>
            <ShellCommand plan={command} showToast={showToast} />
          </div>
        ) : null}
        {present && !readyProfile ? <Watcher lastChecked={checkedAt}>Waiting for ComfyUI…</Watcher> : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep('route')}><ArrowLeft size={13} /> Back</button>
        {folderRunning ? (
          <>
            <button className="btn" onClick={cancelFolder}><Pause size={13} /> Pause</button>
            <button className="btn is-primary" onClick={close}>Continue in background</button>
          </>
        ) : !present && plan.comfy.folderDownload && admin ? (
          <button className="btn is-primary" disabled={busy} onClick={startFolder}>
            <Download size={14} /> {job && job.receivedBytes > 0 ? 'Resume' : 'Download'} · {formatBytes(Math.max(0, (version?.folder.bytes || 0) - (job?.receivedBytes || 0)))}
          </button>
        ) : null}
      </>
    );
  } else if (step === 'ready') {
    body = (
      <div className="family-setup-ready">
        <div>
          <strong>{title} {version?.label}</strong>
          <span>{route === 'pack' ? `Through the ${plan.comfy.pack?.name} nodes, skipping layer 22 on the negative pass` : 'On ComfyUI’s own nodes'} · 50 steps · CFG 3 · 1024 × 1024</span>
        </div>
        <p>Put words you want in the picture in quotes, like <q>a café sign that reads “Open late”</q>.</p>
      </div>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={close}>Close</button>
        <button className="btn is-primary" disabled={!readyFile} onClick={use}><Check size={14} /> Use {title}</button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="form"
      className="upscale-modal family-setup-modal"
      hero={
        <div className="upscale-hero-wrap">
          <FamilySetupHero className="upscale-hero" stage={heroStage} progress={progress} focus={step === 'version' ? Math.max(0, plan?.versions.findIndex((item) => item.id === version?.id) ?? 0) : step === 'route' ? (route === 'native' ? 0 : 1) : 2} />
          <SetupSteps step={step} />
        </div>
      }
      title={heading}
      description={description}
      footer={footer}
    >
      <div className="upscale-body" key={`${step}-${route}`}>{body}</div>
    </Modal>
  );
}
