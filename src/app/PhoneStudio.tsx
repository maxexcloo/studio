import { PromptField } from './PromptField';
import { CatalogueFilters, emptyCatalogueFilter } from './CatalogueFilters';
import { ComposerModeSelect } from './ComposerModeSelect';
import React from 'react';
import { modelRecipeOptions, recipeModelMenu, recipesFor } from './modelRecipes';
import { compareModelNames, modelGroups, modelName, profileMatchesFilters } from './catalogueNames';
import { GridAutoplayButton } from './GridAutoplayButton';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUp, Check, CheckSquare, ChevronRight, CircleStop, Dices, Image as ImageIcon, Layers, Library, LockKeyhole, LogOut, MoreHorizontal, Plus, RefreshCw, ListRestart, Search, Settings, SlidersHorizontal, Star, Trash2, UserRound, X } from 'lucide-react';
import { cn, aspectIconStyle } from './format';
import { familyLabel, modelDetails, NumberPicker, setupNote } from './components';
import { Sheet } from './Sheet';
import { ItemActionSheet } from './ItemActionSurfaces';
import { bulkItemActions, useItemActionHandlers } from './itemActions';
import type { GallerySelection } from './gallerySelection';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { haptic, HapticTarget } from './phoneControls';
import { Media } from './components';
import { progressReading } from './GenerationProgress';
import { RestartEtaText } from './ComfyRestart';
import { estimatePhrase } from './useGenerationEstimate';
import type { GalleryItem, Profile, SavedSize } from './types';
import { LinkedSizeFields, MegapixelField, SizePreview, SizeTabs, sizeMenuModel, type SizeRow, type SizeTier } from './SizeMenu';
import { MEGAPIXEL, presetRatio, ratioName } from './sizing';
import { PromptHistorySheet } from './PromptHistory';
import { PhoneSearchBar } from './GallerySearch';
import { StackRunsButton } from './StackRunsButton';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { usePromptHistory } from './recentPrompts';
import { signOutAccount } from './accounts';
import { hasAccountStorageScope } from './api';

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

