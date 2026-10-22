import React from 'react';
import { useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowUp, CheckSquare, CircleStop, Images, LoaderCircle, Menu, Search, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MediaModeToggle } from './ComposerModeSelect';
import { cn } from './format';
import { startsGroup } from './ItemActionSurfaces';
import { bulkItemActions, useItemActionHandlers } from './itemActions';
import type { GallerySelection } from './gallerySelection';
import { progressReading } from './GenerationProgress';
import { generatingLabel } from './itemWording';
import type { GalleryItem } from './types';
import { PhoneGalleryTools, clearedSearch, filterCountOf } from './GallerySearch';
import { GalleryViewControls } from './GalleryViewControls';
import { searchActive } from './favorites';
import { PhoneStatus, useStatusHost } from './StatusMessage';
import type { SettingsSection } from './SettingsDialog';
import type { StudioViewModel } from './useStudio';
import { CreateSheet } from './PhoneCreate';
import { MoreMenu, PhoneMenu } from './PhoneMenu';

/* ---------------------------------------------------------------------------
   The phone studio

   A phone is a second screen for the computer that runs ComfyUI: it is for
   making, browsing and sharing images, not for looking after that computer.
   Everything here is thumb-first: one "Describe…" pill at the bottom opens a
   full-height create sheet, pickers are bottom sheets with 56px rows, tiles
   open on tap and show their actions on a long press, and the viewer has a
   labelled action bar. Advanced settings stay one link away.

   The state and logic are the studio's own (useStudio.ts); these files only
   lay them out for a phone. StudioView renders the shell in place of the
   desktop shells and keeps the shared overlays (viewer, dialogs, toasts).
   The shell (this file) holds the top bar, the gallery, the select bar and
   the prompt bar; Create is PhoneCreate.tsx, with its Model and Size pop-ups
   in PhoneCreatePickers.tsx; the top bar's menus are PhoneMenu.tsx.
--------------------------------------------------------------------------- */


/** The studio's view model, with what StudioView adds for the phone: the LoRA chooser, the shared search row and Settings. */
export type PhoneView = StudioViewModel & {
  lorasOpen: boolean;
  openLoras: () => void;
  phoneSearchOpen: boolean;
  setPhoneSearchOpen: (open: boolean) => void;
  openSettings: (section?: SettingsSection) => void;
};

/* ------------------------------------------------------------ The shell */

