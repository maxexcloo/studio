import React from 'react';
import { LoraStackSettings } from './LoraStackSettings';
import { ExternalLink, Group, preferenceLabels, Row, Segmented, Status, SwitchRow } from './SettingsControls';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { usePhone, useThisComputer } from './device';
import { Boxes, FileJson, Info, Plug, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, Wrench } from 'lucide-react';
import { githubUrl } from './constants';
import { Skeleton } from './components';
import { Modal } from './Modal';
import { HeatMark } from './HeatMark';
import { apiFetch, apiJson } from './api';
import type { Models } from './types';
import { shortcuts } from './shortcuts';
import { SettingsDrawer } from './SettingsDrawer';
import { knownAccountStatus } from './accounts';
import { ProfilesSettings } from './ProfilesSettings';
import { PromptHistoryRow } from './LibrarySettings';
import { knownDiagnostics, loadDiagnostics, troubleshootingUrl } from './diagnostics';
import { AccountSettings, GroupsSettings, UsersSettings, type ProfileInfo } from './AccountSettings';
import { DefaultsGroup, DeploymentSettingsError, inpaintFlagKey, IntegrationsOverview, useDeploymentSettings } from './DeploymentSettings';
import { WorkerSettings } from './WorkerSettings';

/** Account first, then alphabetical (UI-PATTERNS › Settings). */
export const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account', icon: UserRound, description: 'Your profile and MCP connection' },
  { id: 'groups', label: 'Groups', icon: ShieldCheck, description: 'What each group can use, and where new accounts start' },
  { id: 'models', label: 'Models', icon: Boxes, description: 'Default models and integrations' },
  { id: 'profiles', label: 'Profiles', icon: FileJson, description: 'Model profiles and guides: JSON, versions, drafts and export' },
  { id: 'studio', label: 'Studio', icon: SlidersHorizontal, description: 'How Studio works for you' },
  { id: 'users', label: 'Users', icon: UsersRound, description: 'Accounts and chat users' },
  { id: 'workers', label: 'Workers', icon: Plug, description: 'The ComfyUI workers that run your jobs' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, description: 'Clean up, get help or start over' },
  { id: 'about', label: 'About', icon: Info, description: 'Version, stats and credits' }
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];
/** Studio administration that ordinary accounts never see; the server refuses it too. */
const ADMINISTRATION_SECTIONS: ReadonlySet<SettingsSection> = new Set(['groups', 'models', 'profiles', 'users', 'workers']);
/** Sections only an account deployment has. */
const ACCOUNT_SECTIONS: ReadonlySet<SettingsSection> = new Set(['account', 'groups', 'users']);

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

