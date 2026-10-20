import { PromptField } from './PromptField';
import { CatalogueFilters } from './CatalogueFilters';
import { ComposerModeSelect, MediaModeToggle } from './ComposerModeSelect';
import React from 'react';
import { recipesFor } from './modelRecipes';
import { modelName } from './catalogueNames';
import { modelDetails, setupNote, useModelCatalogue, type ModelMenuState } from './modelCatalogue';
import { gridAutoplayEnabled, subscribeGridAutoplay, toggleGridAutoplay } from './videoPreviewScheduler';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowUp, Check, CheckSquare, ChevronRight, CircleStop, Dices, Image as ImageIcon, Layers, Library, LogOut, MoreHorizontal, Plus, RefreshCw, ListRestart, Search, Settings, SlidersHorizontal, Star, Trash2, UserRound, X, Film, Images } from 'lucide-react';
import { cn, aspectIconStyle } from './format';
import { NumberPicker } from './components';
import { Sheet } from './Sheet';
import { preferenceLabels, Switch } from './SettingsControls';
import { startsGroup } from './ItemActionSurfaces';
import { bulkItemActions, useItemActionHandlers } from './itemActions';
import type { GallerySelection } from './gallerySelection';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { Media } from './components';
import { progressReading } from './GenerationProgress';
import { generatingLabel } from './itemWording';
import { RestartEtaText } from './ComfyRestart';
import { estimatePhrase } from './useGenerationEstimate';
import type { GalleryItem, Profile, SavedSize } from './types';
import { LinkedSizeFields, MegapixelField, SizePreview, SizeTabs, sizeMenuModel, type SizeRow, type SizeTier } from './SizeMenu';
import { MEGAPIXEL, presetRatio, ratioName } from './sizing';
import { ListButton, ListItem, ListSection } from './SheetList';
import { PromptHistorySheet } from './PromptHistory';
import { PhoneGalleryTools, clearedSearch, filterCountOf } from './GallerySearch';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { usePromptHistory } from './recentPrompts';
import { signOutChecked } from './accounts';
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
  const toggleTools = (which: 'search' | 'filters') => {
    if (expanded === which) { closeTools(); return; }
    setSearchOpen(which === 'search');
    setFiltersOpen(which === 'filters');
  };
  // The strip's and dock's heights, for the gallery to clear and toasts to sit under the strip.
  const barRef = React.useRef<HTMLElement>(null);
  const dockRef = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    // On the root: toasts are portalled outside the shell.
    const root = document.documentElement;
    const measure = () => {
      // Hidden behind the selection header it measures 0; that header is as tall, so the last height stands.
      const bar = barRef.current?.getBoundingClientRect().height || 0;
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
      {selecting ? (
        <header className="phone-bar is-selecting">
          <button type="button" className="phone-icon" aria-label="Stop Selecting" onClick={selection.end}><X size={22} /></button>
          <div className="phone-title"><span>{selectedItems.length ? `${selectedItems.length} Selected` : 'Select Items'}</span></div>
          {selection.failedCount ? <button type="button" className="phone-pill" aria-label="Select Failed" onClick={selection.selectFailed}><AlertTriangle size={15} aria-hidden="true" />Failed</button> : null}
          <button type="button" className="phone-pill" aria-label={selection.allSelected ? 'Select None' : 'Select All'} onClick={selection.toggleAll}><CheckSquare size={15} aria-hidden="true" />{selection.allSelected ? 'None' : 'All'}</button>
        </header>
      ) : null}
      {/* A thin strip: iOS's status bar sits over it, and a tap there scrolls the page to the top. */}
      <header ref={barRef} className={cn('phone-bar', selecting && 'is-behind')}>
        <div className="phone-bar-row">
          {/* The Studio mark is the status: its light says whether generation can run, a tap checks again. */}
          {/* A message takes the pill over for a moment (UI-PATTERNS › Messages); the title steps aside. */}
          {message ? <StatusPill message={message} className="is-bar" /> : (
            <button type="button" className={cn('phone-status', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')} aria-label={`${statusText}. Check Again`} title={statusText} onClick={retryComfyStatus}>
              <span /><strong>Studio</strong>
            </button>
          )}
          <div className={cn('phone-title', message && 'is-yielding')}>
            <button type="button" className="phone-scroll-top" aria-label="Scroll To Top" onClick={scrollToTop}>
              <span>Gallery</span>
            </button>
            {runningCount ? <button type="button" className="phone-running-inline" aria-label={`${runningLabel}. Show It`} title={runningLabel} onClick={revealRunning}>
              <RefreshCw size={13} className="spin" aria-hidden="true" /><span>{runningCount}</span>
            </button> : null}
          </div>
        </div>
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
        // Bottom-up: what a thumb reaches for most sits in one dock above the home indicator.
        <nav ref={dockRef} className="phone-dock" aria-label="Gallery Controls">
          <PhoneGalleryTools expanded={expanded} search={gallerySearch} setSearch={setGallerySearch} onClose={closeTools} items={gallery} />
          {(
            <div className="phone-create-pill">
              <button type="button" className="phone-create-open" onClick={() => setCreateOpen(true)}>
                <strong className={cn(!prompt.trim() && 'is-placeholder')}>{prompt.trim() || 'Prompt...'}</strong>
              </button>
              <button
                type="button"
                className={cn('phone-go', pending.length > 0 && 'is-working')}
                style={{ '--progress': progress } as React.CSSProperties}
                aria-label={quickGo ? 'Generate' : 'Open the Composer'}
                onClick={() => { if (quickGo) generate(); else setCreateOpen(true); }}
              >
                {restarting ? <RefreshCw size={20} className="spin" /> : <ArrowUp size={22} strokeWidth={2.4} />}
              </button>
            </div>
          )}
          <div className="phone-dock-row">
            <MediaModeToggle kind="gallery" className="phone-gallery-mode" mode={mode} onChange={changeMode} tips={false}  />
            <ToolButton label="Search Gallery" Icon={Search} count={queryCount} open={expanded === 'search'} onClick={() => toggleTools('search')} />
            <ToolButton label="Open Gallery Filters" Icon={SlidersHorizontal} count={filterCount} open={expanded === 'filters'} onClick={() => toggleTools('filters')} />
            <span className="phone-dock-gap" />
            <button type="button" className="phone-icon" aria-label="More" onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} /></button>
          </div>
        </nav>
      ) : null}

      <CreateSheet view={view} open={createOpen} onClose={() => setCreateOpen(false)} canUseNegativePrompt={canUseNegativePrompt} comfyOffline={comfyOffline} />
      <MoreSheet view={view} open={moreOpen} onClose={() => setMoreOpen(false)} statusText={statusText} onSelect={selectable.length ? () => {
        // Clearing the search changes the view, which ends a selection: start once that has landed.
        const cleared = searchActive(searchRef.current);
        closeTools();
        if (cleared) window.requestAnimationFrame(() => selection.start()); else selection.start();
      } : undefined} />
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
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile,
    aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceInpaint, referenceRole, referenceAssets, selectReferenceAsset, removeReferenceAsset, confirmAction, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, grokMediaControls, phoneVideoDurationControls, phoneAdvancedControls, generationEstimate,
    customSize, sizeTier, sizeMax, customLimits, savedSizes, sizeArea, sizeTiers, sampler
  } = view;
  // Several references: Edit and Ref say what happens to all of them, not only the first.
  const many = (referenceAssets || []).length > 1;
  const [sheet, setSheet] = React.useState<'' | 'workflow' | 'size' | 'advanced'>('');
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
  const reason = restarting ? <>ComfyUI is restarting. <RestartEtaText fallback="Back in a few seconds." /></> : comfyOffline ? 'ComfyUI is offline.' : !prompt.trim() ? '' : generateDisabled ? generateDisabledReason : estimate;
  const hasReferences = Boolean((referenceInputs || []).length || view.referenceWith?.profiles?.length);
  const lorasOffered = mode !== 'video' || currentProfile?.capabilities?.lora;
  const fixedSeed = String(seed || '').trim();
  const advancedText = [currentProfile?.family !== 'grok' && steps ? `${steps} Steps` : '', sampler ? String(sampler) : '', fixedSeed ? `Seed ${fixedSeed}` : ''].filter(Boolean).join(' · ');
  const blocked = restarting || (!comfyOffline && (!prompt.trim() || generateDisabled));

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
      className="phone-create"
      title="Create"
      headerAction={<ComposerModeSelect mode={mode} onChange={view.changeMode} tips={false} />}
      footer={
        <>
          {reason ? <p className="phone-reason">{reason}</p> : null}
          {/* Always in view: how many, start again, and Generate. */}
          <div className="create-footer">
            {variations && maxCount > 1 ? <NumberPicker className="create-count" label={mode === 'video' ? 'Videos' : 'Images'} value={count} min={countMeta.min || 1} max={maxCount} step={countMeta.step || 1} onChange={setCount} size="sm" density="compact" icon={mode === 'video' ? <Film size={16} /> : <Images size={16} />} /> : null}
            <button type="button" className="phone-icon create-reset" aria-label="Reset Creation" title="Reset Creation" onClick={view.resetCreation}><ListRestart size={19} /></button>
            <button type="button" className={cn('phone-generate create-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')} aria-label={comfyOffline ? 'Check Again' : 'Generate'} aria-disabled={blocked || undefined} onClick={go}>
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
          <PromptField kind="positive" fill value={prompt} ariaLabel="Prompt" onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt('')} historyAvailable={Boolean(recentPrompts.length)} historyOpen={historyOpen && historyKind === 'positive'} onHistory={() => { setHistoryKind('positive'); setHistoryOpen(true); }} />
          {currentProfile?.capabilities?.negativePrompt !== false ? <PromptField kind="negative" minRows={1} value={negative} onChange={(value) => setNegative(clampText(value, negativeLimit))} onClear={() => setNegative('')} historyAvailable={Boolean(recentNegatives.length)} historyOpen={historyOpen && historyKind === 'negative'} onHistory={() => { setHistoryKind('negative'); setHistoryOpen(true); }} /> : null}
        </div>
        <div className="list-group create-options">
          <ListButton className="phone-model-browse" label="Model" value={currentProfile ? modelName(currentProfile).name : 'Choose'} aria-label="Browse Models" aria-haspopup="dialog" aria-expanded={sheet === 'workflow'} onClick={() => setSheet('workflow')} />
          {hasReferences ? (
            // The chooser's button lands here (ReferenceSlots portals into the tools), as wide as the row.
            <div className="list-row is-static create-references">
              <span className="list-row-label">References</span>
              <div className="composer-reference-tools" />
            </div>
          ) : null}
          {/* Edit or Reference, in plain sight: on a phone there's no hover to open the chip's menu, and no tooltip to say what each does. */}
          <AnimatePresence initial={false}>
            {referenceRole ? (
              <motion.div key="role" className="phone-ref-role" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
                <div className={cn('ref-menu-role', referenceRole.value === 'reference' && 'is-ref', referenceRole.locked && 'is-locked')} role="radiogroup" aria-label="What This Image Is">
                  <i aria-hidden="true" />
                  {(['edit', 'reference'] as const).map((value) => (
                    // A painted mask settles it as Edit: Reference stays, unavailable, and the line says why.
                    <button key={value} type="button" role="radio" aria-checked={referenceRole.value === value} aria-disabled={(referenceRole.locked && value === 'reference') || undefined} className={cn(referenceRole.value === value && 'is-active')} onClick={() => { if (referenceRole.locked && value === 'reference') { return; } referenceRole.onChange(value); }}>
                      {value === 'edit' ? 'Edit' : 'Reference'}
                    </button>
                  ))}
                </div>
                <small key={`${referenceRole.value}:${many}:${Boolean(referenceRole.locked)}`}>{referenceRole.locked ? 'The painted part changes this picture. Clear the paint to use it as a reference'
                  : referenceRole.value === 'edit'
                  ? many ? 'Changes the first picture, at its size. The others are what it can draw from' : 'Changes this picture, at its size and framing'
                  : many ? 'They all guide a new picture, at the size you pick' : 'Guides a new picture, at the size you pick'}</small>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {lorasOffered ? <ListButton label="LoRAs" value={view.loraSummary || 'None'} data-open-trigger aria-label="LoRAs" aria-haspopup="dialog" aria-expanded={Boolean(view.lorasOpen)} onClick={() => view.openLoras()} /> : null}
          {!aspectLocked ? (
            <ListButton label="Size" value={sizeText} aria-label={`Size: ${sizeText}`} aria-haspopup="dialog" aria-expanded={sheet === 'size'} onClick={() => setSheet('size')} />
          ) : <ListItem label="Size"><span className="list-row-value">Follows the image · {size.shown.width}×{size.shown.height}</span></ListItem>}
          <ListButton label="Advanced" value={advancedText} aria-label="Advanced Settings" aria-haspopup="dialog" aria-expanded={sheet === 'advanced'} onClick={() => setSheet('advanced')} />
        </div>
        <ReferenceSlots
          scope={`${mode}:${view.model}`}
          inputs={referenceInputs || []}
          referenceWith={view.referenceWith}
          openRequest={view.referenceOpenRequest}
          inpaint={referenceInpaint}
          role={referenceRole}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          confirmDelete={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: 'It’s removed from uploads.', action: 'Delete', destructive: true })}
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

      <WorkflowSheet view={view} open={sheet === 'workflow'} onClose={() => setSheet('')} />
      <SizeSheet view={view} open={sheet === 'size'} onClose={() => setSheet('')} />
      <Sheet open={sheet === 'advanced'} onClose={() => setSheet('')} title="Advanced Settings" full className="phone-advanced">
        {grokMediaControls}
        {phoneVideoDurationControls}
        {phoneAdvancedControls}
      </Sheet>
    </Sheet>
  );
}

function WorkflowSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  const { modelProfiles, model, pickModel, modelMenu } = view as { modelProfiles: Profile[]; model: string; pickModel: (id: string) => void; modelMenu?: ModelMenuState };
  const { profiles, menu, isFavourite, query, setQuery, filters, setFilters, sections, noMatchText } = useModelCatalogue(modelProfiles, model, modelMenu);
  React.useEffect(() => { if (!open) setQuery(''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const recipes = recipesFor(modelProfiles || [], model);
  const row = (profile: Profile) => (
    <div key={profile.id} className="phone-row-wrap">
      <button type="button" className={cn('phone-row phone-model-option', profile.id === model && 'is-current')} onClick={() => { pickModel(profile.id); onClose(); }}>
        {profile.id === model ? <Check size={18} className="model-selection-tick" aria-hidden="true" /> : null}
        <span>{modelName(profile).name}<small className={cn(setupNote(profile) && 'is-setup')}>{[modelDetails(profile), setupNote(profile)].filter(Boolean).join(' · ')}</small></span>
      </button>
      {menu ? (
        <button type="button" className={cn('phone-icon', isFavourite(profile.id) && 'is-on')} aria-pressed={isFavourite(profile.id)} aria-label={isFavourite(profile.id) ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => menu.toggleFavorite(profile.id)}>
          <Star size={18} fill={isFavourite(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Model" full className="phone-model-sheet">
      <div className="phone-model-tools">
        {recipes.length ? <label className="phone-row">Recipe<select aria-label="Recipe" value={model} onChange={(event) => pickModel(event.target.value)}>{recipes.map((profile) => <option key={profile.id} value={profile.id}>{profile.recipe!.label}</option>)}</select></label> : null}
        {profiles.length ? (
          <label className="phone-search picker-search">
            <Search size={17} aria-hidden="true" />
            <input className="is-framed" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Models" aria-label="Search Models" spellCheck={false} autoComplete="off" />
          </label>
        ) : null}
        {profiles.length ? <CatalogueFilters value={filters} onChange={setFilters} /> : null}
      </div>
      {!profiles.length ? (view.comfyStatus?.connected ? <EmptyState title="No Models Yet">Add a model to ComfyUI to see it here.</EmptyState> : <EmptyState title="ComfyUI Is Offline">Models show up when it’s back.</EmptyState>) : null}
      {sections.map((section) => <React.Fragment key={section.id}>{section.label ? <h3 className="phone-section">{section.label}</h3> : null}<div className="phone-group">{section.rows.map(row)}</div></React.Fragment>)}
      {profiles.length && !sections.length ? <EmptyState title="No Matching Models">{noMatchText}</EmptyState> : null}
    </Sheet>
  );
}

/**
 * The size menu as a sheet: the frame the picture will fill on a stage at the
 * top (it stays in view while the shapes scroll), Default · 2K · Custom,
 * Custom's linked width and height, the shapes, and the sizes you saved.
 *
 * There is no hover on a phone, so a finger resting on a row shows its frame
 * on the stage, and the saved sizes' Rename and Remove wait behind Edit
 * rather than hiding under a pointer. Picking keeps the sheet open, as the
 * desktop panel stays open; in Custom a shape keeps the area.
 */
/** A shape's outline fitted to the list's 24 × 18 lead, so every ratio reads true and the labels line up. */
const shapeIn = (w: number, h: number) => { const scale = Math.min(24 / (w || 1), 18 / (h || 1)); return { width: Math.max(6, Math.round(w * scale)), height: Math.max(6, Math.round(h * scale)) }; };

function SizeSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  const {
    aspectOptions, aspectPickerValue, aspectValue, defaultAspectSize, applyAspect, mode, currentProfile, customSize, sizeTier, sizeMax, customLimits,
    chooseSizeTier, applyCustomRatio, setCustomDimensions, savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize,
    sizeTiers, sizeArea, megapixelControl
  } = view;
  const saved = (savedSizes || []) as SavedSize[];
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const tiers: SizeTier[] = sizeTiers || (mode === 'image' ? ['none', '2k', 'custom'] : ['none', 'custom']);
  const model = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes: saved, targetArea: sizeArea || 0, offerTwoK: tiers.includes('2k') });
  const { custom, picked, shown, rows, savedMatch, ownSize, isActive, savedRow, captionFor, note } = model;

  // The row under a finger: shown on the stage after a beat, so a scroll that starts on a row doesn't flick the frame.
  const [pressed, setPressed] = React.useState<SizeRow | null>(null);
  const pressTimer = React.useRef(0);
  const press = (row: SizeRow | null) => {
    window.clearTimeout(pressTimer.current);
    if (row) pressTimer.current = window.setTimeout(() => setPressed(row), 90);
    else setPressed(null);
  };
  React.useEffect(() => () => window.clearTimeout(pressTimer.current), []);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!open) { press(null); setEditing(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!saved.length) setEditing(false); }, [saved.length]);

  const pressHandlers = (row: SizeRow) => ({
    onPointerDown: () => press(row),
    onPointerLeave: () => press(null),
    onPointerCancel: () => press(null)
  });
  const pick = (row: SizeRow) => {
    press(null);
    if (custom) { applyCustomRatio(presetRatio(row.shape)); return; }
    // The sheet stays open, so a resolution and a shape can be picked in one go.
    applyAspect(row.value);
  };
  const pickSaved = (item: SavedSize) => {
    press(null);
    pickSavedSize(item);
  };

  const resolutions = tiers.filter((item) => item !== 'custom');
  return (
    <Sheet open={open} onClose={onClose} title="Size" className="phone-size">
      {/* One flat list (UI-PATTERNS › Lists): the resolution, Custom Size as a row that opens its fields in place, then the shapes with a check on the one in use. */}
      <div className="list-group">
        {resolutions.length > 1 ? <ListItem label="Resolution"><SizeTabs tiers={resolutions} customButton={false} value={tier} onChange={(next) => { chooseSizeTier(next); }} /></ListItem> : null}
        {tiers.includes('custom') ? <ListButton className="phone-size-custom" label="Custom Size" value={custom ? `${picked.width}×${picked.height}` : ''} end="check" selected={custom} aria-pressed={custom} onClick={() => chooseSizeTier(custom ? 'none' : 'custom')} /> : null}
        <AnimatePresence initial={false}>
          {custom && customLimits ? (
            <motion.div key="custom" className="size-custom phone-size-fields" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <LinkedSizeFields size={picked} limits={customLimits} onChange={setCustomDimensions} onSave={ownSize || savedMatch ? () => { saveCustomSize(); } : undefined} saved={Boolean(savedMatch)} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {note ? <p className="list-note">{note}</p> : null}
      <ListSection title={custom ? 'Shape, at This Size' : 'Shape'}>
        <div className="list-group phone-size-list" role="listbox" aria-label={custom ? 'Shape, at This Size' : 'Shape'}>
          {rows.map((row) => (
            <ListButton key={row.key} role="option" aria-selected={isActive(row)} className="phone-size-row" end="check" selected={isActive(row)}
              lead={<span className="aspect-shape" style={shapeIn(row.shape.w, row.shape.h)} />}
              label={row.small || row.label} value={`${row.size.width}×${row.size.height}`}
              aria-label={`${row.small ? `${row.label}, ${row.small}` : row.label}, ${row.size.width} × ${row.size.height}`}
              onClick={() => pick(row)} />
          ))}
        </div>
      </ListSection>
      {/* Under the shapes, as on the desktop: how big they're all drawn. */}
      {megapixelControl ? <div className="phone-size-mp"><MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixelControl} custom={custom} /></div> : null}
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
                  pressHandlers={pressHandlers(savedRow(item))}
                  onPick={() => pickSaved(item)}
                  onRename={(name) => renameSavedSize(item.id, name)}
                  onRemove={() => { press(null); removeSavedSize(item.id); }}
                />
              ))}
            </AnimatePresence>
          </div>
        </>
      ) : null}
    </Sheet>
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
  return (
    <motion.div
      className="phone-size-saved"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
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

function GridAutoplayRow({ toggle }: { toggle: (label: string, description: string, checked: boolean, onChange: (next: boolean) => void) => React.ReactNode }) {
  const enabled = React.useSyncExternalStore(subscribeGridAutoplay, gridAutoplayEnabled);
  return <>{toggle('Play Grid Previews', 'Videos play silently in the gallery', enabled, () => toggleGridAutoplay())}</>;
}

function MoreSheet({ view, open, onClose, onSelect, statusText }: { view: Record<string, any>; open: boolean; onClose: () => void; onSelect?: () => void; statusText: string }) {
  const { prefs, setPrefs, retryComfyStatus, comfyRetrying } = view;
  const [signingOut, setSigningOut] = React.useState(false);
  const toggle = (label: string, description: string, checked: boolean, onChange: (next: boolean) => void) => (
    <label className="phone-row">
      <span>{label}<small>{description}</small></span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  );
  return (
    <Sheet open={open} onClose={onClose} title="More">
      {/* Account · Select · Library · Settings; the Studio mark top left is the status. Sign Out is first, in plain sight. */}
      {hasAccountStorageScope() ? <>
        <h3 className="phone-section">Account</h3>
        <div className="phone-group">
          <button type="button" className="phone-row" onClick={() => { onClose(); view.openSettings('account'); }}><UserRound size={20} /><span>Account<small>Your MCP token and session</small></span></button>
          <button type="button" className="phone-row is-danger" disabled={signingOut} onClick={() => { setSigningOut(true); signOutChecked(view.runningCount || 0, view.confirmAction).then((done) => { if (!done) setSigningOut(false); }).catch(() => { setSigningOut(false); view.showToast('Couldn’t sign out', 'error'); }); }}><LogOut size={20} /><span>{signingOut ? 'Signing Out…' : 'Sign Out'}</span></button>
        </div>
      </> : null}
      <h3 className="phone-section">Select</h3>
      <div className="phone-group">
        {onSelect ? <button type="button" className="phone-row" aria-label="Select Items" onClick={() => { onClose(); onSelect(); }}><CheckSquare size={20} /><span>Select Items<small>Download, animate, star or delete several</small></span></button> : null}
        {view.runningCount ? <button type="button" className="phone-row" onClick={() => { onClose(); view.cancelQueue(); }}><CircleStop size={20} /><span>Stop All Generations</span></button> : null}
        <button type="button" className="phone-row" onClick={retryComfyStatus}>
          <RefreshCw size={20} className={cn(comfyRetrying && 'spin')} /><span>{statusText}<small>Tap to check again</small></span>
        </button>
      </div>
      <h3 className="phone-section">Library</h3>
      <div className="phone-group phone-gallery-options">
        {/* Toggles as rows with a switch, like every other setting here. */}
        {toggle('Auto-Grouping', searchActive(view.gallerySearch || emptySearch) ? 'Paused while searching' : 'Groups the images of one run into a stack', Boolean(prefs.stackRuns), (next) => setPrefs({ stackRuns: next }))}
        {(view.visibleGallery || []).some((item: GalleryItem) => item.type === 'video') ? <GridAutoplayRow toggle={toggle} /> : null}
        {view.models?.features?.presets === true ? <button type="button" className="phone-row" aria-label="Image & Model Library" onClick={() => { onClose(); view.setPresetLibraryOpen(true); }}><Library size={20} /><span>Image & Model Library</span></button> : null}
      </div>
      <h3 className="phone-section">Settings</h3>
      <div className="phone-group">
        {toggle(preferenceLabels.smartUpscale, 'Shows an upscale arrow on finished images', prefs.smartUpscale, (next) => setPrefs({ smartUpscale: next }))}
        {toggle(preferenceLabels.showFailedItems, 'Keeps them in the gallery so you can see why', prefs.showFailedItems, (next) => setPrefs({ showFailedItems: next }))}
        {toggle(preferenceLabels.confirmActions, 'Also asks before stopping generations', prefs.confirmActions, (next) => setPrefs({ confirmActions: next }))}
        <button type="button" className="phone-row" onClick={() => { onClose(); setPrefs({ fullStudioOnPhone: true }); }}>
          <SlidersHorizontal size={20} /><span>Use the Full Studio<small>All controls, laid out for a larger screen</small></span>
        </button>
        <button type="button" className="phone-row" onClick={() => { onClose(); view.openSettings('studio'); }}><Settings size={20} /><span>All Settings</span></button>
      </div>
      <p className="phone-note">Models, folders and downloads are managed on the computer running Studio.</p>
    </Sheet>
  );
}
