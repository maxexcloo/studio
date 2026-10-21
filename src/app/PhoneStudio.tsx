import { PickerTools, SelectedTick } from './PickerTools';
import { PromptField } from './PromptField';
import { CatalogueFilters, catalogueViews } from './CatalogueFilters';
import { ComposerModeSelect, MediaModeToggle } from './ComposerModeSelect';
import React from 'react';
import { createPortal } from 'react-dom';
import { usePhoneLayer } from './phoneLayers';
import { useDismiss } from './useDismiss';
import { recipesFor } from './modelRecipes';
import { modelName } from './catalogueNames';
import { modelDetails, setupNote, useModelCatalogue, type ModelMenuState } from './modelCatalogue';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMotionTween } from '@/lib/springs';
import { popoverMotion, useSettling } from './composerSurface';
import { AlertTriangle, ArrowUp, Check, CheckSquare, CircleStop, Library, LogOut, RefreshCw, Eraser, LoaderCircle, Menu, Ratio, Search, Settings, SlidersHorizontal, Star, Trash2, UserRound, Wand2, X, Images } from 'lucide-react';
import { cn, aspectIconStyle } from './format';
import { NumberPicker } from './components';
import { Sheet } from './Sheet';
import { startsGroup } from './ItemActionSurfaces';
import { bulkItemActions, useItemActionHandlers } from './itemActions';
import type { GallerySelection } from './gallerySelection';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { progressReading } from './GenerationProgress';
import { generatingLabel } from './itemWording';
import { estimatePhrase } from './useGenerationEstimate';
import type { GalleryItem, Profile, SavedSize } from './types';
import { LinkedSizeFields, MegapixelField, SizeTabs, sizeMenuModel, type SizeTier } from './SizeMenu';
import { MEGAPIXEL, ratioName } from './sizing';
import { ListButton, ListItem, ListSection, ListSelect } from './SheetList';
import { AdvancedPopover, ComposerSurface } from './LoraPopover';
import { practicalStepRange } from './SidebarControls';
import { PromptHistorySheet } from './PromptHistory';
import { PhoneGalleryTools, clearedSearch, filterCountOf } from './GallerySearch';
import { GalleryViewControls } from './GalleryViewControls';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { usePromptHistory } from './recentPrompts';
import { signOutAccount } from './accounts';
import { hasAccountStorageScope } from './api';
import { StatusPill, useStatusHost } from './StatusMessage';
import { EmptyState } from './EmptyState';

/* ---------------------------------------------------------------------------
   The phone studio

   A phone is a second screen for the computer that runs ComfyUI: it is for
   making, browsing and sharing images, not for looking after that computer.
   Everything here is thumb-first: one "Describe…" pill at the bottom opens a
   full-height create sheet, pickers are bottom sheets with 56px rows, tiles
   open on tap and show their actions on a long press, and the viewer has a
   labelled action bar. Advanced settings stay one link away.

   The state and logic are the studio's own (main.tsx); this file only lays
   them out for a phone. StudioView renders it in place of the desktop shells
   and keeps the shared overlays (viewer, dialogs, toasts).
--------------------------------------------------------------------------- */


/* ------------------------------------------------------------ The shell */