export function PhoneShell({ view, galleryBody, canUseNegativePrompt, comfyOffline, createOpen, setCreateOpen, selection }: {
  view: PhoneView;
  galleryBody: React.ReactNode;
  canUseNegativePrompt: boolean;
  comfyOffline: boolean;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  selection: GallerySelection;
}) {
  const {
    prompt, runningCount, comfyStatus, retryComfyStatus, mode, changeMode,
    galleryStageRef, onGalleryScroll, generate, generateDisabled, visibleGallery, openItem, active, showToast
  } = view;
  const gallery = visibleGallery;
  const { selecting, selectedItems, selectable } = selection;
  const handlers = useItemActionHandlers();
  const bulkActions = handlers ? bulkItemActions(selectedItems, handlers, true) : [];
  const reducedMotion = useReducedMotion();
  // The gallery scrolls the document, so iOS's tap on the status bar takes it to the top.
  const loadMore = React.useRef(onGalleryScroll);
  loadMore.current = onGalleryScroll;
  React.useLayoutEffect(() => {
    const page = document.scrollingElement as HTMLElement;
    galleryStageRef.current = page;
    const onScroll = () => loadMore.current({ currentTarget: page });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (galleryStageRef.current === page) galleryStageRef.current = null;
    };
  }, [galleryStageRef]);
  const scrollToTop = () => galleryStageRef.current?.scrollTo({ left: 0, top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  // Tapping what is generating shows that run: its own mode, its own tile.
  const revealRunning = () => {
    const running = gallery.filter((item) => item.status === 'pending');
    const here = running.find((item) => item.type === mode);
    const target = here || running[0];
    if (target && target.type !== mode) changeMode(target.type === 'video' ? 'video' : 'image');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const tile = target ? galleryStageRef.current?.querySelector(`[data-tile-id="${CSS.escape(String(target.id))}"]`) : null;
      if (tile) tile.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      else scrollToTop();
    }));
  };

  const { pending, progress, label: runningLabel } = runningSummary(gallery, runningCount);

  const [moreOpen, setMoreOpen] = React.useState(false);
  // What's running: a tap shows it, or stops it all.
  const [runningOpen, setRunningOpen] = React.useState(false);
  React.useEffect(() => { if (!runningCount) setRunningOpen(false); }, [runningCount]);
  const { gallerySearch, setGallerySearch } = view;
  // Search and the filter row share one row under the bar; one is open at a time.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const { phoneSearchOpen: searchOpen, setPhoneSearchOpen: setSearchOpen } = view;
  const expanded = searchOpen ? 'search' : filtersOpen ? 'filters' : '';
  const queryCount = gallerySearch.q.trim() ? 1 : 0;
  const filterCount = filterCountOf(gallerySearch);
  const searchRef = React.useRef(gallerySearch);
  searchRef.current = gallerySearch;
  // Closing clears: the query and every filter go with the row.
  const closeTools = React.useCallback(() => {
    setSearchOpen(false);
    setFiltersOpen(false);
    if (searchActive(searchRef.current)) setGallerySearch(clearedSearch(searchRef.current));
  }, [setSearchOpen, setGallerySearch]);
  const startSelecting = () => {
    const cleared = searchActive(searchRef.current);
    closeTools();
    if (cleared) window.requestAnimationFrame(() => selection.start()); else selection.start();
  };
  const toggleTools = (which: 'search' | 'filters') => {
    if (expanded === which) { closeTools(); return; }
    setSearchOpen(which === 'search');
    setFiltersOpen(which === 'filters');
  };
  // The strip's and dock's heights, for the gallery to clear and toasts to sit under the strip.
  const barRef = React.useRef<HTMLElement>(null);
  const dockRef = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    // On the root: toasts are portalled outside the shell.
    const root = document.documentElement;
    const measure = () => {
      // Hidden behind the selection header it measures 0; that header is as tall, so the last height stands.
      // To the bottom of the bar's own row: the search or filter row under it overlays the gallery rather than pushing it down.
      const bar = barRef.current?.querySelector('.phone-bar-row')?.getBoundingClientRect().bottom || 0;
      if (bar) root.style.setProperty('--phone-bar-h', `${Math.round(bar)}px`);
      if (dockRef.current) root.style.setProperty('--phone-dock-h', `${Math.round(dockRef.current.getBoundingClientRect().height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (barRef.current) observer.observe(barRef.current);
    if (dockRef.current) observer.observe(dockRef.current);
    return () => observer.disconnect();
  }, [selecting]);
  React.useEffect(() => () => { document.documentElement.style.removeProperty('--phone-bar-h'); document.documentElement.style.removeProperty('--phone-dock-h'); }, []);
  const restarting = Boolean(comfyStatus?.restarting);
  const connected = Boolean(comfyStatus?.connected);
  const connectionName = comfyStatus?.label || 'ComfyUI';
  const statusText = restarting ? `${connectionName} is restarting` : comfyStatus?.busy ? `${connectionName} is busy` : connected ? `${connectionName} connected${comfyStatus?.device ? ` · ${comfyStatus.device}` : ''}` : comfyStatus?.checked ? `${connectionName} is offline` : `Checking ${connectionName}…`;
  // The phone's one status host, for the whole app (UI-PATTERNS › Messages): every other host gives way to it.
  const message = useStatusHost(true, true);
  const quickGo = Boolean(prompt.trim()) && !generateDisabled && !comfyOffline && !restarting;

  return (
    <>
      {/* Every message, app-wide, at the top of the screen; the bar's row steps aside while one shows. */}
      <PhoneStatus message={message} />
      {/* One top bar (UI-PATTERNS › Phone): iOS's status bar sits over it, and a tap there scrolls the page to the top.
          Selecting swaps its contents (n Selected · All · Failed · In Progress · Close) rather than bringing in a second bar. */}
      <header ref={barRef} className={cn('phone-bar', selecting && 'is-selecting')}>
        {selecting ? (
          <div className={cn('phone-bar-row', message && 'has-message')}>
            <span className="phone-bar-title">{selectedItems.length ? `${selectedItems.length} Selected` : 'Select Items'}</span>
            <span className="phone-bar-gap" />
            <button type="button" className={cn('phone-icon', selection.allSelected && 'is-on')} aria-pressed={selection.allSelected} aria-label={selection.allSelected ? 'Select None' : 'Select All'} title={selection.allSelected ? 'Select None' : 'Select All'} disabled={!selection.selectable.some((item) => item.status !== 'pending')} onClick={selection.toggleAll}><CheckSquare size={20} /></button>
            <button type="button" className="phone-icon" aria-label="Select Failed" title="Select Failed" disabled={!selection.failedCount} onClick={selection.selectFailed}><AlertTriangle size={20} /></button>
            <button type="button" className="phone-icon" aria-label="Select In Progress" title="Select In Progress" disabled={!selection.runningCount} onClick={selection.selectRunning}><LoaderCircle size={20} /></button>
            {/* Close on the right, as on every phone surface. */}
            <button type="button" className="phone-icon" aria-label="Stop Selecting" onClick={selection.end}><X size={22} /></button>
          </div>
        ) : (
          <div className={cn('phone-bar-row', message && 'has-message')}>
            {/* Left, on one line: the status light, "Studio", then while anything runs its spinner and count. */}
            <div className={cn('phone-heading', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')}>
              <button type="button" className="phone-heading-light" aria-label={`${statusText}. Check Again`} title={statusText} onClick={retryComfyStatus}><span /></button>
              <span className="phone-heading-name">Studio</span>
              {runningCount ? <button type="button" className="phone-running-inline" aria-label={runningLabel} aria-haspopup="menu" aria-expanded={runningOpen} title={runningLabel} onClick={() => setRunningOpen((value) => !value)}>
                <LoaderCircle size={14} className="spin" aria-hidden="true" /><span>{runningCount}</span>
              </button> : null}
            </div>
            <span className="phone-bar-gap" />
            {/* No Select button on the phone: a long press on a tile starts selecting. */}
            <ToolButton label="Search Gallery" Icon={Search} count={queryCount} open={expanded === 'search'} onClick={() => toggleTools('search')} />
            <ToolButton label="Open Gallery Filters" Icon={SlidersHorizontal} count={filterCount} open={expanded === 'filters'} onClick={() => toggleTools('filters')} />
            <button type="button" className={cn('phone-icon phone-menu-trigger', moreOpen && 'is-open')} aria-label="Menu" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Menu size={22} /></button>
          </div>
        )}
        {/* Search or the filters, full width under the bar, one at a time. */}
        {selecting ? null : <PhoneGalleryTools expanded={expanded} search={gallerySearch} setSearch={setGallerySearch} onClose={closeTools} items={gallery} viewControls={<GalleryViewControls prefs={view.prefs} setPrefs={view.setPrefs} hasVideos={gallery.some((item: GalleryItem) => item.type === 'video')} searching={searchActive(gallerySearch)} />} />}
      </header>

      <main className="phone-gallery" onWheel={view.onGalleryUserScroll} onTouchStart={view.onGalleryUserScroll}>
        {galleryBody}
      </main>

      {selecting ? (
        <nav className="phone-select-bar" aria-label="Selected Items">
          {bulkActions.map((action, index) => (
            <React.Fragment key={action.id}>
              {startsGroup(bulkActions, index) ? <i className="viewer-phone-divider" aria-hidden="true" /> : null}
              <button type="button" className={cn(action.danger && 'is-danger')} aria-label={action.tip || action.label} disabled={action.disabled} onClick={action.run}>
                <action.Icon size={20} /><span>{action.label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      {!selecting ? (
        // The collapsed prompt bar (UI-PATTERNS › Phone): the prompt on one line, which opens Create, and Generate.
        <div ref={dockRef as unknown as React.RefObject<HTMLDivElement>} className={cn('phone-prompt-bar', prompt.trim() && 'has-draft', pending.length > 0 && 'is-working')}>
          {/* The gallery's Images | Videos, at the bar's left end. */}
          <MediaModeToggle kind="gallery" className="phone-gallery-mode" mode={mode} onChange={changeMode} tips={false} />
          <button type="button" className="phone-create-open phone-prompt-open" aria-label={prompt.trim() ? `Create: ${prompt.trim().slice(0, 80)}` : 'Create'} onClick={() => setCreateOpen(true)}>
            <span className="phone-prompt-text">{prompt.trim() || (mode === 'video' ? 'Describe a video…' : 'Describe an image…')}</span>
          </button>
          <button type="button" className={cn('phone-prompt-go', pending.length > 0 && 'is-working')} style={{ '--progress': progress } as React.CSSProperties} aria-label="Generate" title={quickGo ? 'Generate' : prompt.trim() ? 'Can’t generate yet' : 'Write a prompt first'} disabled={!quickGo} onClick={() => generate()}>
            <ArrowUp size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <CreateSheet view={view} open={createOpen} onClose={() => setCreateOpen(false)} canUseNegativePrompt={canUseNegativePrompt} comfyOffline={comfyOffline} />
      <PhoneMenu open={runningOpen} onClose={() => setRunningOpen(false)} trigger=".phone-running-inline" label={runningLabel} align="left" items={[
        { id: 'show', Icon: Images, label: 'Show Running', run: () => { setRunningOpen(false); revealRunning(); } },
        { id: 'stop', Icon: CircleStop, label: 'Stop All', count: runningCount, danger: true, run: () => { setRunningOpen(false); view.cancelQueue(); } }
      ]} />
      {/* Hold a tile to select; Menu › Select is the way in without a long press (keyboards, screen readers). */}
      <MoreMenu view={view} open={moreOpen} onClose={() => setMoreOpen(false)} onSelect={selectable.length ? startSelecting : undefined} />
    </>
  );
}

/**
 * What is running, for the top bar and the prompt bar: the pending items, their
 * average step progress (the ring on Generate) and the running count's name. An
 * upscale (on its own, or the end of a run) is not a generation.
 */
function runningSummary(gallery: GalleryItem[], runningCount: number) {
  const pending = gallery.filter((item) => item.status === 'pending');
  const withSteps = pending.map((item) => progressReading(item.progress)).flatMap((reading) => reading.kind === 'steps' ? [reading.ratio] : []);
  const progress = withSteps.length ? withSteps.reduce((sum, ratio) => sum + ratio, 0) / withSteps.length : 0;
  const upscalingCount = gallery.filter((item) => item.upscale?.status === 'running' || (item.status === 'pending' && item.progress?.upscaling)).length;
  const generatingCount = Math.max(0, runningCount - upscalingCount);
  const label = !upscalingCount
    ? generatingLabel(generatingCount, pending)
    : !generatingCount
      ? upscalingCount === 1 ? 'Upscaling 1 image' : `Upscaling ${upscalingCount}`
      : `Generating ${generatingCount} · upscaling ${upscalingCount}`;
  return { pending, progress, label };
}

/** A top-bar tool: tinted with a count badge while it has something applied, pressed while its row is open. */
function ToolButton({ label, Icon, count, open, onClick }: { label: string; Icon: LucideIcon; count: number; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn('phone-icon phone-tool', count > 0 && 'is-active', open && 'is-open')} aria-label={label} aria-description={count ? `${count} active` : undefined} aria-expanded={open} onClick={onClick}>
      <Icon size={20} />
      {count ? <span className="phone-tool-count" aria-hidden="true">{count}</span> : null}
    </button>
  );
}