export function PhoneShell({ view, galleryBody, canUseNegativePrompt, comfyOffline, hiddenLocked, toggleHiddenSpace, createOpen, setCreateOpen, actionsFor, setActionsFor, selection }: {
  view: Record<string, any>;
  galleryBody: React.ReactNode;
  canUseNegativePrompt: boolean;
  comfyOffline: boolean;
  hiddenLocked: boolean;
  toggleHiddenSpace: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  actionsFor: GalleryItem | null;
  setActionsFor: (item: GalleryItem | null) => void;
  selection: GallerySelection;
}) {
  const {
    prompt, hiddenSpace, runningCount, comfyStatus, retryComfyStatus, mode, changeMode,
    galleryStageRef, onGalleryScroll, generate, generateDisabled, visibleGallery, openItem, active, showToast
  } = view;
  const gallery = (visibleGallery || []) as GalleryItem[];
  const { selecting, selectedItems, selectable } = selection;
  const handlers = useItemActionHandlers();
  const bulkActions = handlers ? bulkItemActions(selectedItems, handlers, Boolean(hiddenSpace)) : [];
  const reducedMotion = useReducedMotion();
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
    ? generatingCount === 1 ? 'Generating 1 image' : `Generating ${generatingCount}`
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
    haptic('success');
    if (!createOpen && !active) showToast(landed.type === 'video' ? 'Video Ready' : 'Image Ready', 'success', {
      duration: 5500,
      group: 'phone-generation-ready',
      action: { label: 'View', onClick: () => openItem(landed) }
    });
  }, [gallery]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moreOpen, setMoreOpen] = React.useState(false);
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  const searchTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const filterTriggerRef = React.useRef<HTMLButtonElement>(null);
  const searchOpen = Boolean(view.phoneSearchOpen);
  const activeFilters = Boolean(hiddenSpace || gallerySearch.favorites || gallerySearch.model || gallerySearch.workflow || gallerySearch.lora);
  // Search and filters toggle independently; what is active stays applied while closed (the dot says so).
  const searchExpanded = searchOpen;
  const filtersExpanded = filtersOpen;
  const setSearchOpen = view.setPhoneSearchOpen as (open: boolean) => void;
  const restarting = Boolean(comfyStatus?.restarting);
  const connected = Boolean(comfyStatus?.connected);
  const connectionName = comfyStatus?.label || 'ComfyUI';
  const statusText = restarting ? `${connectionName} is restarting` : comfyStatus?.busy ? `${connectionName} is busy` : connected ? `${connectionName} connected${comfyStatus?.device ? ` · ${comfyStatus.device}` : ''}` : comfyStatus?.checked ? `${connectionName} is offline` : `Checking ${connectionName}…`;
  const quickGo = Boolean(prompt.trim()) && !generateDisabled && !comfyOffline && !restarting;

  return (
    <>
      {selecting ? (
        <header className="phone-bar is-selecting">
          <button type="button" className="phone-icon" aria-label="Stop Selecting" onClick={selection.end}><X size={22} /></button>
          <div className="phone-title"><span>{selectedItems.length ? `${selectedItems.length} selected` : 'Select Items'}</span></div>
          <button type="button" className="phone-pill" aria-label={selection.allSelected ? "Deselect All" : "Select All Loaded"} onClick={() => { haptic('tap'); selection.toggleAll(); }}>
            {selection.allSelected ? 'None' : 'All'}
            <HapticTarget />
          </button>
        </header>
      ) : null}
      <header className={cn('phone-bar', selecting && 'is-behind')}>
        <button type="button" className={cn('phone-status', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')} aria-label={`${statusText}. Check Again`} onClick={retryComfyStatus}>
          <span />
        </button>
        <div className="phone-title">
          {hiddenSpace ? <button type="button" className="phone-icon" aria-label="Back to the Gallery" onClick={toggleHiddenSpace}><ArrowLeft size={20} /></button> : null}
          <button type="button" className="phone-scroll-top" aria-label="Scroll To Top" onClick={scrollToTop}>
            {hiddenSpace ? <LockKeyhole size={16} className="phone-ember" /> : null}
            <span>{hiddenSpace ? 'Hidden' : 'Gallery'}</span>
          </button>
          {runningCount ? <button type="button" className="phone-running-inline" aria-label={`${runningLabel}. Show It`} title={runningLabel} onClick={revealRunning}>
            <RefreshCw size={13} className="spin" aria-hidden="true" /><span>{runningCount}</span>
          </button> : null}
        </div>
        {!hiddenLocked ? <button type="button" className={cn('phone-icon', Boolean(gallerySearch.q.trim()) && 'has-dot')} ref={searchTriggerRef} aria-label="Search Gallery" aria-expanded={searchExpanded} onClick={() => setSearchOpen(!searchExpanded)}><Search size={20} /></button> : null}
        <button type="button" className={cn('phone-icon', activeFilters && 'has-dot')} ref={filterTriggerRef} aria-label="Open Gallery Filters" title="Filters" aria-expanded={filtersExpanded} onClick={() => setFiltersOpen(!filtersExpanded)}><SlidersHorizontal size={20} /></button>
        <button type="button" className="phone-icon" aria-label="More" onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} /></button>
        <div className="phone-gallery-mode-row">
          <div className="phone-mode-select phone-gallery-mode" role="group" aria-label="Gallery Mode">
            {(['image', 'video'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { haptic('tap'); changeMode(value); }}>{value === 'image' ? 'Images' : 'Videos'}</button>)}
          </div>
        </div>
      </header>
      {<PhoneSearchBar search={gallerySearch} setSearch={setGallerySearch} open={searchExpanded} setOpen={setSearchOpen} hiddenSpace={Boolean(hiddenSpace)} onToggleHidden={toggleHiddenSpace} filterTriggerRef={filterTriggerRef} searchTriggerRef={searchTriggerRef} filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen} items={gallery} />}

      <main ref={galleryStageRef} className="phone-gallery" onScroll={onGalleryScroll} onWheel={view.onGalleryUserScroll} onTouchStart={view.onGalleryUserScroll}>
        {galleryBody}
      </main>

      {selecting ? (
        <nav className="phone-select-bar" aria-label="Selected Items">
          {bulkActions.map((action) => (
            <button key={action.id} type="button" className={cn(action.danger && 'is-danger')} aria-label={action.short ? action.label : undefined} disabled={action.disabled} onClick={() => { if (action.haptic) haptic(action.haptic); action.run(); }}>
              <action.Icon size={21} /><span>{action.short || action.label}</span>{action.haptic ? <HapticTarget /> : null}
            </button>
          ))}
        </nav>
      ) : null}

      {!hiddenLocked && !selecting ? (
        <div className={cn('phone-create-pill', hiddenSpace && 'is-hidden')}>
          <button type="button" className="phone-create-open" onClick={() => setCreateOpen(true)}>
            <strong className={cn(!prompt.trim() && 'is-placeholder')}>{prompt.trim() || 'Prompt...'}</strong>
          </button>
          <button
            type="button"
            className={cn('phone-go', pending.length > 0 && 'is-working')}
            style={{ '--progress': progress } as React.CSSProperties}
            aria-label={quickGo ? 'Generate' : 'Open the composer'}
            onClick={() => { haptic('tap'); if (quickGo) generate(); else setCreateOpen(true); }}
          >
            {restarting ? <RefreshCw size={20} className="spin" /> : <ArrowUp size={22} strokeWidth={2.4} />}
            <HapticTarget />
          </button>
        </div>
      ) : null}

      <CreateSheet view={view} open={createOpen} onClose={() => setCreateOpen(false)} canUseNegativePrompt={canUseNegativePrompt} comfyOffline={comfyOffline} />
      <MoreSheet view={view} open={moreOpen} onClose={() => setMoreOpen(false)} statusText={statusText} onSelect={!hiddenLocked && selectable.length ? () => selection.start() : undefined} />
      <ItemActionSheet item={actionsFor} onClose={() => setActionsFor(null)} onSelect={(item) => { haptic('press'); selection.start([item.id]); }} />
    </>
  );
}

