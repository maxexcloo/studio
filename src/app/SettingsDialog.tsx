import React from 'react';
import { Group, preferenceLabels, Row, Segmented, Switch } from './SettingsControls';
import { ComfyManagerNote, ComfyRestart, restartResultLine, useComfyRestart, useComfyRestartEta, useComfyRestarting } from './ComfyRestart';
import { NodeInstall } from './NodeInstall';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { useAtComputer, usePhone, useThisComputer } from './device';
import type { ConfirmAction } from './useConfirmation';
import { Check, RotateCw, Download, ExternalLink, FolderOpen, FolderSearch, ScanSearch, Puzzle, Boxes, Github, Info, LifeBuoy, LockKeyhole, Plug, RefreshCw, Scale, ScrollText, SlidersHorizontal, UsersRound, Wand2, Library, Cable } from 'lucide-react';
import { discordUrl, features, githubUrl } from './constants';
import { DiscordIcon } from './DiscordIcon';
import { cn } from './format';
import { BetaTag, NumberPicker, Skeleton, StudioSelect, Tip } from './components';
import { Modal } from './Modal';
import { HeatMark } from './HeatMark';
import { apiFetch, apiJson } from './api';
import type { ModelFile, Models, Profile, OutputFolderReport, UpscaleInstall, UpscaleStatus } from './types';
import type { ModelFolders } from './useModelFolders';
import { formatBytes, upscaleEfforts, upscaleQualityLabel } from './useUpscale';
import { HiddenSettings } from './HiddenSettings';
import { shortcuts } from './shortcuts';
import { SettingsDrawer } from './SettingsDrawer';
import { useStarterPlan } from './StarterModels';
import { InpaintDemo } from './InpaintDemo';
import { AdapterLibraryGroup, CivitaiRow, EarlierImagesGroup, PromptHistoryRow } from './LibrarySettings';
import { knownDiagnostics, loadDiagnostics, troubleshootingUrl } from './diagnostics';
import { openFeedback } from './feedback';
import { HuggingFaceTokenSettings } from './HuggingFaceToken';
import { AccountSettings } from './AccountSettings';
import { ModelManifestGroup } from './ModelManifestSettings';
import { ConnectionsGroup, DefaultsCatalogueGroups, DeploymentSettingsError, IntegrationsOverview, useDeploymentSettings } from './DeploymentSettings';
import { OtherDevicesGroup } from './OtherDevices';
import { TrashRow } from './TrashRow';
import type { ShowToast } from './toast';

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'Layout, keyboard, safety and reset.' },
  { id: 'generation', label: 'Generation', icon: Wand2, description: 'The composer, previews and starting values.' },
  { id: 'features', label: 'Features', icon: Puzzle, description: 'Upscaling and inpainting.' },
  { id: 'models', label: 'Models', icon: Boxes, description: 'What ComfyUI has installed and where it finds models.' },
  { id: 'integrations', label: 'Integrations', icon: Cable, description: 'Civitai, Hugging Face, model downloads and output storage.' },
  { id: 'library', label: 'Library', icon: Library, description: 'Where images are saved and what the gallery shows.' },
  { id: 'privacy', label: 'Hidden', icon: LockKeyhole, description: 'Images you keep to yourself, encrypted and unlocked with a password, Touch ID or Windows Hello.' },
  { id: 'connection', label: 'Connection', icon: Plug, description: 'Reaching ComfyUI, restarting it, and opening the studio on other devices.' },
  { id: 'accounts', label: 'Accounts & MCP', icon: UsersRound, description: 'Manage account access profiles and personal MCP connections.' },
  { id: 'about', label: 'About', icon: Info, description: 'Version, stats, updates, feedback and credits.' }
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];
/** Studio administration that ordinary accounts never see; the server refuses it too. */
const ADMINISTRATION_SECTIONS: ReadonlySet<SettingsSection> = new Set(['models', 'integrations', 'library', 'privacy', 'connection']);

/* ------------------------------------------------------------ Primitives */

/** The two looks of a stacked run, drawn small: a photo with two edges under it, and a cover flow. */
function RunStyleGlyph({ kind }: { kind: 'burst' | 'flow' }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'burst' ? (
        <>
          <rect x="3" y="1" width="12" height="9" rx="2" />
          <path d="M4.5 11.6h9" opacity=".7" />
          <path d="M6 13.2h6" opacity=".45" />
        </>
      ) : (
        <>
          <rect x="5.5" y="1.5" width="7" height="11" rx="1.6" />
          <path d="M3.6 3.4 1 4.4v5.2l2.6 1" opacity=".6" />
          <path d="M14.4 3.4 17 4.4v5.2l-2.6 1" opacity=".6" />
        </>
      )}
    </svg>
  );
}