/** Every shortcut, folded away until asked for: the list is long and rarely needed here. */
function ShortcutsDrawer() {
  return (
    <SettingsDrawer id="set-shortcuts" title="Keyboard Shortcuts" description={<>{shortcuts.length} shortcuts · press <kbd className="set-kbd">?</kbd> anywhere to see them</>}>
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

/** Maintenance › Help: where the common fixes are, and the setup lines a bug report needs. */
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
      <Row label="Copy Diagnostics" description="Versions, system and GPU for a bug report; no prompts, images or file names">
        <button className="btn" onClick={() => copy.copyWith(copyDiagnostics)}><CopyIcon copied={Boolean(copy.copied)} /> {copy.copied ? 'Copied' : 'Copy'}</button>
      </Row>
      <Row label="Troubleshooting" description="Common errors and how to fix them">
        <ExternalLink href={troubleshootingUrl()}>Open</ExternalLink>
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------ About */

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

/** Settings › About credits: the projects Studio is built from and runs on, alphabetically. */
const credits = [
  { name: 'ComfyUI', link: 'ComfyUI', what: 'Renders every local image and video', url: 'https://github.com/comfyanonymous/ComfyUI' },
  { name: 'HEISS UI', link: 'HEISS UI', what: 'Studio is a hard fork of HEISS UI, which built much of its foundation', url: 'https://github.com/tristmeister/HEISS-UI' },
  { name: 'J-AI Studio by Jasper', link: 'J-AI Studio', what: 'HEISS UI began as a fork of J-AI Studio, whose prompt-first idea and foundation are Jasper’s work', url: 'https://github.com/jasperdevs/J-AI-Studio' },
  { name: 'Radiance', link: 'Radiance', what: 'The fast runtime behind the Radiance models', url: 'https://hub.docker.com/r/stilldeadcode/radiance' }
];

/* ------------------------------------------------------------ Dialog */

export function SettingsDialog({ view, open, section, onSectionChange, onClose }: { view: Record<string, any>; open: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onClose: () => void; onGetModels?: () => void }) {
  const {
    prefs, setPrefs,
    copyToClipboard, showToast,
    clearFailedItems, resetAllSettings,
    health, refreshHealth, models, refreshModels, refreshWorkflows,
    workflows, modelProfiles
  } = view;
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];

  const modelList = models as Models | null;
  const profileInfo = React.useMemo<Record<string, ProfileInfo>>(() => Object.fromEntries((modelList?.profiles || []).map((profile) => [profile.id, { label: profile.displayName || profile.label, kind: profile.kind, cloud: profile.family === 'grok' || /^grok/i.test(profile.id), nsfw: profile.nsfw === true }])), [modelList]);
  // What the sign-in gate already knew, so Account and Users draw at once; checked again on each open.
  const known = knownAccountStatus();
  const [accountMode, setAccountMode] = React.useState(known?.mode === 'multi-user');
  const [accountRole, setAccountRole] = React.useState(known?.account?.role || '');
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    apiJson<{ mode: string; account?: { role: string } | null }>('/api/accounts/status', { cache: 'no-store' }).then((status) => {
      if (!live) return;
      setAccountMode(status.mode === 'multi-user');
      setAccountRole(status.account?.role || '');
      if (status.mode !== 'multi-user' && ACCOUNT_SECTIONS.has(section)) onSectionChange('studio');
      if (status.mode === 'multi-user' && status.account?.role !== 'administrator' && ADMINISTRATION_SECTIONS.has(section)) onSectionChange('studio');
    }).catch(() => { if (live && !known) setAccountMode(false); });
    return () => { live = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // About's stats, kept between opens and fetched as soon as Settings opens, so About draws filled in.
  const [about, setAbout] = React.useState<AboutData | null>(aboutCache);
  const { stats = null, version: appVersion = '', sinceRelease = null } = about || {};
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    apiFetch('/api/stats').then((response) => response.ok ? response.json() : null).then((data) => {
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

  const thisComputer = useThisComputer();
  const phoneDevice = usePhone();
  const deployment = useDeploymentSettings(open && thisComputer);
  // One rule for the rail and the page: account sections need accounts, administration needs an administrator.
  const administrator = accountMode ? accountRole === 'administrator' : thisComputer;
  const sectionShown = (id: SettingsSection) => (!ACCOUNT_SECTIONS.has(id) || accountMode) && (!ADMINISTRATION_SECTIONS.has(id) || administrator);

  // Inpainting is the deployment's catalogue switch; administrators turn it here, everyone sees it.
  const inpaintFlag = deployment.settings?.catalogue.find((item) => item.key === inpaintFlagKey);
  const inpaintOn = inpaintFlag ? inpaintFlag.value : Boolean(modelList?.features?.inpainting);
  const [inpaintBusy, setInpaintBusy] = React.useState(false);
  const setInpainting = async (next: boolean) => {
    setInpaintBusy(true);
    try {
      const response = await apiFetch('/api/settings/deployment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: inpaintFlagKey, value: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Couldn’t save that setting');
      showToast('Saved. Restart Studio to apply it.', 'success');
      await deployment.refresh();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Couldn’t save that setting', 'error'); }
    finally { setInpaintBusy(false); }
  };

  // On phones the section row scrolls sideways; keep the chosen one in view.
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(`.set-nav [data-section="${section}"]`);
      const nav = item?.parentElement;
      if (!item || !nav || nav.scrollWidth <= nav.clientWidth) return;
      nav.scrollTo({ left: Math.max(0, item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" className="settings-modal" bodyClassName="set-layout" title="Settings">
      <nav className="set-nav" aria-label="Settings Sections">
        {SETTINGS_SECTIONS.filter((item) => sectionShown(item.id)).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={`set-nav-item${section === item.id ? ' active' : ''}`} aria-current={section === item.id ? 'page' : undefined} aria-controls="settings-panel" data-section={item.id} onClick={() => onSectionChange(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* A region named by its heading, so a screen reader hears where it landed. */}
      <div className="set-panel" key={section} id="settings-panel" role="region" aria-labelledby="settings-panel-title">
        <header className="set-page-head">
          <h3 id="settings-panel-title">{current.label}</h3>
          <p>{current.description}</p>
        </header>

        {section === 'account' && accountMode ? <AccountSettings showToast={showToast} copyToClipboard={copyToClipboard} /> : null}
        {section === 'groups' && sectionShown('groups') ? <GroupsSettings showToast={showToast} profiles={profileInfo} /> : null}
        {section === 'users' && sectionShown('users') ? <UsersSettings showToast={showToast} /> : null}
        {section === 'profiles' && sectionShown('profiles') ? <ProfilesSettings showToast={showToast} onSaved={() => { refreshModels(false); refreshWorkflows(); }} /> : null}

        {section === 'studio' ? (
          <>
            {/* General always leads its page; the other groups follow alphabetically. */}
            <Group title="General">
              <SwitchRow label="Enter to Generate" description="Enter generates; Shift+Enter adds a new line" checked={prefs.enterToGenerate} onChange={(next) => setPrefs({ enterToGenerate: next })} />
              {phoneDevice ? null : <ShortcutsDrawer />}
            </Group>
            <Group title="Features">
              {administrator && inpaintFlag
                ? <SwitchRow label="Inpainting" description={`Paint over part of a reference image to change just that part. For everyone${inpaintFlag.locked ? '; locked by the server' : '; applies after a restart'}`} checked={inpaintOn} disabled={inpaintFlag.locked || inpaintBusy} onChange={(next) => void setInpainting(next)} />
                : <Row label="Inpainting" description={inpaintOn ? 'Paint over part of a reference image to change just that part' : 'Off for this Studio'}><Status tone={inpaintOn ? 'ok' : undefined}>{inpaintOn ? 'On' : 'Off'}</Status></Row>}
              <SwitchRow label={preferenceLabels.smartUpscale} description="An upscale arrow on finished images saves a larger copy beside the original" checked={prefs.smartUpscale} onChange={(next) => setPrefs({ smartUpscale: next })} />
            </Group>
            <Group title="Gallery">
              <SwitchRow label="Date Headers" description="Split the gallery by day, with headings like “Today”" checked={Boolean(prefs.dateHeaders)} onChange={(next) => setPrefs({ dateHeaders: next })} />
              <Row label="Stacks Look Like" description={prefs.runStackStyle === 'flow' ? 'A cover flow of the run in one card' : 'The newest image, with edges showing the rest'}>
                <Segmented
                  label="Stacks Look Like"
                  value={prefs.runStackStyle === 'flow' ? 'flow' : 'burst'}
                  onChange={(next) => setPrefs({ runStackStyle: next })}
                  options={[
                    { value: 'burst', label: <><RunStyleGlyph kind="burst" /> Photo</> },
                    { value: 'flow', label: <><RunStyleGlyph kind="flow" /> Cover Flow</> },
                  ]}
                />
              </Row>
              <SwitchRow label="Tile Captions" description="On a phone, show each tile’s prompt and name under it" checked={Boolean(prefs.phoneTileCaptions)} onChange={(next) => setPrefs({ phoneTileCaptions: next })} />
              <SwitchRow label="Wide Images Take Two Columns" description="Landscape images span two columns in grids of three or more" checked={Boolean(prefs.spanWideImages)} onChange={(next) => setPrefs({ spanWideImages: next })} />
            </Group>
            <Group title="Generation">
              <SwitchRow label="Auto-Resize Input Images" description="Fit large start and reference images to the output size; your originals stay as they are" checked={prefs.autoResizeInputs} onChange={(next) => setPrefs({ autoResizeInputs: next })} />
              <PromptHistoryRow showToast={showToast} />
              <Row label="Run Several Images As" description={prefs.variationQueueMode === 'separate' ? 'One job per image, so you can cancel them one at a time' : 'One job for all of them; runs with reference images still go one by one'}>
                <Segmented label="Run Several Images As" value={prefs.variationQueueMode === 'separate' ? 'separate' : 'batch'} onChange={(next) => setPrefs({ variationQueueMode: next })} options={[{ value: 'batch', label: 'One Batch' }, { value: 'separate', label: 'Separate Jobs' }]} />
              </Row>
              <SwitchRow label="Size in Megapixels" description={prefs.megapixelSizing ? 'The size menu sets a megapixel count instead of 2K, for every shape' : 'Set a megapixel count in the size menu instead of 2K'} checked={Boolean(prefs.megapixelSizing)} onChange={(next) => setPrefs({ megapixelSizing: next })} />
              <Row label="While Generating" description={prefs.generationPreviewMode === 'simple' ? 'Each step as it arrives; lighter on the GPU' : 'Early steps as an animated mosaic; Simple with reduced motion'}>
                <Segmented label="Previews While Generating" value={prefs.generationPreviewMode === 'simple' ? 'simple' : 'advanced'} onChange={(next) => setPrefs({ generationPreviewMode: next })} options={[{ value: 'advanced', label: 'Mosaic' }, { value: 'simple', label: 'Simple' }]} />
              </Row>
            </Group>
            <LoraStackSettings />
            <Group title="Sharing">
              <SwitchRow label="Share Without Settings" description="Leave the prompt, seed and workflow out of files you download or share" checked={prefs.shareWithoutSettings === true} onChange={(next) => setPrefs({ shareWithoutSettings: next })} />
            </Group>
          </>
        ) : null}

        {section === 'models' && sectionShown('models') ? (
          <>
            {deployment.settings ? <DefaultsGroup settings={deployment.settings} showToast={showToast} onSaved={() => { void deployment.refresh(); refreshModels(false); refreshWorkflows(); }} /> : null}
            {deployment.error ? <DeploymentSettingsError error={deployment.error} onRetry={() => void deployment.refresh()} /> : null}
            {deployment.settings ? <IntegrationsOverview settings={deployment.settings} showToast={showToast} onSaved={() => void deployment.refresh()} /> : null}
          </>
        ) : null}

        {/* Workers: the worker list (WorkerSettings.tsx). */}
        {section === 'workers' && sectionShown('workers') ? <WorkerSettings
          status={view.comfyStatus || null}
          showToast={showToast}
          onCheck={() => { view.refreshComfyStatus?.(); refreshHealth(); }}
          onChanged={() => { void deployment.refresh(); refreshHealth(); view.refreshComfyStatus?.(); refreshModels(false); refreshWorkflows(); }}
        /> : null}

        {section === 'maintenance' ? (
          <>
            <Group title="Clean Up">
              <Row label="Clear Failed Items" description="Remove failed and interrupted cards from the gallery">
                <button className="btn" onClick={clearFailedItems}>Clear</button>
              </Row>
              <Row label="Export Gallery" description="Download every finished image and video as one ZIP">
                <a className="btn" href="/api/gallery/export" download>Export</a>
              </Row>
            </Group>
            <HelpGroup copyToClipboard={copyToClipboard} />
            <Group title="Reset" tone="danger">
              <Row label="Reset All Settings" description="Prompts, layout, models, LoRA stacks and preferences in this browser; asks first">
                <button className="btn is-danger-soft" onClick={resetAllSettings}>Reset</button>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <section className="about-hero">
              <HeatMark className="about-mark" />
              <p className="about-tagline">An image and video studio for ComfyUI.</p>
              {stats ? (
                <p className="about-value">
                  {stats.outputs.toLocaleString()} {stats.videos ? 'images and videos' : stats.outputs === 1 ? 'image' : 'images'} made here · no telemetry
                </p>
              ) : null}
              <div className="about-meta">
                {appVersion ? (
                  sinceRelease?.commits
                    ? <span title={`${sinceRelease.commits} commit${sinceRelease.commits === 1 ? '' : 's'} since the ${sinceRelease.tag} release`}>v{appVersion} + {sinceRelease.commits}</span>
                    : <span>v{appVersion}</span>
                ) : null}
                <span>MIT Licence</span>
              </div>
            </section>

            <Group>
              <Row label="Version" description={sinceRelease?.commits ? `${sinceRelease.commits} commit${sinceRelease.commits === 1 ? '' : 's'} since the ${sinceRelease.tag} release` : 'The release running here'}>
                <span className="set-status">{appVersion ? `v${appVersion}` : <Skeleton className="skeleton-text short" />}</span>
              </Row>
              <Row label="Changelog" description="What’s new in each release">
                <ExternalLink href={`${githubUrl}/blob/main/CHANGELOG.md`}>Changelog</ExternalLink>
              </Row>
              <Row label="Licence" description="MIT, keeping the J-AI Studio and HEISS UI notices">
                <ExternalLink href={`${githubUrl}/blob/main/LICENSE`}>Licence</ExternalLink>
              </Row>
              <Row label="Source" description="Studio’s code on GitHub">
                <ExternalLink href={githubUrl}>GitHub</ExternalLink>
              </Row>
            </Group>

            <Group title="Credits">
              {credits.map((credit) => <Row key={credit.name} label={credit.name} description={credit.what}>
                <ExternalLink href={credit.url}>{credit.link}</ExternalLink>
              </Row>)}
            </Group>

            <Group title="Stats" note={stats && stats.outputs ? <>Since {formatDay(stats.firstAt)} · {stats.activeDays} active day{stats.activeDays === 1 ? '' : 's'}{stats.busiestCount > 1 ? <> · busiest day {formatDay(stats.busiestDay)} with {stats.busiestCount}</> : null}.</> : undefined}>
              <div className="about-stats">
                {[
                  { value: stats ? compact(stats.outputs) : null, label: 'Outputs', hint: stats ? `${compact(stats.images)} images · ${compact(stats.videos)} videos` : '' },
                  { value: stats ? formatDuration(stats.renderMs) : null, label: 'Rendering', hint: stats?.upscales ? `${compact(stats.upscales)} upscaled` : 'time in ComfyUI' },
                  { value: stats ? `${compact(stats.megapixels)} MP` : null, label: 'Pixels Made', hint: 'megapixels' },
                  { value: stats ? `${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}` : null, label: 'Current Streak', hint: stats?.currentStreak ? '' : 'starts with today’s first image' },
                  { value: stats ? `${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}` : null, label: 'Longest Streak', hint: '' },
                  { value: stats ? (topWorkflowName || '—') : null, label: 'Most Used', hint: stats?.topWorkflowCount ? `${compact(stats.topWorkflowCount)} outputs` : '' }
                ].map((tile) => (
                  <div className="about-stat" key={tile.label}>
                    <strong title={typeof tile.value === 'string' ? tile.value : undefined}>{tile.value ?? <Skeleton className="skeleton-text short" />}</strong>
                    <span>{tile.label}</span>
                    {tile.hint ? <small>{tile.hint}</small> : null}
                  </div>
                ))}
              </div>
            </Group>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