export function PhoneShell({ view, galleryBody, canUseNegativePrompt, comfyOffline, createOpen, setCreateOpen, selection }: {
  view: Record<string, any>;
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
  const gallery = (visibleGallery || []) as GalleryItem[];
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

  // Progress of what is running, for the ring on the pill and its second line.
  const pending = gallery.filter((item) => item.status === 'pending');
  const readings = pending.map((item) => progressReading(item.progress));
  const withSteps = readings.flatMap((reading) => reading.kind === 'steps' ? [reading.ratio] : []);
  const progress = withSteps.length ? withSteps.reduce((sum, ratio) => sum + ratio, 0) / withSteps.length : 0;
  // The top bar names what is running: an upscale (on its own, or the end of a run) is not a generation.
  const upscalingCount = gallery.filter((item) => item.upscale?.status === 'running' || (item.status === 'pending' && item.progress?.upscaling)).length;
  const generatingCount = Math.max(0, runningCount - upscalingCount);
  const runningLabel = !upscalingCount
    ? generatingLabel(generatingCount, pending)
    : !generatingCount
      ? upscalingCount === 1 ? 'Upscaling 1 image' : `Upscaling ${upscalingCount}`
      : `Generating ${generatingCount} · upscaling ${upscalingCount}`;

  // Finished runs use the shared compact notification, including swipe to dismiss.
  const pendingJobs = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const nowPending = new Set(pending.map((item) => item.jobId || item.id));
    const landed = gallery.find((item) => item.status === 'done' && pendingJobs.current.has(item.jobId || item.id) && !nowPending.has(item.jobId || item.id));
    pendingJobs.current = nowPending;
    if (!landed) return;
    if (!createOpen && !active) showToast(landed.type === 'video' ? 'Video Ready' : 'Image Ready', 'success', {
      duration: 5500,
      group: 'phone-generation-ready',
      action: { label: 'View', onClick: () => openItem(landed) }
    });
  }, [gallery]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moreOpen, setMoreOpen] = React.useState(false);
  // What's running: a tap shows it, or stops it all.
  const [runningOpen, setRunningOpen] = React.useState(false);
  React.useEffect(() => { if (!runningCount) setRunningOpen(false); }, [runningCount]);
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  // Search and the filter row share one row under the bar; one is open at a time.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const searchOpen = Boolean(view.phoneSearchOpen);
  const setSearchOpen = view.setPhoneSearchOpen as (open: boolean) => void;
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
  const message = useStatusHost();
  const quickGo = Boolean(prompt.trim()) && !generateDisabled && !comfyOffline && !restarting;

  return (
    <>
      {/* One top bar (UI-PATTERNS › Phone): iOS's status bar sits over it, and a tap there scrolls the page to the top.
          Selecting swaps its contents (Close · n Selected · Failed · All) rather than bringing in a second bar. */}
      <header ref={barRef} className={cn('phone-bar', selecting && 'is-selecting')}>
        {selecting ? (
          <div className="phone-bar-row">
            <button type="button" className="phone-icon" aria-label="Stop Selecting" onClick={selection.end}><X size={22} /></button>
            {/* A message (a question, an Undo) takes the title's place while selecting, too. */}
            {message ? <StatusPill message={message} className="is-bar" /> : <>
              <span className="phone-bar-title">{selectedItems.length ? `${selectedItems.length} Selected` : 'Select Items'}</span>
              <span className="phone-bar-gap" />
            </>}
            {message ? null : <>
            <button type="button" className={cn('phone-icon', selection.allSelected && 'is-on')} aria-pressed={selection.allSelected} aria-label={selection.allSelected ? 'Select None' : 'Select All'} title={selection.allSelected ? 'Select None' : 'Select All'} onClick={selection.toggleAll}><CheckSquare size={20} /></button>
            {selection.failedCount ? <button type="button" className="phone-icon" aria-label="Select Failed" title="Select Failed" onClick={selection.selectFailed}><AlertTriangle size={20} /></button> : null}
            </>}
          </div>
        ) : (
          <div className={cn('phone-bar-row', message && 'has-message')}>
            {/* Left: the status light (or running jobs) and "Studio" on one line. */}
            <div className={cn('phone-heading', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')}>
              {runningCount ? <button type="button" className="phone-running-inline" aria-label={runningLabel} aria-haspopup="menu" aria-expanded={runningOpen} title={runningLabel} onClick={() => setRunningOpen((value) => !value)}>
                <LoaderCircle size={14} className="spin" aria-hidden="true" /><span>{runningCount}</span>
              </button> : <button type="button" className="phone-heading-light" aria-label={`${statusText}. Check Again`} title={statusText} onClick={retryComfyStatus}><span /></button>}
              <span className="phone-heading-name">Studio</span>
            </div>
            {/* Centre: empty unless a message shows (UI-PATTERNS › Messages). */}
            {message ? <StatusPill message={message} className="is-bar" /> : <span className="phone-bar-gap" />}
            {/* A question takes the whole row but "Studio": its answers need the room, and nothing else applies until it is answered. */}
            {message?.confirm ? null : <>
            <button type="button" className="phone-icon phone-select-trigger" aria-label="Select" disabled={!selectable.length} onClick={startSelecting}><CheckSquare size={20} /></button>
            <ToolButton label="Search Gallery" Icon={Search} count={queryCount} open={expanded === 'search'} onClick={() => toggleTools('search')} />
            <ToolButton label="Open Gallery Filters" Icon={SlidersHorizontal} count={filterCount} open={expanded === 'filters'} onClick={() => toggleTools('filters')} />
            <button type="button" className={cn('phone-icon phone-menu-trigger', moreOpen && 'is-open')} aria-label="Menu" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Menu size={22} /></button>
            </>}
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
      <MoreMenu view={view} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

/** A top-bar tool: tinted with a count badge while it has something applied, pressed while its row is open. */
function ToolButton({ label, Icon, count, open, onClick }: { label: string; Icon: typeof Search; count: number; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn('phone-icon phone-tool', count > 0 && 'is-active', open && 'is-open')} aria-label={label} aria-description={count ? `${count} active` : undefined} aria-expanded={open} onClick={onClick}>
      <Icon size={20} />
      {count ? <span className="phone-tool-count" aria-hidden="true">{count}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------ Create */

function CreateSheet({ view, open, onClose, canUseNegativePrompt, comfyOffline }: { view: Record<string, any>; open: boolean; onClose: () => void; canUseNegativePrompt: boolean; comfyOffline: boolean }) {
  const heightTween = useMotionTween();
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile,
    aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceInpaint, referenceRole, referenceAssets, selectReferenceAsset, removeReferenceAsset, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, grokMediaControls, phoneVideoDurationControls, phoneAdvancedControls, generationEstimate,
    customSize, sizeTier, sizeMax, customLimits, savedSizes, sizeArea, sizeTiers, sampler
  } = view;
  // Several references: Edit and Ref say what happens to all of them, not only the first.
  const picked = (referenceAssets || []) as Array<{ slot: string; asset: unknown }>;
  const many = picked.length > 1;
  // One pop-up over Create at a time (UI-PATTERNS › Surfaces): Model, Size or Advanced; References and LoRAs have their own.
  const [pop, setPop] = React.useState<'' | 'model' | 'size' | 'advanced'>('');
  React.useEffect(() => { if (!open) setPop(''); }, [open]);
  const toggle = (which: 'model' | 'size' | 'advanced') => setPop((current) => current === which ? '' : which);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyKind, setHistoryKind] = React.useState<'positive' | 'negative'>('positive');
  const { prompts: recentNegatives } = usePromptHistory(open, 'negative');
  const { prompts: recentPrompts } = usePromptHistory(open);
  const restarting = Boolean(comfyStatus?.restarting);
  const variations = mode === 'video' || currentProfile?.capabilities?.variations !== false;
  const maxCount = Math.max(1, Number(countMeta?.max || 8));
  // The size row reads like the desktop's size button: the shape, its name, the size it makes.
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const size = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes, targetArea: sizeArea || 0, offerTwoK: Boolean(sizeTiers?.includes('2k')) });
  const sizeText = `${ratioName(size.shown.width, size.shown.height)} · ${size.shown.width}×${size.shown.height}`;
  // A long run says so before it starts; a quick one needs no warning.
  const estimate = generationEstimate?.ms && generationEstimate.ms >= 45_000 ? `Takes ${estimatePhrase(generationEstimate)}.` : '';
  const hasReferences = Boolean((referenceInputs || []).length);
  const lorasOffered = mode !== 'video' || currentProfile?.capabilities?.lora;
  const fixedSeed = String(seed || '').trim();
  const stepsOffered = currentProfile?.family !== 'grok' && currentProfile?.capabilities?.steps !== false;
  const advancedText = [sampler ? String(sampler) : '', fixedSeed ? `Seed ${fixedSeed}` : '', Number(view.prefs?.runUpscale) ? `Upscale ${Number(view.prefs.runUpscale) === 4096 ? '4K' : '2K'}` : ''].filter(Boolean).join(' · ');
  const blocked = restarting || (!comfyOffline && (!prompt.trim() || generateDisabled));
  const { min: stepMin, max: stepMax } = practicalStepRange(currentProfile, stepsMeta, steps);

  // Clear at the end of the References and LoRAs rows, with Undo in the status pill.
  const clearReferences = () => {
    const cleared = [...picked];
    removeReferenceAsset(cleared.map((item) => item.slot));
    showToast('References cleared', 'default', { action: { label: 'Undo', onClick: () => cleared.forEach((item) => selectReferenceAsset(item.slot, item.asset)) } });
  };

  // A focused Prompt or Negative shows only itself, above the keyboard (useTextFocus).
  const [textFocus, setTextFocus] = React.useState(false);
  React.useEffect(() => { if (!open) setTextFocus(false); }, [open]);

  const go = () => {
    if (comfyOffline) { retryComfyStatus(); return; }
    if (restarting) return;
    // generate() explains anything missing; only close when it can actually run.
    const ready = prompt.trim() && !generateDisabled;
    generate();
    if (ready) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      className={cn('phone-create', textFocus && 'is-text-focus')}
      title="Create"
      footer={
        <>
          {/* Two lines, always in view: Steps and the count, then Image | Video, Clear and Generate. */}
          {stepsOffered || (variations && maxCount > 1) ? (
            <div className="create-footer-tune">
              {stepsOffered ? <NumberPicker className="create-tune create-steps" label="Steps" value={steps} min={stepMin} max={stepMax} step={1} onChange={setSteps} size="sm" /> : null}
              {variations && maxCount > 1 ? <NumberPicker className="create-tune composer-count-picker create-count" label={mode === 'video' ? 'Videos' : 'Images'} value={count} min={countMeta.min || 1} max={maxCount} step={countMeta.step || 1} onChange={setCount} size="sm" /> : null}
            </div>
          ) : null}
          <div className="create-footer">
            <ComposerModeSelect mode={mode} onChange={view.changeMode} tips={false} />
            <button type="button" className="phone-icon create-reset" aria-label="Clear All" aria-description="Clears the prompt, negative prompt, references and LoRAs" onClick={view.resetCreation}><Eraser size={20} /></button>
            <button type="button" className={cn('phone-generate create-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')} aria-label={comfyOffline ? 'Check Again' : 'Generate'} aria-description={(generateDisabled && prompt.trim() ? generateDisabledReason : estimate) || undefined} aria-disabled={blocked || undefined} onClick={go}>
              {restarting || comfyOffline ? <RefreshCw size={18} className={cn((restarting || comfyRetrying) && 'spin')} /> : <ArrowUp size={18} strokeWidth={2.4} />}
              <span>{restarting ? 'Restarting' : comfyOffline ? 'Check Again' : 'Generate'}</span>
            </button>
          </div>
        </>
      }
    >
      {/* One flat column: the prompt takes the room that's left, then one row per choice. */}
      <div className="create-flow">
        <div className="create-prompts">
          <PromptField kind="positive" fill selectAll focusMode onFocusModeChange={setTextFocus} value={prompt} ariaLabel="Prompt" onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt('')} historyAvailable={Boolean(recentPrompts.length)} historyOpen={historyOpen && historyKind === 'positive'} onHistory={() => { setHistoryKind('positive'); setHistoryOpen(true); }} />
          {currentProfile?.capabilities?.negativePrompt !== false ? <PromptField kind="negative" minRows={2} focusMode onFocusModeChange={setTextFocus} value={negative} onChange={(value) => setNegative(clampText(value, negativeLimit))} onClear={() => setNegative('')} historyAvailable={Boolean(recentNegatives.length)} historyOpen={historyOpen && historyKind === 'negative'} onHistory={() => { setHistoryKind('negative'); setHistoryOpen(true); }} /> : null}
        </div>
        <div className="list-group create-options">
          <ListButton className="phone-model-browse" label="Model" value={currentProfile ? modelName(currentProfile).name : 'Choose'} data-open-trigger aria-label="Choose Model" aria-haspopup="dialog" aria-expanded={pop === 'model'} onClick={() => toggle('model')} />
          {hasReferences ? (
            // The chooser's button lands here (ReferenceSlots portals into the tools), as wide as the row; Clear sits at its end.
            <div className={cn('list-row is-static create-references', picked.length > 0 && 'has-picks')}>
              <span className="list-row-label">References</span>
              <div className="composer-reference-tools" />
              {picked.length ? <button type="button" className="list-row-clear" aria-label="Clear References" onClick={clearReferences}><X size={16} aria-hidden="true" /></button> : null}
            </div>
          ) : null}
          {/* Edit or Reference, in plain sight: on a phone there's no hover to open the chip's menu, and no tooltip to say what each does. */}
          <AnimatePresence initial={false}>
            {referenceRole ? (
              <motion.div key="role" className="phone-ref-role" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={heightTween}>
                <div className={cn('ref-menu-role', referenceRole.value === 'reference' && 'is-ref', referenceRole.locked && 'is-locked')} role="radiogroup" aria-label="What This Image Is">
                  <i aria-hidden="true" />
                  {(['edit', 'reference'] as const).map((value) => (
                    // A painted mask settles it as Edit: Reference stays, unavailable, and the line says why.
                    <button key={value} type="button" role="radio" aria-checked={referenceRole.value === value} aria-disabled={(referenceRole.locked && value === 'reference') || undefined} className={cn(referenceRole.value === value && 'is-active')} onClick={() => { if (referenceRole.locked && value === 'reference') { return; } referenceRole.onChange(value); }}>
                      {value === 'edit' ? 'Edit' : 'Reference'}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {lorasOffered ? (
            <div className={cn('list-row-wrap', view.loraSummary && 'has-clear')}>
              <ListButton label="LoRAs" value={view.loraSummary || 'None'} end={view.loraSummary ? 'none' : 'chevron'} data-open-trigger aria-label="LoRAs" aria-haspopup="dialog" aria-expanded={Boolean(view.lorasOpen)} onClick={() => view.openLoras()} />
              {view.loraSummary ? <button type="button" className="list-row-clear" aria-label="Clear LoRAs" onClick={view.clearLoras}><X size={16} aria-hidden="true" /></button> : null}
            </div>
          ) : null}
          {!aspectLocked ? (
            <ListButton label="Size" value={sizeText} data-open-trigger aria-label={`Size: ${sizeText}`} aria-haspopup="dialog" aria-expanded={pop === 'size'} onClick={() => toggle('size')} />
          ) : <ListItem label="Size"><span className="list-row-value">Follows the image · {size.shown.width}×{size.shown.height}</span></ListItem>}
          <ListButton label="Advanced" value={advancedText} data-open-trigger aria-label="Advanced Settings" aria-haspopup="dialog" aria-expanded={pop === 'advanced'} onClick={() => toggle('advanced')} />
        </div>
        <ReferenceSlots
          scope={`${mode}:${view.model}`}
          inputs={referenceInputs || []}
          openRequest={view.referenceOpenRequest}
          inpaint={referenceInpaint}
          role={referenceRole}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          onError={(message) => showToast(message, 'error')}
        />
      </div>
      <PromptHistorySheet
        kind={historyKind}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={(text) => { if (historyKind === 'negative') setNegative(clampText(text, negativeLimit)); else setPrompt(clampText(text, promptLimit)); setHistoryOpen(false); }}
        onError={(message) => showToast(message, 'error')}
      />

      <AnimatePresence>
        {open && pop === 'model' ? <ComposerSurface key="model" title="Model" icon={<Wand2 size={16} />} trigger='[data-open-trigger][aria-label="Choose Model"][aria-expanded="true"]' className="phone-model-pop" bodyClassName="phone-model-pop-body" onClose={() => setPop('')}><PhoneModelList view={view} onPicked={() => setPop('')} /></ComposerSurface> : null}
        {open && pop === 'size' ? <ComposerSurface key="size" title="Size" icon={<Ratio size={16} />} trigger='[data-open-trigger][aria-label^="Size:"][aria-expanded="true"]' className="phone-size-pop" bodyClassName="phone-size-pop-body" onClose={() => setPop('')}><PhoneSize view={view} /></ComposerSurface> : null}
      </AnimatePresence>
      <AdvancedPopover open={open && pop === 'advanced'} onClose={() => setPop('')}>{grokMediaControls}{phoneVideoDurationControls}{phoneAdvancedControls}</AdvancedPopover>
    </Sheet>
  );
}

/** The model chooser's list (UI-PATTERNS › Pickers): search, Fast | Quality, favourites and family groups. */
function PhoneModelList({ view, onPicked }: { view: Record<string, any>; onPicked: () => void }) {
  const { modelProfiles, model, pickModel, modelMenu } = view as { modelProfiles: Profile[]; model: string; pickModel: (id: string) => void; modelMenu?: ModelMenuState };
  const { profiles, menu, isFavourite, query, setQuery, filters, setFilters, sections, noMatchText } = useModelCatalogue(modelProfiles, model, modelMenu);
  const recipes = recipesFor(modelProfiles || [], model);
  const row = (profile: Profile) => (
    <div key={profile.id} className={cn('list-row model-pop-row', profile.id === model && 'is-selected')}>
      <button type="button" className="model-pop-pick" aria-current={profile.id === model || undefined} onClick={() => { pickModel(profile.id); onPicked(); }}>
        <span className="model-pop-name">{modelName(profile).name}<small className={cn(setupNote(profile) && 'is-setup')}>{[modelDetails(profile), setupNote(profile)].filter(Boolean).join(' · ')}</small></span>
        <SelectedTick on={profile.id === model} className="list-row-end" />
      </button>
      {menu ? (
        <button type="button" className={cn('picker-star', isFavourite(profile.id) && 'is-on')} aria-pressed={isFavourite(profile.id)} aria-label={isFavourite(profile.id) ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => menu.toggleFavorite(profile.id)}>
          <Star size={16} fill={isFavourite(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <>
      <div className="phone-model-tools">
        {recipes.length ? <ListItem label="Recipe"><ListSelect label="Recipe" value={model} options={recipes.map((profile) => ({ value: profile.id, label: profile.recipe!.label }))} onChange={(value) => pickModel(value)} /></ListItem> : null}
        {profiles.length ? <PickerTools query={query} onClearSearch={() => setQuery('')} searchLabel="Search Models" views={catalogueViews(filters, setFilters)} search={<label className="picker-search">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Models" aria-label="Search Models" spellCheck={false} autoComplete="off" />
            {query ? <button type="button" aria-label="Clear Model Search" onClick={() => setQuery('')}><X size={14} /></button> : null}
          </label>}>
          <CatalogueFilters value={filters} onChange={setFilters} />
        </PickerTools> : null}
      </div>
      {!profiles.length ? (view.comfyStatus?.connected ? <EmptyState title="No Models Yet">Add a model to ComfyUI to see it here.</EmptyState> : <EmptyState title="ComfyUI Is Offline">Models show up when it’s back.</EmptyState>) : null}
      {sections.map((section) => <ListSection key={section.id} title={section.label || undefined}>{section.rows.map(row)}</ListSection>)}
      {profiles.length && !sections.length ? <EmptyState title="No Matching Models">{noMatchText}</EmptyState> : null}
    </>
  );
}

/**
 * Size, in the pop-up over Create: the model's native resolutions as one
 * full-width toggle, the shapes as one full-width toggle (their outline and
 * ratio), then Width and Height, always in view, as on the desktop. Typing a
 * side makes it a custom size; a shape or resolution goes back to the preset.
 * The saved sizes follow, with Rename and Remove behind Edit.
 */
const shapeIn = (w: number, h: number) => { const scale = Math.min(22 / (w || 1), 16 / (h || 1)); return { width: Math.max(6, Math.round(w * scale)), height: Math.max(6, Math.round(h * scale)) }; };

function PhoneSize({ view }: { view: Record<string, any> }) {
  const {
    aspectOptions, aspectPickerValue, aspectValue, defaultAspectSize, applyAspect, mode, currentProfile, customSize, sizeTier, sizeMax, customLimits,
    chooseSizeTier, setCustomDimensions, savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize,
    sizeTiers, sizeArea, megapixelControl
  } = view;
  const saved = (savedSizes || []) as SavedSize[];
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const tiers: SizeTier[] = sizeTiers || (mode === 'image' ? ['none', '2k', 'custom'] : ['none', 'custom']);
  const model = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes: saved, targetArea: sizeArea || 0, offerTwoK: tiers.includes('2k') });
  const { custom, picked, shown, rows, savedMatch, ownSize, isActive, note } = model;
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!saved.length) setEditing(false); }, [saved.length]);
  const resolutions = tiers.filter((item) => item !== 'custom');
  return (
    <div className="phone-size">
      {resolutions.length > 1 ? <SizeTabs tiers={resolutions} labelled={false} value={tier} onChange={(next) => { chooseSizeTier(next); }} /> : null}
      <div className="size-shapes" role="radiogroup" aria-label="Shape">
        {rows.map((row) => (
          <button key={row.key} type="button" role="radio" aria-checked={isActive(row)} className={cn('size-shape', isActive(row) && 'is-active')}
            aria-label={`${row.small ? `${row.label}, ${row.small}` : row.label}, ${row.size.width} × ${row.size.height}`}
            onClick={() => applyAspect(row.value)}>
            <span className="aspect-shape" style={shapeIn(row.shape.w, row.shape.h)} aria-hidden="true" />
            <span aria-hidden="true">{row.key === 'default' ? 'Default' : row.label}</span>
          </button>
        ))}
        {customLimits ? (
          <button type="button" role="radio" aria-checked={custom && !savedMatch} className={cn('size-shape is-custom', custom && !savedMatch && 'is-active')}
            aria-label={custom ? `Custom, ${picked.width} × ${picked.height}` : 'Custom'} onClick={() => chooseSizeTier('custom')}>
            <span className="aspect-shape" style={shapeIn(shown.width, shown.height)} aria-hidden="true" />
            <span aria-hidden="true">Custom</span>
          </button>
        ) : null}
      </div>
      {megapixelControl ? <div className="phone-size-mp"><MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixelControl} custom={custom} /></div> : null}
      {customLimits ? <div className="size-custom phone-size-fields"><LinkedSizeFields size={custom ? picked : shown} limits={customLimits} onChange={setCustomDimensions} onSave={custom && (ownSize || savedMatch) ? () => { saveCustomSize(); } : undefined} saved={Boolean(savedMatch)} disabled={!custom} /></div> : null}
      {note ? <p className="list-note">{note}</p> : null}
      {saved.length ? (
        <>
          <div className="phone-size-saved-head">
            <h3 className="list-section-title">Saved</h3>
            <button type="button" className={cn('phone-size-edit', editing && 'is-on')} aria-pressed={editing} onClick={() => { setEditing((value) => !value); }}>{editing ? 'Done' : 'Edit'}</button>
          </div>
          <div className={cn('list-group phone-size-list', editing && 'is-editing')} role="listbox" aria-label="Saved Sizes">
            <AnimatePresence initial={false}>
              {saved.map((item) => (
                <PhoneSavedSize
                  key={item.id}
                  saved={item}
                  active={savedMatch?.id === item.id}
                  editing={editing}
                  pressHandlers={{}}
                  onPick={() => pickSavedSize(item)}
                  onRename={(name) => renameSavedSize(item.id, name)}
                  onRemove={() => removeSavedSize(item.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A saved size: a row like the shapes, its name with its ratio under it.
 * Under Edit the name turns into a field where it stands (Enter or leaving
 * keeps it, Escape puts it back) and Remove slides in beside the size, which
 * steps aside for it; Undo is on the toast. One row throughout, so going in
 * and out of Edit glides instead of swapping.
 */
function PhoneSavedSize({ saved, active, editing, pressHandlers, onPick, onRename, onRemove }: {
  saved: SavedSize;
  active: boolean;
  editing: boolean;
  pressHandlers: React.HTMLAttributes<HTMLElement>;
  onPick: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = React.useState(saved.name);
  React.useEffect(() => { setDraft(saved.name); }, [saved.name, editing]);
  // Escape leaves the field without keeping what was typed.
  const reverting = React.useRef(false);
  const keep = (typed: string) => {
    const name = typed.trim();
    if (reverting.current || !name || name === saved.name) { reverting.current = false; setDraft(saved.name); return; }
    onRename(name);
  };
  const ratio = ratioName(saved.width, saved.height);
  const heightTween = useMotionTween();
  return (
    <motion.div
      className="phone-size-saved"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={heightTween}
    >
      <div className={cn('phone-row phone-size-row is-saved', active && 'is-current', editing && 'is-editing')} {...(editing ? {} : pressHandlers)}>
        {editing ? null : <button type="button" className="phone-size-hit" role="option" aria-selected={active} aria-label={`${saved.name}, ${ratio}, ${saved.width} × ${saved.height}`} onClick={onPick} />}
        <span className="phone-size-shape" aria-hidden="true"><span className="aspect-shape" style={aspectIconStyle({ label: ratio, value: '', w: saved.width, h: saved.height })} /></span>
        <span className="phone-size-text" aria-hidden={!editing || undefined}>
          <input
            className="phone-size-name"
            data-own-escape
            value={draft}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            maxLength={32}
            enterKeyHint="done"
            aria-label={`Name of ${saved.name}`}
            onFocus={(event) => { if (editing) event.currentTarget.select(); }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => { if (editing) keep(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reverting.current = true; event.currentTarget.blur(); }
            }}
          />
          <small>{ratio}</small>
        </span>
        <em aria-hidden="true">{saved.width}×{saved.height}</em>
        <span className="phone-size-remove-slot">
          <button type="button" className="phone-size-remove" tabIndex={editing ? 0 : -1} aria-hidden={!editing || undefined} aria-label={`Remove ${saved.name}`} onClick={onRemove}><Trash2 size={18} /></button>
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------ More */

type MenuItem = { id: string; Icon: typeof Search; label: string; run: () => void; danger?: boolean; disabled?: boolean; /** A count after the label, as on the desktop's Stop All. */ count?: number } | 'divider';

/**
 * A small pop-up menu anchored under a top-bar button, over the page
 * (UI-PATTERNS › Surfaces): compact rows with an icon, no boxes. The same
 * glass and motion as the Create pop-ups; one at a time (phoneLayers.ts).
 */
function PhoneMenu({ open, onClose, trigger, label, items, align = 'right' }: { open: boolean; onClose: () => void; trigger: string; label: string; items: MenuItem[]; align?: 'left' | 'right' }) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  if (open && !opener.current) opener.current = document.querySelector<HTMLElement>(trigger);
  if (!open) opener.current = null;
  usePhoneLayer(open, 'pop');
  useDismiss([menuRef, opener], open, onClose);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const [left] = React.useState(() => 0);
  const anchorLeft = open && align === 'left' ? Math.max(8, (opener.current?.getBoundingClientRect().left || 8) - 4) : left;
  const settling = useSettling();
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div ref={menuRef} key="menu" className={cn('phone-menu', align === 'left' && 'is-left')} style={align === 'left' ? { left: anchorLeft, right: 'auto' } : undefined} role="menu" aria-label={label}
          {...popoverMotion} {...settling}>
          {items.map((item, index) => item === 'divider'
            ? <i key={`divider-${index}`} className="phone-menu-divider" aria-hidden="true" />
            : <button key={item.id} type="button" role="menuitem" className={cn('phone-menu-item', item.danger && 'is-danger')} aria-label={item.count ? `${item.label} (${item.count})` : undefined} disabled={item.disabled} onClick={item.run}><item.Icon size={19} aria-hidden="true" /><span>{item.label}</span>{item.count ? <i className="phone-menu-count">{item.count}</i> : null}</button>)}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/** The top bar's menu: Select, Library, Settings, then Account and Sign Out. Gallery switches live in Settings; Stop All is in what's running. */
function MoreMenu({ view, open, onClose, onSelect }: { view: Record<string, any>; open: boolean; onClose: () => void; onSelect?: () => void }) {
  const [signingOut, setSigningOut] = React.useState(false);
  const items: MenuItem[] = [];
  if (onSelect) items.push({ id: 'select', Icon: CheckSquare, label: 'Select', run: () => { onClose(); onSelect(); } });
  if (view.models?.features?.presets === true) items.push({ id: 'library', Icon: Library, label: 'Library', run: () => { onClose(); view.setPresetLibraryOpen(true); } });
  items.push({ id: 'settings', Icon: Settings, label: 'Settings', run: () => { onClose(); view.openSettings('studio'); } });
  if (hasAccountStorageScope()) items.push('divider',
    { id: 'account', Icon: UserRound, label: 'Account', run: () => { onClose(); view.openSettings('account'); } },
    { id: 'sign-out', Icon: LogOut, label: signingOut ? 'Signing Out…' : 'Sign Out', danger: true, disabled: signingOut, run: () => { setSigningOut(true); signOutAccount().catch(() => { setSigningOut(false); view.showToast('Couldn’t sign out', 'error'); }); } });
  return <PhoneMenu open={open} onClose={onClose} trigger=".phone-menu-trigger" label="Menu" items={items} />;
}