function SwitchRow({ label, tag, description, checked, onChange, disabled }: { label: string; tag?: React.ReactNode; description?: React.ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={tag ? <>{label}{tag}</> : label} description={description} disabled={disabled}>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

/** Whether HEISS looks on the usual ports when its address doesn't answer. Off for a second ComfyUI kept just for HEISS. */
function ComfySearchRow({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  const [checked, setChecked] = React.useState(enabled);
  const [note, setNote] = React.useState('');
  React.useEffect(() => { setChecked(enabled); }, [enabled]);
  const change = async (next: boolean) => {
    setChecked(next);
    setNote('');
    try {
      const response = await apiFetch('/api/comfy-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      if (!response.ok) throw new Error();
      onSaved();
    } catch {
      setChecked(!next);
      setNote('Couldn’t save that. Make sure Studio is running.');
    }
  };
  return (
    <SwitchRow
      label="Find ComfyUI on its own"
      description={note || 'When nothing answers at this address, try ports 8188 and 8000 and switch to the ComfyUI there. Turn off to stay on this address, e.g. with a second ComfyUI just for Studio.'}
      checked={checked}
      onChange={change}
    />
  );
}

/** Folders ComfyUI reads because HEISS added them, and the way to find more. */
function ModelFolderSettings({ folders, confirmAction, onOpen, hints, onHintsChange }: { folders: ModelFolders; confirmAction: ConfirmAction; onOpen: () => void; hints: boolean; onHintsChange: (next: boolean) => void }) {
  const report = folders.report;
  const stray = (report?.folders || []).reduce((sum, folder) => sum + folder.count, 0);
  const linked = report?.linked || [];
  // Settings is where people come to check: look again, quietly, each time it opens.
  React.useEffect(() => { folders.scan({ quiet: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Group title="Model folders" note={report?.configLabel ? <>Stored in <code>{report.configLabel}</code>.</> : undefined}>
      {linked.map((item) => (
        <Row key={item.path} label={<span className="set-folder-path" title={item.path}>{item.label}</span>} description={item.read ? 'Added here · ComfyUI reads it' : 'Added here · ComfyUI reads it after a restart'}>
          <button className="btn is-ghost" onClick={async () => {
            if (!await confirmAction({ title: `Stop using ${item.label}?`, description: 'ComfyUI stops reading this folder after its next restart.', action: 'Remove folder' })) return;
            folders.remove(item.path);
          }}>Remove</button>
        </Row>
      ))}
      <Row
        label={stray ? <Status tone="warn">{stray} model{stray === 1 ? '' : 's'} found</Status> : 'Find models'}
        description={stray ? 'They’re in a folder ComfyUI doesn’t read.' : 'Searches other ComfyUI installs, shared folders and external drives.'}
      >
        <button className={cn('btn', stray > 0 && 'is-primary')} onClick={onOpen}><FolderSearch size={14} /> {stray ? 'Add' : 'Search'}</button>
      </Row>
      <SwitchRow
        label="Notify about unread model folders"
        description="Shows a note in the sidebar and model menu when models are in a folder ComfyUI doesn’t read."
        checked={hints}
        onChange={onHintsChange}
      />
    </Group>
  );
}

function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

/* ------------------------------------------------------------ Keyboard */

/** Every shortcut, folded away until asked for: the list is long and rarely needed here. */
function ShortcutsDrawer() {
  return (
    <SettingsDrawer id="set-shortcuts" title="Keyboard shortcuts" description={<>{shortcuts.length} · <kbd className="set-kbd">?</kbd> shows them anywhere</>}>
      <dl className="set-keys">
        {shortcuts.map(([keys, what]) => (
          <React.Fragment key={keys}>
            <dt><kbd className="set-kbd">{keys}</kbd></dt>
            <dd>{what}</dd>
          </React.Fragment>
        ))}
      </dl>
    </SettingsDrawer>
  );
}

/* ------------------------------------------------------------ Restarts */

/** A plain restart button: its arrow turns while it works and becomes a check when it's back. */
function RestartButton({ what, busy, done, disabled, onClick }: { what: string; busy: boolean; done?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn('btn', done && 'is-done')} onClick={onClick} disabled={disabled || busy || done} aria-label={`Restart ${what}`} aria-live="polite">
      {done ? <Check size={14} /> : <RotateCw size={14} className={cn(busy && 'is-spinning')} />}
      {done ? 'Restarted' : busy ? 'Restarting…' : 'Restart'}
    </button>
  );
}

/** Restarting ComfyUI (new nodes and files, freed memory), as an ordinary row like the rest of General. */
function RestartGroup({ confirmAction, onComfyBack }: {
  confirmAction: ConfirmAction;
  onComfyBack: () => void;
}) {
  const comfy = useComfyRestart({
    onBack: onComfyBack,
    confirm: () => confirmAction({ title: 'Restart ComfyUI?', description: 'Running and queued generations stop. It takes a few seconds.', action: 'Restart ComfyUI', destructive: true })
  });
  const comfyBack = comfy.phase === 'back';
  const comfyLine = comfyBack ? restartResultLine(comfy.result)
    : comfy.busy ? (comfy.eta?.text || 'Usually back in a few seconds.')
    : comfy.phase === 'error' ? comfy.error
    : 'Loads new custom nodes and files, and frees memory.';

  return (
    <Group title="Restart" note={comfy.off && comfy.info ? <ComfyManagerNote info={comfy.info} refresh={comfy.refresh} /> : undefined}>
      <Row label="ComfyUI" description={comfyLine}>
        <RestartButton what="ComfyUI" busy={comfy.busy} done={comfyBack} disabled={comfy.off || comfy.info === null} onClick={comfy.restart} />
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------ Upscale */

/**
 * One line on where smart upscale stands. Anything that needs doing opens the
 * setup dialog, which owns installing nodes, downloading and verifying.
 */
function UpscaleReadiness({ status, reason, install, onOpenSetup, onDownload }: { status: UpscaleStatus | null; reason?: string; install: UpscaleInstall; onOpenSetup: () => void; onDownload: () => void }) {
  if (install?.status === 'running') {
    const ratio = install.totalBytes ? Math.min(1, (install.receivedBytes || 0) / install.totalBytes) : 0;
    return (
      <Row label={<Status tone="warn">Downloading the model</Status>} description={`${formatBytes(install.receivedBytes)} of ${formatBytes(install.totalBytes)}`} stacked>
        <div className="set-progress"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
        <button className="btn" onClick={onOpenSetup}>Show progress</button>
      </Row>
    );
  }
  if (!status) {
    return <Row label={<Status tone="warn">Unavailable</Status>} description={reason || 'Smart upscale isn’t available right now.'}><button className="btn" onClick={onOpenSetup}>Open setup</button></Row>;
  }
  if (!status.nodesInstalled) {
    return <Row label={<Status tone="warn">Needs the SeedVR2 nodes</Status>} description="A one-time install of its ComfyUI nodes."><button className="btn is-primary" onClick={onOpenSetup}>Set up</button></Row>;
  }
  if (install?.status === 'error' && !status.ready) {
    return <Row label={<Status tone="bad">Download stopped</Status>} description={install.error}><button className="btn is-primary" onClick={onOpenSetup}>Resume</button></Row>;
  }
  if (status.needsDownload) {
    return <Row label={<Status tone="warn">Needs a download</Status>} description={`${formatBytes(status.downloadBytes)} of SeedVR2 weights, downloaded once.`}><button className="btn is-primary" onClick={onOpenSetup}>Set up</button></Row>;
  }
  if (status.substituting) {
    const effort = upscaleQualityLabel(status.quality);
    const scale = upscaleEfforts.find((item) => item.value === status.quality)?.scale;
    return (
      <Row
        label={<Status tone="warn">Download needed</Status>}
        description={`${effort} still upscales${scale ? ` at ${scale}` : ''} with a model you already have, so results can look different. Download its own model for the best quality.`}
        stacked
      >
        <button className="btn is-primary" onClick={onDownload}>Download {effort} · {formatBytes(status.downloadBytes)}</button>
      </Row>
    );
  }
  return <Row label={<Status tone="ok">Ready</Status>} description="Hover a finished image and click the arrow in its top-left corner." />;
}

/** Smart upscale's state in a word or two, for its drawer. */
function upscaleSummary(status: UpscaleStatus | null, install: UpscaleInstall) {
  if (install?.status === 'running') return { label: 'downloading' };
  if (!status) return { label: 'unavailable' };
  if (!status.nodesInstalled || status.needsDownload) return { label: 'needs setup' };
  if (install?.status === 'error' && !status.ready) return { label: 'download stopped' };
  if (status.substituting) return { label: 'download needed' };
  return { label: 'ready' };
}

const profileName = (profile: Profile) => profile.displayName || profile.label;

/** Models as small chips with their family, the first few shown and the rest a tap away. */
function ModelChips({ profiles, limit = 8 }: { profiles: Profile[]; limit?: number }) {
  const [all, setAll] = React.useState(false);
  const unique = profiles.filter((profile, index) => profiles.findIndex((other) => profileName(other) === profileName(profile)) === index);
  const shown = all ? unique : unique.slice(0, limit);
  return (
    <ul className="set-chips" aria-label="Models">
      {shown.map((profile) => (
        <li key={profile.id} className="set-chip" title={profileName(profile)}>
          <span>{profileName(profile)}</span>
          {profile.familyName ? <small>{profile.familyName}</small> : null}
        </li>
      ))}
      {unique.length > limit ? (
        <li><button type="button" className="set-chip is-more" onClick={() => setAll((value) => !value)}>{all ? 'Fewer' : `+${unique.length - limit} more`}</button></li>
      ) : null}
    </ul>
  );
}

/** No model can inpaint yet: the starter models can, and the studio downloads them. */
function InpaintSuggestions({ onGetModels }: { onGetModels?: () => void }) {
  const { plan } = useStarterPlan();
  const families = plan?.families || [];
  return (
    <Row label="Models that can inpaint" description={onGetModels ? 'Each downloads in the studio with its text encoder and VAE.' : 'Get one on the computer running Studio.'} stacked>
      <div className="set-suggest">
        <ul className="set-chips" aria-label="Suggested models">
          {families.length ? families.map((family) => (
            <li key={family.family} className="set-chip is-suggest" title={family.blurb || undefined}><span>{family.title}</span></li>
          )) : <li><Skeleton className="skeleton-text short" /></li>}
        </ul>
        {onGetModels ? <button className="btn is-primary" onClick={onGetModels}><Download size={14} /> Get a model</button> : null}
      </div>
    </Row>
  );
}

/* ------------------------------------------------------------ Help */

/** About › Help: where the common fixes are, and the setup lines a bug report needs. */
function HelpGroup({ copyToClipboard }: { copyToClipboard: (text: string) => Promise<boolean> }) {
  const copy = useCopyFeedback();
  // Asks ComfyUI too, so it waits until the page has settled.
  React.useEffect(() => {
    const idle = window.requestIdleCallback?.(() => void loadDiagnostics(), { timeout: 2000 });
    const timer = idle === undefined ? window.setTimeout(() => void loadDiagnostics(), 800) : 0;
    return () => { if (idle !== undefined) window.cancelIdleCallback(idle); window.clearTimeout(timer); };
  }, []);
  const copyDiagnostics = async () => {
    const text = knownDiagnostics() || await loadDiagnostics();
    return text ? copyToClipboard(text) : false;
  };
  return (
    <Group title="Help">
      <Row label="Troubleshooting" description="Common errors and how to fix them.">
        <a className="btn is-ghost" href={troubleshootingUrl()} target="_blank" rel="noreferrer"><LifeBuoy size={13} /> Open</a>
      </Row>
      <Row label="Copy diagnostics" description="Studio, ComfyUI and Node.js versions, system and GPU, for a bug report. Prompts, images and file names aren’t included.">
        <button className="btn" onClick={() => copy.copyWith(copyDiagnostics)}><CopyIcon copied={Boolean(copy.copied)} /> {copy.copied ? 'Copied' : 'Copy'}</button>
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------ Output folder */

const fileCount = (report: OutputFolderReport) => {
  const count = report.media || 0;
  return `${new Intl.NumberFormat().format(count)}${report.capped ? '+' : ''} file${count === 1 && !report.capped ? '' : 's'}`;
};

/** One sentence per state, always saying what it means for the gallery. */
function describeFolder(report: OutputFolderReport | null): { tone?: 'ok' | 'warn' | 'bad'; label: string; detail: string } {
  if (!report) return { label: 'Checking…', detail: '' };
  switch (report.state) {
    case 'empty': return { tone: 'warn', label: 'Not set', detail: 'Needed to delete files and to remove ComfyUI’s copies of hidden images.' };
    case 'missing': return { tone: 'bad', label: 'Folder not found', detail: 'There’s nothing at that path on this computer.' };
    case 'not-folder': return { tone: 'bad', label: 'Not a folder', detail: 'That path points at a file.' };
    case 'mismatch': return { tone: 'warn', label: 'Recent images aren’t here', detail: `None of the last ${report.checked} images are in this folder (${fileCount(report)}). ComfyUI probably saves somewhere else; try Find automatically.` };
    case 'match': return { tone: 'ok', label: 'Linked', detail: `${report.found === report.checked ? `All ${report.checked}` : `${report.found} of ${report.checked}`} recent images found here · ${fileCount(report)}` };
    default: return { tone: report.looksLikeComfy ? 'ok' : 'warn', label: report.looksLikeComfy ? 'Linked' : 'Set', detail: `${fileCount(report)}${report.looksLikeComfy ? '' : ' · doesn’t look like a ComfyUI output folder'}. Checked again after the next image.` };
  }
}

function OutputFolderRow({ savedDir, galleryNote, onSave, onOpen, onCopy, showToast }: {
  savedDir: string;
  galleryNote?: string;
  onSave: (dir: string) => Promise<OutputFolderReport | null>;
  onOpen: () => void;
  onCopy: (dir: string) => Promise<boolean>;
  showToast: ShowToast;
}) {
  const pathCopy = useCopyFeedback();
  const [report, setReport] = React.useState<OutputFolderReport | null>(null);
  const [canBrowse, setCanBrowse] = React.useState(false);
  const [draft, setDraft] = React.useState(savedDir);
  const [draftReport, setDraftReport] = React.useState<OutputFolderReport | null>(null);
  const [busy, setBusy] = React.useState<'' | 'browse' | 'detect' | 'save'>('');
  const [candidates, setCandidates] = React.useState<OutputFolderReport[] | null>(null);

  const refresh = React.useCallback(() => {
    apiJson<{ outputDir: string; report: OutputFolderReport; canBrowse: boolean }>('/api/output-dir')
      .then((data) => { setReport(data.report); setCanBrowse(data.canBrowse); setDraft(data.outputDir || ''); })
      .catch(() => setReport({ path: savedDir, state: savedDir ? 'ok' : 'empty' }));
  }, [savedDir]);
  React.useEffect(refresh, [refresh]);

  // Check the typed path as it settles, so problems show before Save.
  const dirty = draft.trim() !== '' && draft.trim() !== (report?.path || savedDir);
  React.useEffect(() => {
    if (!dirty) { setDraftReport(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiJson<OutputFolderReport>('/api/output-dir/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputDir: draft }), signal: controller.signal })
        .then(setDraftReport)
        .catch(() => null);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft, dirty]);

  const save = async (dir: string) => {
    setBusy('save');
    const next = await onSave(dir);
    setBusy('');
    if (!next) return;
    setReport(next);
    setDraft(next.path);
    setDraftReport(null);
    setCandidates(null);
  };

  const browse = async () => {
    setBusy('browse');
    try {
      const data = await apiJson<{ path?: string; canceled?: boolean }>('/api/output-dir/browse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: draft || savedDir }) });
      setBusy('');
      if (data.path) await save(data.path);
    } catch (error) {
      setBusy('');
      showToast(error instanceof Error ? error.message : 'Couldn’t open the folder picker', 'error');
    }
  };

  const detect = async () => {
    setBusy('detect');
    try {
      const data = await apiJson<{ candidates: OutputFolderReport[] }>('/api/output-dir/detect');
      const list = data.candidates.filter((item) => item.path !== report?.path);
      if (!list.length) showToast(report?.state === 'match' ? 'This is already the right folder' : 'No output folder found. Is ComfyUI running?', report?.state === 'match' ? 'success' : 'error');
      setCandidates(list.length ? list : null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t search for the output folder', 'error');
    } finally {
      setBusy('');
    }
  };

  const shown = describeFolder(dirty ? draftReport : report);
  const draftBlocked = dirty && (!draftReport || draftReport.state === 'missing' || draftReport.state === 'not-folder');
  const hasSaved = Boolean(report?.path && report.state !== 'missing');

  // Searching is for when the folder isn't the one ComfyUI uses; once it is, it's noise.
  const needsSearch = !dirty && report && report.state !== 'match';
  return (
    <Row
      label={<span className="set-folder-title">Output folder<Status tone={shown.tone}>{dirty ? `New path: ${shown.label.toLowerCase()}` : shown.label}</Status></span>}
      description={<span aria-live="polite">{shown.detail || galleryNote}</span>}
      stacked
    >
      <form className="set-inline-form set-folder-form" onSubmit={(event) => { event.preventDefault(); if (dirty && !draftBlocked) save(draft); }}>
        <div className="set-folder-field">
          <input
            className="modal-input set-path-input"
            aria-label="Output folder"
            value={draft}
            placeholder={canBrowse ? 'Paste a path, or browse' : 'Paste the full folder path'}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape' && dirty) { event.stopPropagation(); setDraft(report?.path || savedDir); } }}
          />
          {!dirty && hasSaved ? (
            <span className="set-folder-tools">
              <Tip content="Open in the file manager"><button type="button" className="set-folder-tool" aria-label="Open the output folder" onClick={onOpen}><FolderOpen size={14} /></button></Tip>
              <Tip content={pathCopy.copied ? 'Copied' : 'Copy path'}><button type="button" className="set-folder-tool" aria-label="Copy the path" onClick={() => pathCopy.copyWith(() => onCopy(report?.path || savedDir))}><CopyIcon copied={Boolean(pathCopy.copied)} /></button></Tip>
            </span>
          ) : null}
        </div>
        {dirty
          ? <button className="btn is-primary" type="submit" disabled={draftBlocked || busy === 'save'}>Save</button>
          : canBrowse ? <button className="btn" type="button" onClick={browse} disabled={Boolean(busy)}><FolderSearch size={14} /> {busy === 'browse' ? 'Waiting…' : 'Browse…'}</button> : null}
      </form>
      {candidates ? (
        <div className="set-folder-picks" role="list" aria-label="Folders found">
          {candidates.map((item) => (
            <button key={item.path} type="button" role="listitem" className="set-folder-pick" onClick={() => save(item.path)} disabled={busy === 'save'}>
              <code className="set-path">{item.path}</code>
              <span>
                {item.source === 'comfy' ? 'From ComfyUI · ' : ''}
                {item.state === 'match' ? `${item.found} of ${item.checked} recent images here` : item.state === 'mismatch' ? 'Recent images aren’t here' : fileCount(item)}
              </span>
              {item.state === 'match' ? <Check size={14} className="set-folder-pick-mark" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {needsSearch ? (
        <div className="set-actions">
          <button className="btn is-ghost" onClick={detect} disabled={Boolean(busy)}><ScanSearch size={14} /> {busy === 'detect' ? 'Searching…' : 'Find automatically'}</button>
        </div>
      ) : null}
    </Row>
  );
}

type StudioStats = {
  outputs: number; images: number; videos: number; upscales: number; renderMs: number; megapixels: number;
  firstAt: string; activeDays: number; currentStreak: number; longestStreak: number;
  busiestDay: string; busiestCount: number; topWorkflow: string; topWorkflowCount: number;
};

type AboutData = { stats: StudioStats; version: string; sinceRelease: { tag: string; commits: number } | null };
let aboutCache: AboutData | null = null;

const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0);

function formatDuration(ms: number) {
  const minutes = Math.round((ms || 0) / 60000);
  if (minutes < 1) return `${Math.round((ms || 0) / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 100 ? `${hours}h ${minutes % 60}m` : `${compact(hours)}h`;
}

function formatDay(value: string) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/* ------------------------------------------------------------ Dialog */

export function SettingsDialog({ view, open, section, onSectionChange, onClose, onGetModels }: { view: Record<string, any>; open: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onClose: () => void; onGetModels?: () => void }) {
  const {
    prefs, setPrefs,
    upscaleStatus, upscaleUnavailableReason, upscaleInstall, upscaleSetup,
    gallery, galleryLoaded, paths, saveOutputDirectory, openOutputFolder, copyToClipboard, showToast,
    clearFailedItems, clearGallery, clearAllCache, resetAllSettings, confirmAction,
    hidden,
    health, refreshHealth, models, refreshModels, refreshWorkflows, modelFolders,
    workflows, modelProfiles
  } = view;
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];

  // Models nothing picked up, plus the ones you assigned by hand so they can be undone.
  const modelList = models as Models | null;
  const profileLabels = React.useMemo(() => Object.fromEntries((modelList?.profiles || []).map((profile) => [profile.id, profile.displayName || profile.label])), [modelList]);
  // Models nothing picked up, ones still missing a part, and ones you assigned by hand (so they can be undone).
  const typedModels = (modelList?.modelFiles || []).filter((file) => !file.supported || file.via === 'choice' || (file.missing?.length || 0) > 0);
  const [typeBusy, setTypeBusy] = React.useState('');
  const [accountMode, setAccountMode] = React.useState(false);
  const [accountRole, setAccountRole] = React.useState('');
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    apiJson<{ mode: string; account?: { role: string } | null }>('/api/accounts/status', { cache: 'no-store' }).then((status) => {
      if (!live) return;
      setAccountMode(status.mode === 'multi-user');
      setAccountRole(status.account?.role || '');
      if (status.mode !== 'multi-user' && section === 'accounts') onSectionChange('general');
      if (status.mode === 'multi-user' && status.account?.role !== 'administrator' && ADMINISTRATION_SECTIONS.has(section)) onSectionChange('general');
    }).catch(() => { if (live) setAccountMode(false); });
    return () => { live = false; };
  }, [open, section, onSectionChange]);
  const setModelType = async (file: ModelFile, type: string) => {
    const key = `${file.source}:${file.name}`;
    setTypeBusy(key);
    try {
      await apiJson('/api/models/types', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: file.source, name: file.name, type: type === 'auto' ? '' : type })
      });
      refreshModels(false);
      refreshWorkflows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t save the model type', 'error');
    } finally {
      setTypeBusy('');
    }
  };

  // About: stats come from the local gallery.
  // Kept between opens, and fetched as soon as Settings opens, so About draws filled in.
  const [about, setAbout] = React.useState<AboutData | null>(aboutCache);
  const { stats = null, version: appVersion = '', sinceRelease = null } = about || {};
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/stats').then((response) => response.ok ? response.json() : null).then((data) => {
      if (!live || !data?.stats) return;
      aboutCache = { stats: data.stats, version: data.version || '', sinceRelease: data.sinceRelease || null };
      setAbout(aboutCache);
    }).catch(() => null);
    return () => { live = false; };
  }, [open, section === 'about']); // eslint-disable-line react-hooks/exhaustive-deps
  const topWorkflowName = stats?.topWorkflow
    ? (workflows || []).find((item: { profileId: string; name: string }) => item.profileId === stats.topWorkflow)?.name
      || (modelProfiles || []).find((item: { id: string; displayName?: string; label?: string }) => item.id === stats.topWorkflow)?.displayName
      || stats.topWorkflow.replace(/^custom:/, '')
    : '';

  const upscaleOn = prefs.smartUpscale !== false;
  const upscaleState = upscaleSummary(upscaleStatus, upscaleInstall);
  // Inpainting ships behind a release switch; while it's off its group stays away.
  const inpaintReleased = Boolean((models as Models | null)?.features?.inpainting);
  const inpaintModels = ((modelProfiles || []) as Profile[]).filter((profile) => profile.capabilities?.inpaint);
  const inpaintOn = prefs.inpainting !== false;
  const effort = upscaleEfforts.find((item) => item.value === (prefs.upscaleQuality || 'balanced')) || upscaleEfforts[1];
  const faceDetailReady = Boolean(upscaleStatus?.faceDetail?.nodesInstalled);
  const connected = Boolean(view.comfyStatus?.backends?.primary?.connected ?? health?.ok);
  const thisComputer = useThisComputer();
  const deployment = useDeploymentSettings(open && thisComputer);
  const backendStatus = (backend: 'primary' | 'video') => {
    const reported = view.comfyStatus?.backends?.[backend] as { connected: boolean; device?: string } | undefined;
    if (reported) return reported;
    return backend === 'primary' && health ? { connected, device: '', restarting: comfyRestarting } : null;
  };
  const comfyRestarting = useComfyRestarting();
  const restartEta = useComfyRestartEta();
  // Folders, models and wiping the gallery are looked after at the computer itself.

  // Earlier images opens a folder picker on the computer itself; the server takes it from nowhere else.
  const atComputer = useAtComputer();
  const phoneDevice = usePhone();

  // On phones the section row scrolls sideways; keep the chosen one in view.
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(`.set-nav [data-section="${section}"]`);
      const nav = item?.parentElement;
      if (!item || !nav || nav.scrollWidth <= nav.clientWidth) return;
      nav.scrollTo({ left: Math.max(0, item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" className="settings-modal" bodyClassName="set-layout" title="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.filter((item) => (thisComputer || !['models', 'integrations'].includes(item.id)) && (item.id !== 'accounts' || accountMode)
          && !(accountMode && accountRole !== 'administrator' && ADMINISTRATION_SECTIONS.has(item.id))).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} aria-controls="settings-panel" data-section={item.id} onClick={() => onSectionChange(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <a className="set-nav-discord" href={discordUrl} target="_blank" rel="noreferrer">
          <DiscordIcon size={13} />
          <span>Join the Discord</span>
        </a>
        <button type="button" className="set-nav-feedback" onClick={() => openFeedback({ from: 'settings' })}>
          <strong>Idea or bug?</strong>
          <span>Send it to the board</span>
        </button>
      </nav>

      {/* A region named by its heading, so a screen reader hears where it landed. */}
      <div className="set-panel" key={section} id="settings-panel" role="region" aria-labelledby="settings-panel-title">
        <header className="set-page-head">
          <h3 id="settings-panel-title">{current.label}</h3>
          <p>{current.description}</p>
        </header>

        {section === 'general' ? (
          <>
            {phoneDevice || prefs.fullStudioOnPhone ? <Group title="Layout">
              <SwitchRow label="Simple phone studio" description="A simpler layout for making, browsing and sharing. Everything else stays on the computer." checked={!prefs.fullStudioOnPhone} onChange={(next) => setPrefs({ fullStudioOnPhone: !next })} />
            </Group> : null}
            <Group title="Keyboard" note="Shortcuts pause while you type in a field, except the ones that send the prompt.">
              <ShortcutsDrawer />
            </Group>
            <Group title="Safety">
              <SwitchRow label={preferenceLabels.confirmActions} description="Asks before deleting or stopping something. Permanent deletes always ask." checked={prefs.confirmActions} onChange={(next) => setPrefs({ confirmActions: next })} />
            </Group>
            <Group title="Reset" tone="danger">
              {thisComputer ? (
                <>
                  <Row label="Delete all finished images" description="Moves their files to the trash for 30 days, then deletes them. Hidden isn’t affected.">
                    <button className="btn is-danger-soft" onClick={clearGallery}>Delete all</button>
                  </Row>
                  <Row label="Clear all cache" description="Clears the browser cache, stale queue state and ComfyUI’s memory.">
                    <button className="btn is-danger-soft" onClick={clearAllCache}>Clear cache</button>
                  </Row>
                </>
              ) : null}
              <Row label="Reset all settings" description="Resets prompts, layout, model choices, LoRA stacks and every preference here.">
                <button className="btn is-danger-soft" onClick={resetAllSettings}>Reset</button>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'generation' ? (
          <>
            <Group title="Composer">
              <SwitchRow label="Enter to generate" description="Press Enter to generate and Shift+Enter for a new line." checked={prefs.enterToGenerate} onChange={(next) => setPrefs({ enterToGenerate: next })} />
              <Row label="Run variants as" description={prefs.variationQueueMode === 'separate' ? 'One job per variant. Easier to cancel one at a time.' : 'One ComfyUI job with a larger batch. Reference images run separately to use less memory.'}>
                <Segmented label="Run variants as" value={prefs.variationQueueMode === 'separate' ? 'separate' : 'batch'} onChange={(next) => setPrefs({ variationQueueMode: next })} options={[{ value: 'batch', label: 'One batch' }, { value: 'separate', label: 'Separate jobs' }]} />
              </Row>
              <PromptHistoryRow Row={Row} Switch={Switch} showToast={showToast} confirmAction={confirmAction} />
              <SwitchRow label="Size in megapixels" description={prefs.megapixelSizing ? 'The size menu has a Megapixels field in place of 2K. Every shape is drawn at the count you set.' : 'Set a megapixel count in the size menu instead of choosing 2K.'} checked={Boolean(prefs.megapixelSizing)} onChange={(next) => setPrefs({ megapixelSizing: next })} />
            </Group>
            <Group title="Previews">
              <Row label="While generating" description={prefs.generationPreviewMode === 'simple' ? 'Each sampler step as it arrives. Lighter on the GPU.' : 'Early steps show as an animated pixel mosaic. With reduced motion on, Simple is used.'}>
                <Segmented label="Generation previews" value={prefs.generationPreviewMode === 'simple' ? 'simple' : 'advanced'} onChange={(next) => setPrefs({ generationPreviewMode: next })} options={[{ value: 'advanced', label: 'Mosaic' }, { value: 'simple', label: 'Simple' }]} />
              </Row>
            </Group>
            <Group title="Input images">
              <SwitchRow label="Automatically resize input images" description="Fits large start and reference images to the generation size. Keeps their proportions and your originals." checked={prefs.autoResizeInputs !== false} onChange={(next) => setPrefs({ autoResizeInputs: next })} />
            </Group>
            <Group title="Starting values" note="Used when a model doesn’t set its own. The current draft stays as it is.">
              <Row label="Variants"><NumberPicker label="Variants" value={Number(prefs.defaultImageCount)} onChange={(next) => setPrefs({ defaultImageCount: next })} min={1} max={16} /></Row>
              <Row label="Image steps"><NumberPicker label="Steps" value={Number(prefs.defaultImageSteps)} onChange={(next) => setPrefs({ defaultImageSteps: next })} min={1} max={150} /></Row>
              <Row label="Video steps"><NumberPicker label="Steps" value={Number(prefs.defaultVideoSteps)} onChange={(next) => setPrefs({ defaultVideoSteps: next })} min={1} max={150} /></Row>
              <Row label="Video frames"><NumberPicker label="Frames" value={Number(prefs.defaultVideoFrames)} onChange={(next) => setPrefs({ defaultVideoFrames: next })} min={1} max={1000} step={4} /></Row>
              <Row label="Video FPS"><NumberPicker label="FPS" value={Number(prefs.defaultFps)} onChange={(next) => setPrefs({ defaultFps: next })} min={1} max={60} /></Row>
            </Group>
          </>
        ) : null}

        {section === 'features' ? (
          <>
          <Group>
            <SettingsDrawer id="set-feature-upscale" title="Smart upscale" description={upscaleOn ? `On · ${upscaleState.label}` : 'Off'}>
              <SwitchRow label={preferenceLabels.smartUpscale} description="Shows an upscale arrow on finished images. The larger, sharper copy is saved next to the original." checked={upscaleOn} onChange={(next) => setPrefs({ smartUpscale: next })} />
              {upscaleOn ? (
                <>
                  <Row label="Effort" description={effort.detail}>
                    <Segmented label="Upscale effort" value={effort.value} onChange={(next) => setPrefs({ upscaleQuality: next })} options={upscaleEfforts.map(({ value, label, scale }) => ({ value, label: `${label} ${scale}` }))} />
                  </Row>
                  <SwitchRow
                    label="Face detail pass"
                    tag={<BetaTag />}
                    description={faceDetailReady
                      ? 'Redraws small faces before the upscale. Close-ups are left as they are.'
                      : 'Redraws small faces before the upscale. Needs the Impact Pack and Impact Subpack nodes.'}
                    checked={Boolean(prefs.upscaleFaceDetail) && faceDetailReady}
                    disabled={!faceDetailReady}
                    onChange={(next) => setPrefs({ upscaleFaceDetail: next })}
                  />
                  {!faceDetailReady && upscaleStatus?.faceDetail?.setup?.length ? upscaleStatus.faceDetail.setup.map((setup: NonNullable<NonNullable<typeof upscaleStatus.faceDetail.setup>>[number]) => (
                    <div className="set-node-install" key={setup.pack.name}>
                      <NodeInstall pack={setup.pack} plan={setup} managerHint={setup.manager} autoInstall={setup.autoInstall} showToast={showToast} onRestarted={() => view.refreshUpscaleStatus?.()} afterRestart="Then the face pass can be turned on here." />
                    </div>
                  )) : null}
                  <UpscaleReadiness status={upscaleStatus} reason={upscaleUnavailableReason} install={upscaleInstall} onOpenSetup={() => upscaleSetup.openSetup()} onDownload={() => upscaleSetup.openSetup(null, { download: true })} />
                </>
              ) : null}
            </SettingsDrawer>
          </Group>

          {inpaintReleased ? (
            <Group>
              <SettingsDrawer id="set-feature-inpaint" title={<>Inpainting<BetaTag /></>} description={!inpaintOn ? 'Off' : inpaintModels.length ? `On · ${inpaintModels.length} of your models can` : 'On · no model can yet'}>
                <SwitchRow label="Inpainting" description="A brush in a start or reference image’s menu: paint over part of it and only that part changes. Off hides the brush everywhere." checked={inpaintOn} onChange={(next) => setPrefs({ inpainting: next })} />
                {inpaintOn ? (
                  <>
                    {inpaintModels.length ? (
                      <Row label="Your models that can inpaint" stacked>
                        <ModelChips profiles={inpaintModels} />
                      </Row>
                    ) : (
                      <InpaintSuggestions onGetModels={onGetModels} />
                    )}
                    <Row label="Strength and edge softness" description={`While a painted image is in the prompt bar, both are in ${phoneDevice ? 'the Advanced sheet' : 'the sidebar’s Basics, under the image'}. Strength is there for models that take a start image.`} />
                    <InpaintDemo />
                  </>
                ) : null}
              </SettingsDrawer>
            </Group>
          ) : null}
          </>
        ) : null}

        {section === 'library' ? (
          <>
            {thisComputer ? <Group title="Folders">
              <OutputFolderRow
                savedDir={paths.outputDir || ''}
                galleryNote={galleryLoaded ? `${gallery.length} item${gallery.length === 1 ? '' : 's'} in the gallery` : undefined}
                onSave={saveOutputDirectory}
                onOpen={openOutputFolder}
                onCopy={(dir) => copyToClipboard(dir)}
                showToast={showToast}
              />
              <Row label="Workflows folder" description={paths.workflowsDir ? <code className="set-path is-oneline" title={paths.workflowsDir}><bdi>{paths.workflowsDir}</bdi></code> : <Skeleton className="skeleton-text path" />}>
                <button className="btn is-ghost" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Rescan</button>
              </Row>
            </Group> : null}
            <Group title="Gallery">
              <SwitchRow label="Follow the latest output" description="Shows each new image as it finishes." checked={prefs.followLatest} onChange={(next) => setPrefs({ followLatest: next })} />
              {features.moments ? <SwitchRow label="Group by time" description="Headings like “This evening” split the gallery by when you made things." checked={prefs.showMoments !== false} onChange={(next) => setPrefs({ showMoments: next })} /> : null}
              <SwitchRow label="Wide images take two columns" description="Landscape images span two columns when there are three or more." checked={Boolean(prefs.spanWideImages)} onChange={(next) => setPrefs({ spanWideImages: next })} />
              <SwitchRow label={preferenceLabels.showFailedItems} description="Interrupted and failed generations stay in the gallery." checked={prefs.showFailedItems} onChange={(next) => setPrefs({ showFailedItems: next })} />
            </Group>
            <Group title="Auto-grouping" note="Similar generations group themselves into a stack, found by prompt, model and time. The button next to search switches this too.">
              <SwitchRow label="Auto-grouping" description="Pictures from similar prompts fold into one tile that opens to show all of them." checked={Boolean(prefs.stackRuns)} onChange={(next) => setPrefs({ stackRuns: next })} />
              {prefs.stackRuns ? (
                <Row label="Stacks look like" description={prefs.runStackStyle === 'flow' ? 'A cover flow of the run inside one card.' : 'The newest image, with two edges under it.'}>
                  <Segmented
                    label="Stacks look like"
                    value={prefs.runStackStyle === 'flow' ? 'flow' : 'burst'}
                    onChange={(next) => setPrefs({ runStackStyle: next })}
                    options={[
                      { value: 'burst', label: <><RunStyleGlyph kind="burst" /> Photo</> },
                      { value: 'flow', label: <><RunStyleGlyph kind="flow" /> Cover flow</> },
                    ]}
                  />
                </Row>
              ) : null}
            </Group>
            {atComputer ? <EarlierImagesGroup Group={Group} Row={Row} showToast={showToast} confirmAction={confirmAction} outputDir={paths.outputDir || ''} /> : null}
            <AdapterLibraryGroup Group={Group} Row={Row} />
            <Group title="Sharing">
              <SwitchRow label="Share without settings" description="Leaves the prompt, seed and workflow out of downloaded and shared files. The gallery’s own files keep them." checked={prefs.shareWithoutSettings === true} onChange={(next) => setPrefs({ shareWithoutSettings: next })} />
              <Row label="Export gallery" description="Every finished image in one ZIP file. Hidden has its own export.">
                <a className="btn" href="/api/gallery/export" download><Download size={14} /> Export</a>
              </Row>
            </Group>
            <Group title="Clean up">
              <Row label="Clear failed items" description="Removes failed and interrupted cards.">
                <button className="btn" onClick={clearFailedItems}>Clear</button>
              </Row>
              {thisComputer ? <TrashRow confirmAction={confirmAction} showToast={showToast} Row={Row} /> : null}
            </Group>
          </>
        ) : null}

        {section === 'privacy' ? (
          <HiddenSettings hidden={hidden} prefs={prefs} setPrefs={setPrefs} showToast={showToast} confirmAction={confirmAction} Group={Group} Row={Row} Status={Status} Switch={Switch} />
        ) : null}

        {section === 'accounts' && accountMode ? <AccountSettings showToast={showToast} copyToClipboard={copyToClipboard} confirmAction={confirmAction} isAdmin={accountRole === 'administrator'} profileLabels={profileLabels} /> : null}

        {section === 'connection' ? (
          <>
            {thisComputer && deployment.settings ? <ConnectionsGroup settings={deployment.settings} status={backendStatus} showToast={showToast} Status={Status} onSaved={() => { void deployment.refresh(); refreshHealth(); refreshModels(false); refreshWorkflows(); }} /> : null}
            {thisComputer && deployment.error ? <DeploymentSettingsError error={deployment.error} onRetry={() => void deployment.refresh()} /> : null}
            {!thisComputer && view.comfyStatus?.backends ? <Group title="Generation Connections">
              {Object.entries(view.comfyStatus.backends).map(([name, value]) => {
                const backend = value as { connected: boolean; device: string; url?: string };
                return <Row key={name} label={name === 'video' ? 'Video' : 'Images'} description={backend.connected ? backend.device || 'Ready to generate' : 'Not connected'}>
                  <Status tone={backend.connected ? 'ok' : 'bad'}>{backend.connected ? 'Ready' : 'Offline'}</Status>
                  {backend.url ? <button className="btn is-ghost" onClick={() => window.open(backend.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} /> Open</button> : null}
                </Row>;
              })}
            </Group> : null}
            <Group title="ComfyUI">
              <Row
                label={comfyRestarting ? <Status tone="warn">Restarting</Status> : health ? <Status tone={connected ? 'ok' : 'bad'}>{connected ? 'Connected' : 'Not connected'}</Status> : <Skeleton className="skeleton-text short" />}
                description={comfyRestarting ? `Reconnects when it’s back. ${restartEta?.text || 'Usually a few seconds.'}` : health ? (connected ? health.comfyUrl : health.error || `Start ComfyUI at ${health.comfyUrl || 'http://127.0.0.1:8188'}, then check again.`) : undefined}
              >
                {connected
                  ? <button className="btn is-ghost" onClick={() => window.open(health?.comfyUrl || 'http://127.0.0.1:8188', '_blank')}><ExternalLink size={14} /> Open ComfyUI</button>
                  : <button className="btn is-primary" onClick={refreshHealth} disabled={comfyRestarting}>{comfyRestarting ? 'Waiting…' : 'Check Again'}</button>}
              </Row>
              {thisComputer ? (
                <ComfySearchRow enabled={health?.comfySearch !== false} onSaved={refreshHealth} />
              ) : (
                <Row label="Restart ComfyUI" description="Loads new custom nodes and files, and frees memory.">
                  <ComfyRestart className="is-end" onBack={() => { refreshModels(false); refreshWorkflows(); }} confirm={() => confirmAction({ title: 'Restart ComfyUI?', description: 'Running and queued generations stop. It takes a few seconds.', action: 'Restart ComfyUI', destructive: true })} />
                </Row>
              )}
            </Group>
            {thisComputer ? <RestartGroup confirmAction={confirmAction} onComfyBack={() => { refreshModels(false); refreshWorkflows(); }} /> : null}
            <OtherDevicesGroup
              canChange={thisComputer}
              confirmAction={confirmAction}
              copyToClipboard={copyToClipboard}
              showToast={showToast}
              Group={Group}
              Row={Row}
              Status={Status}
              Switch={Switch}
            />
          </>
        ) : null}

        {section === 'models' ? (
          <>
            {deployment.settings ? <DefaultsCatalogueGroups settings={deployment.settings} showToast={showToast} onSaved={() => { void deployment.refresh(); refreshModels(false); refreshWorkflows(); }} /> : null}
            {typedModels.length ? (
              <Group title="Model types" note="Set the type for models that weren’t recognized or were detected wrong.">
                {typedModels.map((file) => {
                  const key = `${file.source}:${file.name}`;
                  const folder = file.source === 'checkpoint' ? 'Checkpoint' : 'Diffusion model';
                  const how = file.via === 'choice' ? 'set by you' : file.via === 'file' ? 'read from its weights' : file.via === 'name' ? 'guessed from its name' : '';
                  const status = [folder, file.label ? `${file.label}${how ? ` (${how})` : ''}` : '', file.reason || (file.supported ? '' : 'Not recognized. Pick a type to use it.')]
                    .filter(Boolean).join(' · ');
                  return (
                    <Row key={key} label={<span className="set-model-name" title={file.name}>{file.name.split(/[\\/]/).pop()}</span>} description={status} disabled={typeBusy === key}>
                      <div className="set-type-picker">
                        <StudioSelect
                          value={file.via === 'choice' ? file.choice : 'auto'}
                          onChange={(type) => setModelType(file, type)}
                          options={[{ label: file.via === 'choice' ? 'Detect again' : file.supported ? 'Automatic' : 'Not used', value: 'auto' }, ...(modelList?.modelTypeChoices?.[file.source] || [])]}
                        />
                      </div>
                    </Row>
                  );
                })}
              </Group>
            ) : null}
            <Group title="Installed">
              <Row
                label={models ? `${models.imageModels.length} image · ${models.videoModels.length} video` : <Skeleton className="skeleton-text short" />}
                description="Rescan finds models and workflows added since ComfyUI started."
              >
                <button className="btn" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Rescan</button>
              </Row>
            </Group>
            {thisComputer ? <ModelManifestGroup showToast={showToast} /> : null}
            {modelFolders ? <ModelFolderSettings folders={modelFolders} confirmAction={confirmAction} onOpen={() => { onClose(); modelFolders.openDialog(); }} hints={prefs.modelFolderHints !== false} onHintsChange={(next) => setPrefs({ modelFolderHints: next })} /> : null}
          </>
        ) : null}
        {section === 'integrations' && thisComputer ? (
          <>
            {deployment.settings ? <IntegrationsOverview settings={deployment.settings} Status={Status} /> : null}
            {deployment.error ? <DeploymentSettingsError error={deployment.error} onRetry={() => void deployment.refresh()} /> : null}
            <Group title="Civitai">
              <CivitaiRow Row={Row} Switch={Switch} showToast={showToast} canChange={thisComputer} />
            </Group>
            <HuggingFaceTokenSettings showToast={showToast} />
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <section className="about-hero">
              <HeatMark className="about-mark" />
              <p className="about-tagline">A local image and video studio for ComfyUI.</p>
              {/* What staying local means, in numbers: everything made here stays here. */}
              {stats ? (
                <p className="about-value">
                  {stats.outputs.toLocaleString()} {stats.videos ? 'images and videos' : stats.outputs === 1 ? 'image' : 'images'} made here · none uploaded · no telemetry
                </p>
              ) : null}
              <div className="about-meta">
                {appVersion ? (
                  sinceRelease?.commits
                    ? <span title={`${sinceRelease.commits} commit${sinceRelease.commits === 1 ? '' : 's'} since the ${sinceRelease.tag} release`}>v{appVersion} + {sinceRelease.commits}</span>
                    : <span>v{appVersion}</span>
                ) : null}
                <span>MIT licensed</span>
              </div>
            </section>

            <Group title="Stats" note={stats && stats.outputs ? <>Since {formatDay(stats.firstAt)} · {stats.activeDays} active day{stats.activeDays === 1 ? '' : 's'}{stats.busiestCount > 1 ? <> · busiest day {formatDay(stats.busiestDay)} with {stats.busiestCount}</> : null}.</> : undefined}>
              <div className="about-stats">
                {[
                  { value: stats ? compact(stats.outputs) : null, label: 'Outputs', hint: stats ? `${compact(stats.images)} images · ${compact(stats.videos)} videos` : '' },
                  { value: stats ? formatDuration(stats.renderMs) : null, label: 'Rendering', hint: stats?.upscales ? `${compact(stats.upscales)} upscaled` : 'time in ComfyUI' },
                  { value: stats ? `${compact(stats.megapixels)} MP` : null, label: 'Pixels made', hint: 'megapixels' },
                  { value: stats ? `${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}` : null, label: 'Current streak', hint: stats?.currentStreak ? '' : 'starts with today’s first image' },
                  { value: stats ? `${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}` : null, label: 'Longest streak', hint: '' },
                  { value: stats ? (topWorkflowName || '—') : null, label: 'Most used', hint: stats?.topWorkflowCount ? `${compact(stats.topWorkflowCount)} outputs` : '' }
                ].map((tile) => (
                  <div className="about-stat" key={tile.label}>
                    <strong title={typeof tile.value === 'string' ? tile.value : undefined}>{tile.value ?? <Skeleton className="skeleton-text short" />}</strong>
                    <span>{tile.label}</span>
                    {tile.hint ? <small>{tile.hint}</small> : null}
                  </div>
                ))}
              </div>
            </Group>

            <HelpGroup copyToClipboard={copyToClipboard} />

            <Group title="Links">
              <div className="about-links">
                <a href={githubUrl} target="_blank" rel="noreferrer"><Github size={15} /><span>Source on GitHub</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer"><Scale size={15} /><span>MIT license</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer"><ScrollText size={15} /><span>Changelog</span><ExternalLink size={12} /></a>
              </div>
            </Group>

            <Group title="Credits">
              <Row label="HEISS UI" description="Studio is a fork of HEISS UI and merges its model, workflow and studio work.">
                <a className="btn is-ghost" href="https://github.com/tristmeister/HEISS-UI" target="_blank" rel="noreferrer"><ExternalLink size={13} /> HEISS UI</a>
              </Row>
              <Row label="J-AI Studio by Jasper" description="HEISS UI started as a fork of J-AI Studio. The prompt-first idea and much of the foundation are his work.">
                <a className="btn is-ghost" href="https://github.com/jasperdevs/J-AI-Studio" target="_blank" rel="noreferrer"><ExternalLink size={13} /> J-AI Studio</a>
              </Row>
              <Row label="ComfyUI" description="Renders every image and video.">
                <a className="btn is-ghost" href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noreferrer"><ExternalLink size={13} /> ComfyUI</a>
              </Row>
            </Group>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