/* ------------------------------------------------------------ Create */

/**
 * A slider range worth having. A workflow's own limit is usually ComfyUI's
 * technical maximum (10000), which makes the slider useless; the range here
 * is built around the workflow's default instead: a turbo model at 4 steps
 * gets 1-24, one at 20 gets 1-60. It still reaches whatever is set now, and
 * never goes past the workflow's real limit.
 */
function practicalStepRange(profile: Profile | null | undefined, meta: { min?: number; max?: number; default?: number } | undefined, current: number) {
  const hardMin = Math.max(1, Number(meta?.min || 1));
  const hardMax = Math.max(hardMin, Number(meta?.max || 10000));
  const recommended = Number(profile?.defaults?.steps || meta?.default || 0);
  const base = recommended || 20;
  const practical = Math.min(100, Math.max(12, base * 3, base + 20));
  const max = Math.min(hardMax, Math.max(practical, Number(current) || 0));
  return { min: hardMin, max, recommended: recommended && recommended >= hardMin && recommended <= hardMax ? recommended : 0 };
}

function CreateSheet({ view, open, onClose, canUseNegativePrompt, comfyOffline }: { view: Record<string, any>; open: boolean; onClose: () => void; canUseNegativePrompt: boolean; comfyOffline: boolean }) {
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile, hiddenSpace,
    aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceInpaint, referenceRole, referenceAssets, selectReferenceAsset, removeReferenceAsset, confirmAction, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, setSeed, grokMediaControls, phoneVideoDurationControls, phoneAdvancedControls, generationEstimate,
    customSize, sizeTier, sizeMax, customLimits, savedSizes, sizeArea, sizeTiers
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
  const { min: stepMin, max: stepMax, recommended: stepDefault } = practicalStepRange(currentProfile, stepsMeta, steps);
  // The size row reads like the desktop's size button: the shape, its name, the size it makes.
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const size = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes, targetArea: sizeArea || 0, offerTwoK: Boolean(sizeTiers?.includes('2k')) });
  // A long run says so before it starts; a quick one needs no warning.
  const estimate = generationEstimate?.ms && generationEstimate.ms >= 45_000 ? `Takes ${estimatePhrase(generationEstimate)}.` : '';
  const reason = restarting ? <>ComfyUI is restarting. <RestartEtaText fallback="Back in a few seconds." /></> : comfyOffline ? 'ComfyUI is offline.' : !prompt.trim() ? '' : generateDisabled ? generateDisabledReason : estimate;

  const go = () => {
    haptic('tap');
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
      title={hiddenSpace ? <span className="phone-title-inline"><LockKeyhole size={16} className="phone-ember" /> Create in Hidden</span> : 'Create'}
      footer={
        <>
          {reason ? <p className="phone-reason">{reason}</p> : null}
          <div className="phone-creation-resources">
            <div className="phone-creation-resource-left"><div className="composer-reference-tools" /><button type="button" className="composer-resource-add" data-open-trigger aria-label="LoRAs" aria-haspopup="dialog" aria-expanded={Boolean(view.lorasOpen)} onClick={() => view.openLoras()}>{view.loraSummary ? <><Layers size={16} /><span className="lora-pill-summary">{view.loraSummary}</span></> : <><Plus size={16} /><span>LoRAs</span></>}</button></div>
            <button type="button" className="phone-model-browse" aria-label="Browse Models" aria-haspopup="dialog" aria-expanded={sheet === 'workflow'} onClick={() => setSheet('workflow')}><SlidersHorizontal size={16} /><span>{currentProfile?.recipe?.modelLabel || currentProfile?.displayName || currentProfile?.label || 'Model'}</span></button>
          </div>
          <div className="phone-creation-toolbar phone-creation-submit-row">
            <ComposerModeSelect mode={mode} onChange={view.changeMode} />
            {!aspectLocked ? <button type="button" aria-label="Aspect Ratio" aria-haspopup="dialog" aria-expanded={sheet === 'size'} onClick={() => setSheet('size')}><span className="aspect-shape phone-aspect" style={aspectIconStyle({ label: "", value: "", w: size.shown.width, h: size.shown.height })} /></button> : null}
            {variations && maxCount > 1 ? <NumberPicker className="composer-count-picker" label={mode === 'video' ? 'Videos' : 'Images'} value={count} min={countMeta.min || 1} max={maxCount} step={countMeta.step || 1} onChange={setCount} size="sm" density="compact" /> : null}
            <button type="button" aria-label="Advanced Settings" aria-haspopup="dialog" aria-expanded={sheet === 'advanced'} onClick={() => setSheet('advanced')}><MoreHorizontal size={18} /></button>
            <button type="button" className="phone-creation-reset" aria-label="Reset Creation" title="Reset Creation" onClick={view.resetCreation}><ListRestart size={18} /></button>
            <div className="composer-submit-actions">
              <button type="button" className={cn('phone-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')} aria-label={comfyOffline ? 'Check Again' : 'Generate'} aria-disabled={restarting || (!comfyOffline && (!prompt.trim() || generateDisabled)) || undefined} onClick={go}>
                {restarting || comfyOffline ? <RefreshCw size={20} className={cn((restarting || comfyRetrying) && 'spin')} /> : <ArrowUp size={20} strokeWidth={2.4} />}<HapticTarget />
              </button>
            </div>
          </div>
        </>
      }
    >
      <div className="phone-compose">
        <ReferenceSlots
          scope={`${mode}:${view.model}:${hiddenSpace}`}
          inputs={referenceInputs || []}
          inpaint={referenceInpaint}
          role={referenceRole}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          confirmDelete={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: 'It’s removed from uploads.', action: 'Delete', destructive: true })}
          onError={(message) => showToast(message, 'error')}
        />
        {/* Edit or Reference, in plain sight: on a phone there's no hover to open the chip's menu, and no tooltip to say what each does. */}
        <AnimatePresence initial={false}>
          {referenceRole ? (
            <motion.div key="role" className="phone-ref-role" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <div className={cn('ref-menu-role', referenceRole.value === 'reference' && 'is-ref', referenceRole.locked && 'is-locked')} role="radiogroup" aria-label="What this image is">
                <i aria-hidden="true" />
                {(['edit', 'reference'] as const).map((value) => (
                  // A painted mask settles it as Edit: Reference stays, unavailable, and the line says why.
                  <button key={value} type="button" role="radio" aria-checked={referenceRole.value === value} aria-disabled={(referenceRole.locked && value === 'reference') || undefined} className={cn(referenceRole.value === value && 'is-active')} onClick={() => { if (referenceRole.locked && value === 'reference') { haptic('warning'); return; } haptic('tap'); referenceRole.onChange(value); }}>
                    {value === 'edit' ? 'Edit' : 'Reference'}<HapticTarget />
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
        <PromptField kind="positive" value={prompt} ariaLabel={hiddenSpace ? 'Prompt (Hidden)' : 'Prompt'} onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt('')} historyAvailable={Boolean(recentPrompts.length)} historyOpen={historyOpen && historyKind === 'positive'} onHistory={() => { setHistoryKind('positive'); setHistoryOpen(true); }} />
        {currentProfile?.capabilities?.negativePrompt !== false ? <PromptField kind="negative" value={negative} onChange={(value) => setNegative(clampText(value, negativeLimit))} onClear={() => setNegative('')} historyAvailable={Boolean(recentNegatives.length)} historyOpen={historyOpen && historyKind === 'negative'} onHistory={() => { setHistoryKind('negative'); setHistoryOpen(true); }} /> : null}
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
        {currentProfile?.family !== 'grok' ? <div className="phone-control"><NumberPicker label="Steps" value={steps} min={stepMin} max={stepMax} step={1} onChange={setSteps} size="sm" /></div> : null}
      {String(seed || '').trim() ? (
        <button type="button" className="phone-row phone-seed" onClick={() => setSeed('')}>
          <Dices size={20} /><span>Seed {String(seed).trim()} is fixed<small>Tap for a random seed</small></span>
        </button>
      ) : null}

      {grokMediaControls}
      {phoneVideoDurationControls}
        {phoneAdvancedControls}
      </Sheet>
    </Sheet>
  );
}

function WorkflowSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  const { modelProfiles, model, pickModel, modelMenu } = view as { modelProfiles: Profile[]; model: string; pickModel: (id: string) => void; modelMenu?: { favorites: string[]; recents: string[]; toggleFavorite: (id: string) => void } };
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState(emptyCatalogueFilter);
  React.useEffect(() => { if (!open) setQuery(''); }, [open]);
  const profiles = React.useMemo(() => modelRecipeOptions(modelProfiles || [], model).sort(compareModelNames), [modelProfiles, model]);
  const menu = recipeModelMenu(modelMenu, modelProfiles || [], model);
  const favorites = new Set(menu?.favorites || []);
  const needle = query.trim().toLowerCase();
  const matches = (profile: Profile) => profileMatchesFilters(profile, filters, menu?.favorites) && (!needle || `${profile.displayName || ''} ${profile.label || ''} ${familyLabel(profile)} ${profile.model || ''}`.toLowerCase().includes(needle));
  const starred = profiles.filter((profile) => favorites.has(profile.id) && matches(profile));
  const rest = profiles.filter(matches);
  const row = (profile: Profile) => (
    <div key={profile.id} className="phone-row-wrap">
      <button type="button" className={cn('phone-row phone-model-option', profile.id === model && 'is-current')} onClick={() => { pickModel(profile.id); onClose(); }}>
        {profile.id === model ? <Check size={18} className="model-selection-tick" aria-hidden="true" /> : null}
        <span>{modelName(profile).name}<small className={cn(setupNote(profile) && 'is-setup')}>{[modelDetails(profile), setupNote(profile)].filter(Boolean).join(' · ')}</small></span>

      </button>
      {modelMenu ? (
        <button type="button" className={cn('phone-icon', favorites.has(profile.id) && 'is-on')} aria-pressed={favorites.has(profile.id)} aria-label={favorites.has(profile.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => menu?.toggleFavorite(profile.id)}>
          <Star size={18} fill={favorites.has(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Model" full className="phone-model-sheet">
      <div className="phone-model-tools">
        {recipesFor(modelProfiles || [], model).length ? <label className="phone-row">Recipe<select aria-label="Recipe" value={model} onChange={(event) => pickModel(event.target.value)}>{recipesFor(modelProfiles || [], model).map((profile) => <option key={profile.id} value={profile.id}>{profile.recipe!.label}</option>)}</select></label> : null}
        {profiles.length ? (
          <label className="phone-search picker-search">
            <Search size={17} aria-hidden="true" />
            <input className="is-framed" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Models" aria-label="Search Models" spellCheck={false} autoComplete="off" />
          </label>
        ) : null}
        {profiles.length ? <CatalogueFilters value={filters} onChange={setFilters} /> : null}
      </div>
      {!profiles.length ? <p className="phone-empty">{(view.comfyStatus?.connected) ? 'No models yet. Add a model to ComfyUI to see it here.' : 'ComfyUI is offline. Models show up when it’s back.'}</p> : null}
      {starred.length ? <><h3 className="phone-section">Favourites</h3><div className="phone-group">{starred.map(row)}</div></> : null}
      {modelGroups(rest).map((group) => <React.Fragment key={group.id}><h3 className="phone-section">{group.label}</h3><div className="phone-group">{group.rows.map(row)}</div></React.Fragment>)}
      {!starred.length && !rest.length ? <p className="phone-empty">{needle ? `Nothing matches “${query.trim()}”.` : 'No Models Match These Filters.'}</p> : null}
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
 * rather than hiding under a pointer. Picking from Default or 2K closes the
 * sheet, as the desktop menu closes; in Custom a shape keeps the area.
 */
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
    haptic('tap');
    if (custom) { applyCustomRatio(presetRatio(row.shape)); return; }
    applyAspect(row.value);
    onClose();
  };
  const pickSaved = (item: SavedSize) => {
    press(null);
    haptic('tap');
    pickSavedSize(item);
    if (!custom) onClose();
  };

  const stage = pressed ? pressed.size : shown;
  return (
    <Sheet open={open} onClose={onClose} title="Size" className="phone-size">
      <div className="phone-size-stage">
        <SizePreview className="is-stage" size={stage} label={captionFor(pressed)} sub={`${stage.width} × ${stage.height}`} accent={!pressed && (tier !== 'none' || sizeArea > 0)} inset={18} />
      </div>
      <div className="phone-size-top">
        <SizeTabs tiers={tiers} value={tier} onChange={(next) => { haptic('tap'); chooseSizeTier(next); }} />
        <AnimatePresence initial={false}>
          {custom && customLimits ? (
            <motion.div key="custom" className="size-custom" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <LinkedSizeFields size={picked} limits={customLimits} onChange={setCustomDimensions} onSave={ownSize || savedMatch ? () => { haptic('success'); saveCustomSize(); } : undefined} saved={Boolean(savedMatch)} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {note ? <p className="phone-control-note">{note}</p> : null}
      </div>
      <div className="phone-group phone-size-list" role="listbox" aria-label={custom ? 'Shape, at this size' : 'Shape'}>
        {rows.map((row) => (
          <button key={row.key} type="button" role="option" aria-selected={isActive(row)} className={cn('phone-row phone-size-row', isActive(row) && 'is-current')} {...pressHandlers(row)} onClick={() => pick(row)}>
            <span className="phone-size-shape"><span className="aspect-shape" style={aspectIconStyle(row.shape)} /></span>
            <span>{row.label}{row.small ? <small>{row.small}</small> : null}</span>
            <em>{row.size.width}×{row.size.height}</em>
          </button>
        ))}
      </div>
      {/* Under the shapes, as on the desktop: how big they're all drawn. */}
      {megapixelControl ? <div className="phone-size-mp"><MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixelControl} custom={custom} /></div> : null}
      {saved.length ? (
        <>
          <div className="phone-size-saved-head">
            <h3 className="phone-section">Saved</h3>
            <button type="button" className={cn('phone-size-edit', editing && 'is-on')} aria-pressed={editing} onClick={() => { haptic('tap'); setEditing((value) => !value); }}>{editing ? 'Done' : 'Edit'}<HapticTarget /></button>
          </div>
          <div className={cn('phone-group phone-size-list', editing && 'is-editing')} role="listbox" aria-label="Saved sizes">
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
                  onRemove={() => { haptic('warning'); press(null); removeSavedSize(item.id); }}
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

function MoreSheet({ view, open, onClose, onSelect, statusText }: { view: Record<string, any>; open: boolean; onClose: () => void; onSelect?: () => void; statusText: string }) {
  const { prefs, setPrefs, hidden, retryComfyStatus, comfyRetrying } = view;
  const [signingOut, setSigningOut] = React.useState(false);
  const toggle = (label: string, description: string, checked: boolean, onChange: (next: boolean) => void) => (
    <button type="button" role="switch" aria-checked={checked} className="phone-row" onClick={() => onChange(!checked)}>
      <span>{label}<small>{description}</small></span>
      <span className={cn('phone-switch', checked && 'is-on')} aria-hidden="true"><i /></span>
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title="More">
      {onSelect ? <div className="phone-group"><button type="button" className="phone-row" aria-label="Select Items" onClick={() => { onClose(); onSelect(); }}><CheckSquare size={20} /><span>Select Items<small>Save, star, move or delete several items</small></span></button></div> : null}
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={retryComfyStatus}>
          <RefreshCw size={20} className={cn(comfyRetrying && 'spin')} /><span>{statusText}<small>Tap to check again</small></span>
        </button>
      </div>
      <h3 className="phone-section">Hidden</h3>
      <div className="phone-group">
        {!hidden.enabled
          ? <p className="phone-note">Set up Hidden on the computer running Studio, in Settings › Hidden. Then unlock it here with its password.</p>
          : hidden.unlocked
            ? <button type="button" className="phone-row" onClick={() => { hidden.lock(); onClose(); }}><LockKeyhole size={20} /><span>Lock Hidden<small>Also locks when idle</small></span></button>
            : <button type="button" className="phone-row" onClick={() => { onClose(); hidden.requestUnlock(null); }}><LockKeyhole size={20} /><span>Unlock Hidden</span></button>}
      </div>
      <h3 className="phone-section">Gallery</h3>
      <div className="phone-group phone-gallery-options">
        <StackRunsButton labelled on={Boolean(prefs.stackRuns)} disabled={searchActive(view.gallerySearch || emptySearch)} onToggle={() => { haptic('tap'); setPrefs({ stackRuns: !prefs.stackRuns }); }} />
        {(view.visibleGallery || []).some((item: GalleryItem) => item.type === 'video') ? <GridAutoplayButton labelled /> : null}
        {view.models?.features?.presets === true ? <button type="button" className="phone-row" aria-label="Image & Model Library" onClick={() => { onClose(); view.setPresetLibraryOpen(true); }}><Library size={20} /><span>Image & Model Library</span></button> : null}
        {view.runningCount ? <button type="button" className="phone-row" onClick={() => { onClose(); view.cancelQueue(); }}><CircleStop size={20} /><span>Stop All Generations</span></button> : null}
      </div>
      <h3 className="phone-section">Studio</h3>
      <div className="phone-group">
        {toggle('Smart upscale', 'Shows an upscale arrow on finished images', prefs.smartUpscale !== false, (next) => setPrefs({ smartUpscale: next }))}
        {toggle('Show failed generations', 'Keeps them in the gallery so you can see why', prefs.showFailedItems !== false, (next) => setPrefs({ showFailedItems: next }))}
        {toggle('Ask before deleting', 'Also asks before stopping generations', prefs.confirmActions !== false, (next) => setPrefs({ confirmActions: next }))}
      </div>
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => { onClose(); setPrefs({ fullStudioOnPhone: true }); }}>
          <SlidersHorizontal size={20} /><span>Use the full studio<small>All controls, laid out for a larger screen</small></span>
        </button>
      </div>
      {hasAccountStorageScope() ? <>
        <h3 className="phone-section">Account</h3>
        <div className="phone-group">
          <button type="button" className="phone-row" onClick={() => { onClose(); view.openSettings('accounts'); }}><UserRound size={20} /><span>Accounts & MCP<small>Your MCP token and session</small></span></button>
          <button type="button" className="phone-row" onClick={() => { onClose(); view.openSettings('general'); }}><Settings size={20} /><span>Settings</span></button>
          <button type="button" className="phone-row is-danger" disabled={signingOut} onClick={() => { setSigningOut(true); signOutAccount().catch(() => { setSigningOut(false); view.showToast('Could not sign out.', 'error'); }); }}><LogOut size={20} /><span>{signingOut ? 'Signing Out…' : 'Sign Out'}</span></button>
        </div>
      </> : null}
      <p className="phone-note">Models, folders, downloads and updates are managed on the computer running Studio.</p>
    </Sheet>
  );
}
