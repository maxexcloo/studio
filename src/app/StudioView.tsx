import { ViewerZoomControls } from './ViewerZoomControls';
import { scrollBehavior } from "@/lib/springs";
import { popoverMotion } from "./composerSurface";
import { GalleryManagement } from './GalleryManagement';
import { AnimatePhotos, animationProfiles } from './AnimatePhotos';
import { PromptField } from './PromptField';
import { AdvancedPopover, LoraPopover } from './LoraPopover';
import React from 'react';
import { preloadable } from './preloadable';
import { useNeighborPrefetch } from './useNeighborPrefetch';
import { GalleryViewControls } from './GalleryViewControls';
import { CircleStop, ChevronLeft, ChevronRight, Info, Library, Settings, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, nearTextLimit, sortDetailRows, type GenerationDetailSection } from './format';
import { GallerySkeleton, Tip } from './components';
import { useWheelRef } from './wheel';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { GenerationProfiles, GenerationProgress } from './GenerationProgress';
import { ComposerBar } from './ComposerBar';
import { ExpandingComposer } from './ExpandingComposer';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { RunSheet } from './RunSheet';
import { type Run } from './runs';
import { UpscaleCompare } from './UpscaleCompare';
import { upscaledWithRun } from './useUpscale';
import { UpscaleSetupDialog } from './UpscaleDialogs';
import { ModelFoldersDialog } from './ModelFoldersDialog';
import { useUpscaleDownloadActivity } from './UpscaleDownloadActivity';
import { FailurePanel } from './GenerationFailure';
import { useModelDownloadActivity } from './ModelDownloadActivity';
import { useGenerationActivity, useTilesOnScreen } from './GenerationActivity';
import { ActivityColumn } from './Activities';
import { useCopyFeedback } from './CopyFeedback';
import { DetailsFooter, PromptReadout, generationInputsText } from './ViewerActions';
import { itemProfile, itemProfileName } from './itemProfile';
import { LoraDetails, LoraSources } from './LoraPanel';
import { loraName, modelName } from './catalogueNames';
import { fetchLoraInfo, knownLoraInfo } from './useLoraInfo';
import { partName } from './partNames';

import { TileLongPressContext } from './GalleryTile';
import { PhoneShell } from './PhoneStudio';
import { MediaModeToggle } from './ComposerModeSelect';
import { coverMedia } from './mediaCover';
import { PhoneViewerBar, ViewerDockActions } from './ItemActionSurfaces';
import { ItemActionsContext, type ItemActionHandlers } from './itemActions';
import { GallerySelectionContext, useGallerySelection } from './gallerySelection';
import { usePhone, useThisComputer } from './device';
import { ConnectedCard } from './ConnectedCard';
import { StatusAnnouncer, SurfaceStatus } from './StatusMessage';
import { EmptyStage } from './EmptyStage';
import type { SettingsSection } from './SettingsDialog';
import { Modal } from './Modal';
import { AccountMenu } from './AccountMenu';
import { hasAccountStorageScope } from './api';
import { GetModelsSheet, StarterModels } from './StarterModels';
import { FamilySetupDialog, useFamilySetupRequests } from './FamilySetupDialog';
import { NoComfySheet } from './NoComfySheet';
import { ShortcutsSheet } from './shortcuts';
import { useHistoryDismiss } from './useHistoryDismiss';
import { useFocusTrap } from './useFocusTrap';
import { PromptHistoryPopover } from './PromptHistory';
import { GallerySearchBar, SearchEmpty, useGallerySearchKeys } from './GallerySearch';
import { canStar, emptySearch, FavoriteContext, searchActive, type GallerySearch } from './favorites';
import { refreshPrompts, usePromptHistory } from './recentPrompts';
import type { GalleryItem } from './types';
import { memoLatest } from '@/lib/memo-latest';

// App rebuilds every prop on each render (a keystroke in the prompt, a poll);
// these skip re-rendering unless their data actually changed.
const StableGallery = memoLatest(VirtualMasonryGallery);
const StableComposerBar = memoLatest(ComposerBar);

function comfyStatusLabel(status: any) {
  const name = status?.label || "ComfyUI";
  // No worker can run what's selected (or none is set up): say that, not "offline".
  if (status?.noWorkers) return status.error || "No workers set up";
  if (status?.restarting) return `${name} is restarting…`;
  if (status?.checking) return `Checking ${name}…`;
  if (status?.busy) return `${name} is busy${status.device ? ` · ${status.device}` : ""} · slow to answer, runs carry on`;
  if (status?.connected) {
    const detail = [status.device, status.latencyMs ? `${status.latencyMs}ms` : "", status.version ? `v${status.version}` : ""].filter(Boolean).join(" · ");
    return `${name} connected${detail ? ` · ${detail}` : ""}`;
  }
  return `${name} offline${status?.url ? ` · ${status.url}` : ""}${status?.error ? ` · ${status.error}` : ""}`;
}

const loadSettings = () => import('./SettingsDialog');
const SettingsDialog = React.lazy(() => loadSettings().then((module) => ({ default: module.SettingsDialog })));
const { Component: PresetLibrary, preload: loadPresetLibrary } = preloadable(() => import('./PresetLibrary').then((module) => module.PresetLibrary));
const loadWorkflows = () => import('./WorkflowGallery');
const WorkflowGallery = React.lazy(() => loadWorkflows().then((module) => ({ default: module.WorkflowGallery })));
// One empty list until models load, so the tiles' profile context holds steady.
const noProfiles: never[] = [];

function ComfyConnectionDot({ status, retrying, onClick }: { status: any; retrying: boolean; onClick: () => void }) {
  const state = status?.restarting ? "restarting" : status?.checking || retrying ? "checking" : status?.connected ? "connected" : "disconnected";
  return (
    <Tip content={comfyStatusLabel(status)}>
      <button className={`comfy-status-dot is-${state}`} aria-label={comfyStatusLabel(status)} onClick={onClick}>
        <span />
      </button>
    </Tip>
  );
}

export function StudioView({ view }: { view: Record<string, any> }) {
  const { active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, clickViewer, comfyStatus, galleryGroups, stackRuns, openRuns, setRunOpen, unstackRun, copyToClipboard, count, countMeta, currentProfile, customSize, formatElapsed, galleryColumnCount, galleryLoaded, galleryCrossing, galleryStageRef, generate, generateDisabled, generateDisabledReason, generationDetailEntries, hasMoreGallery, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, loraSummary, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, negative, negativeLimit, onGalleryScroll, openItem, prefs, profileBadges, prompt, promptLimit, refreshComfyStatus, removeReferenceAsset, renderedGallery, resetViewer, runningCount, selectReferenceAsset, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, showDetails, settings, showNegativePrompt, showToast, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitPrompt, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, promptRef, dragViewer, endViewerTouch, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, upscaleBusyIds, activateUpscale, cancelUpscale, upscaleDisplayUrl, upscaleSetup, upscaleStatus, upscaleInstall, upscaleUnavailableReason, health, setPrefs, refreshModels, refreshWorkflows, modelFolders } = view;
  // Smart upscale works on images, and only while it is on in Settings.
  const strayModelCount = modelFolders?.strayCount || 0;
  const canUseNegativePrompt = true;
  const negativeSupported = currentProfile?.capabilities?.negativePrompt !== false;
  const { referenceAssets, referenceInputs, referenceInpaint, referenceRole, retryComfyStatus, comfyRetrying, comfyReconnectedAt } = view;
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  const toggleFavorite = view.toggleFavorite as (items: GalleryItem[], favorite: boolean) => void;
  const searchOn = searchActive(gallerySearch);
  const [searchOpen, setSearchOpen] = React.useState(false);
  // Phones get the simplified phone studio, unless someone chose the full one.
  const phoneDevice = usePhone();
  const phone = phoneDevice;
  const [composerExpanded, setComposerExpanded] = React.useState(false);
  const [composerPrimaryTarget, setComposerPrimaryTarget] = React.useState<HTMLDivElement | null>(null);
  const [lorasOpen, setLorasOpen] = React.useState(false);
  // Advanced Settings open in a popover above the composer, like LoRAs (UI-PATTERNS › Composer).
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  // Where the library is offered, fetch its code while idle, so it opens at once (preloadable.ts).
  const presetsOffered = models?.features?.presets === true;
  React.useEffect(() => {
    if (!presetsOffered) return;
    const idle = window.requestIdleCallback ? window.requestIdleCallback(() => { void loadPresetLibrary().catch(() => undefined); }, { timeout: 4000 }) : window.setTimeout(() => { void loadPresetLibrary().catch(() => undefined); }, 1500);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, [presetsOffered]);
  React.useEffect(() => {
    if (!composerExpanded || phone) return;
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // The status pill (an Undo) and a dropdown's floating menu (Dropdown.tsx) are never a press outside.
      if (target?.closest('.zen-prompt, [role="dialog"], [role="alertdialog"], [data-status-message], .dropdown-menu')) return;
      setComposerExpanded(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [composerExpanded, phone]);
  // Recent prompts: ↑ in an empty prompt or the clock in the composer opens them.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyKind, setHistoryKind] = React.useState<'positive' | 'negative'>('positive');
  const hasNegativeHistory = usePromptHistory(!phone, 'negative').prompts.length > 0;
  const hasPromptHistory = usePromptHistory(!phone).prompts.length > 0;
  // The very first prompt is recorded as it runs; the clock shows up then, not after a reload.
  React.useEffect(() => {
    if (phone || !runningCount) return;
    const timer = window.setTimeout(() => { refreshPrompts(); refreshPrompts('negative'); }, 1500);
    return () => window.clearTimeout(timer);
  }, [runningCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleHistory = React.useCallback(() => { setHistoryKind('positive'); setHistoryOpen((value) => historyKind !== 'positive' || !value); }, [historyKind]);
  const insertPrompt = (text: string) => {
    const previous = String(historyKind === 'negative' ? negative || "" : prompt || "");
    if (historyKind === 'negative') setNegative(clampText(text, negativeLimit));
    else setPrompt(clampText(text, promptLimit));
    setHistoryOpen(false);
    window.requestAnimationFrame(() => {
      const field = historyKind === 'negative' ? document.querySelector<HTMLTextAreaElement>('.zen-prompt textarea[aria-label="Negative Prompt"]') : promptRef.current as HTMLTextAreaElement | null;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    // Only a prompt that was really there is worth an undo.
    if (previous.trim() && previous.trim() !== text.trim()) showToast(historyKind === 'negative' ? "Negative prompt replaced" : "Prompt replaced", "default", { group: "prompt-replaced", action: { label: "Undo", onClick: () => historyKind === 'negative' ? setNegative(previous) : setPrompt(previous) } });
  };
  const promptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === "ArrowUp" && plain && !String(prompt || "").trim() && hasPromptHistory && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setHistoryKind('positive');
      setHistoryOpen(true);
      return;
    }
    submitPrompt(event);
  };
  const historyPopover = (
    <PromptHistoryPopover
      kind={historyKind}
      open={historyOpen && !phone}
      onClose={(reason) => { setHistoryOpen(false); if (reason === "escape") (historyKind === 'negative' ? document.querySelector<HTMLTextAreaElement>('.zen-prompt textarea[aria-label="Negative Prompt"]') : promptRef.current as HTMLTextAreaElement | null)?.focus(); }}
      onPick={insertPrompt}
      onError={(message) => showToast(message, "error")}
    />
  );
  const [phoneCreate, setPhoneCreate] = React.useState(false);
  const [animationItems, setAnimationItems] = React.useState<GalleryItem[] | null>(null);
  // Selecting several, in either layout. A change of layout or filtered view ends it.
  const selection = useGallerySelection(renderedGallery, JSON.stringify([phone, mode, gallerySearch]));
  useHistoryDismiss(Boolean(phone && selection.selecting), selection.end);
  // A long press selects: the item's actions live in the viewer and the select bar.
  const startSelection = React.useRef(selection.start);
  startSelection.current = selection.start;
  const phoneTileCaptions = Boolean(prefs.phoneTileCaptions);
  const phoneTiles = React.useMemo(() => phone ? { onLongPress: (item: GalleryItem) => startSelection.current([item.id]), captions: phoneTileCaptions } : null, [phone, phoneTileCaptions]);
  const openSearch = React.useCallback(() => {
    setSearchOpen(true);
    document.querySelector<HTMLInputElement>('.gallery-search input, .phone-tools-field input')?.focus();
  }, []);
  useGallerySearchKeys(true, openSearch);
  // The viewer stars with F, as the tile's star and the dock's do.
  React.useEffect(() => {
    if (!active || !canStar(active)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')) return;
      event.preventDefault();
      toggleFavorite([active], !active.favorite);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, toggleFavorite]);
  // The viewer offers Animate and Extend only where a first-frame video profile can run them.
  const canAnimate = animationProfiles(models?.profiles || []).length > 0;
  // The item actions' handlers read the latest view, so the memoised tiles keep one stable value.
  const liveView = React.useRef(view);
  liveView.current = view;
  const phoneRef = React.useRef(phone);
  phoneRef.current = phone;
  const smartUpscale = prefs.smartUpscale;
  /**
   * After Use, Reuse or Recreate: the viewer closes and the prompt box
   * opens with the reused text ready to edit, the phone's Create sheet or
   * the desktop composer, expanded and focused at the end of the prompt.
   */
  const composeFromViewer = React.useRef(() => {});
  composeFromViewer.current = () => {
    liveView.current.setActive(null);
    if (phoneRef.current) { setPhoneCreate(true); return; }
    setComposerExpanded(true);
    // Once the viewer has gone and handed focus back.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const field = promptRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    }));
  };
  const itemActionHandlers = React.useMemo<ItemActionHandlers>(() => {
    const live = () => liveView.current;
    const compose = () => composeFromViewer.current();
    return {
      showToast: (...args) => live().showToast(...args),
      smartUpscale,
      upscaleBusy: (item) => Boolean(live().upscaleBusyIds?.has(item.id)),
      upscale: (item) => live().activateUpscale(item),
      cancelUpscale: (item) => live().cancelUpscale(item),
      // A phone's buttons give no check of their own everywhere, so a toast says it worked.
      copyPrompt: (item, announce) => live().copyToClipboard(item.prompt || "", announce ?? (phoneRef.current ? "Prompt copied" : "")),
      copyItem: (item) => live().copyItemToClipboard(item),
      reuse: (item) => { live().applyAllSettings(item); compose(); },
      // Edit (prompts and settings with a new seed) has no surface for now; Recreate is reuse.
      promptsOnly: (item) => { live().applyAllSettings(item, { newSeed: true }); compose(); },
      useAsReference: canUseStartImage ? (item) => {
        live().useOutputAsStartImage(item);
        if (phoneRef.current) { live().setActive(null); setPhoneCreate(true); }
      } : undefined,
      animate: canAnimate ? (item) => setAnimationItems([item]) : undefined,
      remove: (item) => live().deleteItem(item),
      star: (item) => live().toggleFavorite([item], !item.favorite),
      starItems: (items, favorite) => live().toggleFavorite(items, favorite),
      removeItems: (items) => live().deleteItems(items),
      retry: (item) => { void live().failureFixes?.retry(item); },
      // One at a time, each its own new job with its own settings.
      retryItems: (items) => { void (async () => { for (const item of items) await live().failureFixes?.retry(item); })(); },
      stopItems: (items) => { const jobs = [...new Set(items.map((item) => item.jobId).filter(Boolean))]; jobs.forEach((jobId) => { void live().cancelJob(jobId); }); },
    };
  }, [smartUpscale, canUseStartImage, canAnimate]);
  const comfyOffline = comfyStatus && !comfyStatus.connected && !comfyStatus.checking;
  // Back closes the viewer and the workflow gallery rather than leaving the app.
  useHistoryDismiss(Boolean(active), () => setActive(null));
  const viewerRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(viewerRef, Boolean(active));
  useHistoryDismiss(Boolean(workflowGalleryOpen), () => setWorkflowGalleryOpen(false));
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>("studio");
  const openSettings = React.useCallback((section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setSettings(true);
  }, [setSettings]);
  useHistoryDismiss(Boolean(settings), () => setSettings(false));
  const [noComfyOpen, setNoComfyOpen] = React.useState(false);
  const [getModelsOpen, setGetModelsOpen] = React.useState(false);
  const openGetModels = React.useCallback(() => setGetModelsOpen(true), []);
  // A guided setup (MOSS-Image), opened from a model's setup panel.
  const [familySetup, setFamilySetup] = React.useState({ family: "", profileId: "" });
  const [familySetupOpen, setFamilySetupOpen] = React.useState(false);
  useFamilySetupRequests((request) => { setFamilySetup(request); setFamilySetupOpen(true); });
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  // "?" anywhere outside a field lists the keyboard shortcuts.
  React.useEffect(() => {
    if (phone) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')) return;
      // Before the "any letter jumps to the prompt" listener, so no "?" lands in it.
      event.preventDefault();
      event.stopImmediatePropagation();
      setShortcutsOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [phone]);
  const starterModels = (
    <StarterModels showToast={showToast} onStarted={view.onStarterStarted} onUse={view.selectStarterModel} />
  );
  // A run opened from somewhere other than its stack (a phone's sheet) is scrolled to once laid out.
  const [focusRun, setFocusRun] = React.useState("");
  const [runSheet, setRunSheet] = React.useState<Run | null>(null);
  const showRunInGallery = React.useCallback((run: Run) => {
    setRunSheet(null);
    setRunOpen(run.id, true);
    setFocusRun(run.id);
  }, [setRunOpen]);
  // Long-running work floats at the top as activities, in this order; the toasts start under them.
  const upscaleActivity = useUpscaleDownloadActivity(upscaleSetup, upscaleInstall);
  // A text encoder or VAE landing rescans models, so every panel catches up at once.
  const modelActivity = useModelDownloadActivity({
    onDone: () => { refreshModels(false); refreshWorkflows(); },
    // Either place shows the same download with its own controls.
    hidden: Boolean(workflowGalleryOpen) || getModelsOpen,
    // To the download itself: its starter card, or the setup panel of the workflow that needs it.
    onOpen: (where) => (where === "starter" ? setGetModelsOpen(true) : setWorkflowGalleryOpen(true))
  });
  const thisComputer = useThisComputer();
  // A generation stands in for itself only where its tile can't be seen: the
  // viewer on another image, or the gallery scrolled away.
  const pendingIds = React.useMemo(() => ((visibleGallery || []) as GalleryItem[]).filter((item) => item.status === "pending").map((item) => item.id), [visibleGallery]);
  const pendingTileOnScreen = useTilesOnScreen(galleryStageRef, !phone && !active ? pendingIds : []);
  const watchingGeneration = active ? active.status === "pending" : pendingTileOnScreen;
  const generationActivity = useGenerationActivity({
    items: visibleGallery || [],
    enabled: !phone,
    watching: watchingGeneration,
    reveal: () => true,
    onJump: (item) => {
      if (active) setActive(null);
      // The run's own tile, wherever it is; the top when it isn't rendered yet.
      window.requestAnimationFrame(() => {
        const tile = galleryStageRef.current?.querySelector(`[data-tile-id="${CSS.escape(String(item.id))}"]`);
        if (tile) tile.scrollIntoView({ block: "center", behavior: scrollBehavior() });
        else galleryStageRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() });
      });
    },
    onView: (item) => openItem(item)
  });
  const [islandsHeight, setIslandsHeight] = React.useState(0);
  const viewerCopy = useCopyFeedback();
  // The catalogue's LoRA titles, asked for once an output with LoRAs opens, so Details names them (UI-PATTERNS › Lists).
  const [loraInfos, setLoraInfos] = React.useState(() => knownLoraInfo());
  const activeHasLoras = Boolean(active?.settings?.loras?.length);
  React.useEffect(() => {
    if (!activeHasLoras || loraInfos) return;
    let live = true;
    fetchLoraInfo().then((infos) => { if (live) setLoraInfos(infos); }).catch(() => null);
    return () => { live = false; };
  }, [activeHasLoras, loraInfos]);
  const [compareOpen, setCompareOpen] = React.useState(false);
  // The pictures either side of the open one are fetched ahead, so a swipe lands on one already there.
  useNeighborPrefetch(active || null, (view.viewerGallery || []) as GalleryItem[]);
  // On a phone Details covers the video, so it pauses until Details closes (mediaCover.ts).
  React.useEffect(() => (phone && showDetails && active?.type === "video" ? coverMedia() : undefined), [phone, showDetails, active?.id, active?.type]);
  // A different image has its own comparison, so never carry the mode over.
  React.useEffect(() => { setCompareOpen(false); }, [active?.id]);
  const viewerWheelRef = useWheelRef<HTMLElement>(wheelViewer);
  // Only Ctrl+wheel (page zoom) is swallowed, so the details panel still scrolls.
  const scrimWheelRef = useWheelRef<HTMLDivElement>((event) => { if (event.ctrlKey) event.preventDefault(); });
  const setViewerNode = React.useCallback((node: HTMLDivElement | null) => {
    viewerRef.current = node;
    return scrimWheelRef(node);
  }, [scrimWheelRef]);
  // .bottom-fade is fixed and full width: keep it off the gallery's scrollbar.
  React.useEffect(() => {
    const gallery = galleryStageRef.current as HTMLElement | null;
    if (!gallery) return;
    const update = () => {
      // With "both-edges" the gutter is mirrored on the left; only the right half is the scrollbar.
      const gutters = gallery.offsetWidth - gallery.clientWidth;
      const mirrored = getComputedStyle(gallery).scrollbarGutter.includes("both-edges");
      gallery.style.setProperty("--scrollbar-w", `${mirrored ? gutters / 2 : gutters}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(gallery);
    return () => observer.disconnect();
  }, []);
  // One compact dock, bottom right, in both layouts. Transient actions (tidy up,
  // cancel queue) rise above it as small chips, so the dock never changes size.
  const dockChip = popoverMotion;
  const studioDockRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const dock = studioDockRef.current;
    const shell = dock?.closest<HTMLElement>('.app-shell');
    if (!dock || !shell) return;
    const measure = () => shell.style.setProperty('--studio-dock-w', `${dock.offsetWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => { observer.disconnect(); shell.style.removeProperty('--studio-dock-w'); };
  }, [phone]);

  const studioDock = (
    <div className="studio-dock" ref={studioDockRef}>
      <div className="dock-transients">
        <AnimatePresence initial={false}>
          {runningCount ? (
            <motion.div key="cancel" {...dockChip}>
              <Tip content="Stop Everything Running & Queued">
                <button type="button" className="dock-chip is-cancel" onClick={cancelQueue}>
                  <CircleStop size={14} />
                  <span>Stop All</span>
                  <i className="dock-count"><AnimatedNumber value={runningCount} /></i>
                </button>
              </Tip>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ComfyConnectionDot status={comfyStatus} retrying={Boolean(comfyRetrying)} onClick={retryComfyStatus} />
      {models?.features?.presets === true ? <Tip content="Image & Model Library"><button className="icon-button" aria-label="Image & Model Library" aria-haspopup="dialog" aria-expanded={Boolean(view.presetLibraryOpen)} onClick={() => view.setPresetLibraryOpen(true)}><Library size={16} /></button></Tip> : null}
      <Tip content="Settings"><button className="icon-button" aria-label="Settings" aria-haspopup="dialog" aria-expanded={Boolean(settings)} onFocus={() => { void loadSettings().catch(() => undefined); }} onPointerEnter={() => { void loadSettings().catch(() => undefined); }} onPointerDown={() => { void loadSettings().catch(() => undefined); }} onClick={() => setSettings(true)}><Settings size={16} /></button></Tip>
      {hasAccountStorageScope() ? <AccountMenu openAccount={() => openSettings('account')} onError={(message) => showToast(message, 'error')} /> : null}
    </div>
  );
  // The gallery, its empty and offline stages and the lock: the same in every layout.
  const galleryBody = (
    <>
          {galleryCrossing ? <section className="gallery" /> : !galleryLoaded ? <section className="gallery virtual-gallery" style={{ "--gallery-columns": galleryColumnCount } as React.CSSProperties}><GallerySkeleton columns={galleryColumnCount} /></section> : renderedGallery.length ? (
            <StableGallery
              key={mode}
              cancelJob={cancelJob}
              groups={galleryGroups}
              moments={Boolean(prefs.dateHeaders)}
              stackRuns={stackRuns}
              openRuns={openRuns}
              settleVersion={view.settleVersion}
              stackStyle={prefs.runStackStyle === "flow" ? "flow" : "burst"}
              setRunOpen={setRunOpen}
              onUnstack={unstackRun}
              onStackPress={phone ? setRunSheet : undefined}
              focusRun={focusRun}
              onFocused={() => setFocusRun("")}
              followItem={active?.id}
              columns={galleryColumnCount}
              spanWide={Boolean(prefs.spanWideImages) && !phone}
              formatElapsed={formatElapsed}
              items={renderedGallery}
              openItem={openItem}
              scrollRef={galleryStageRef}
              smartUpscale={prefs.smartUpscale}
              upscaleBusyIds={upscaleBusyIds}
              onUpscale={activateUpscale}
              onCancelUpscale={cancelUpscale}
              titleFromPrompt={titleFromPrompt}
            />
          ) : searchOn ? (
            <SearchEmpty search={gallerySearch} onClear={() => { setGallerySearch(emptySearch); setSearchOpen(false); }} />
          ) : (
            <EmptyStage
              known={Boolean(comfyStatus?.checked)}
              offline={Boolean(comfyOffline) || Boolean(comfyStatus?.restarting)}
              restarting={Boolean(comfyStatus?.restarting)}
              device={comfyStatus?.device}
              retrying={Boolean(comfyRetrying)}
              onRetry={retryComfyStatus}
              onOpenConnection={() => openSettings("workers")}
              comfyUrl={comfyStatus?.url || health?.comfyUrl}
              nearby={comfyStatus?.nearby}
              onNoComfy={() => setNoComfyOpen(true)}
              noModels={Boolean(models) && !modelProfiles?.length}
              onFindModels={modelFolders?.openDialog}
              starter={mode === "image" ? starterModels : undefined}
            />
          )}
          {renderedGallery.length ? <ConnectedCard at={comfyReconnectedAt} device={comfyStatus?.device} /> : null}
            {galleryLoaded && hasMoreGallery ? (
              <button className="gallery-load-more" onClick={loadMoreGalleryItems}>
                Load More
              </button>
            ) : null}
    </>
  );

  // The desktop's percentage steps through Fit, 1:1 and Full Size; the phone keeps its buttons.
  const imageZoomControls = <ViewerZoomControls zoom={viewerZoom} nativeZoom={view.viewerNativeZoom || 1} onZoom={zoomViewer} onCycle={view.cycleViewerSize} />;
  const composer = (
          <ExpandingComposer expanded={composerExpanded} onExpandedChange={setComposerExpanded}>
            <div className="composer-prompt-row">
              <PromptField kind="positive" value={prompt} textareaRef={promptRef} ariaLabel="Prompt" onKeyDown={promptKeyDown} onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt("")} historyAvailable={hasPromptHistory} historyOpen={historyOpen && historyKind === 'positive'} onHistory={toggleHistory} />
              <div className="composer-primary-actions" ref={setComposerPrimaryTarget} />
            </div>
            {nearTextLimit(prompt, promptLimit) ? <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span> : null}
            {negativeSupported ? <div className="composer-secondary-row">
              <PromptField kind="negative" value={negative} onChange={(value) => setNegative(clampText(value, negativeLimit))} onClear={() => setNegative("")} historyAvailable={hasNegativeHistory} historyOpen={historyOpen && historyKind === 'negative'} onHistory={() => { setHistoryKind('negative'); setHistoryOpen((open) => historyKind !== 'negative' || !open); }} />
              {nearTextLimit(negative, negativeLimit) ? <span className="prompt-count">{characterMeta(negative, negativeLimit)}</span> : null}
            </div> : null}
            <StableComposerBar
              primaryTarget={composerExpanded ? null : composerPrimaryTarget}
              advancedOpen={advancedOpen}
              onAdvanced={() => setAdvancedOpen((open) => !open)}
              onBrowseModels={() => setWorkflowGalleryOpen(true)}
              onReset={view.resetCreation}
              models={models}
              model={model}
              modelProfiles={modelProfiles}
              showInpaint={prefs.inpainting}
              profileBadges={profileBadges}
              chooseModel={pickModel}
              modelMenu={modelMenu}
              currentProfile={currentProfile}
              comfyOffline={Boolean(comfyOffline)}
              comfyRestarting={Boolean(comfyStatus?.restarting)}
              onFindModels={thisComputer ? modelFolders?.openDialog : undefined}
              onGetModels={thisComputer ? openGetModels : undefined}
              strayModelCount={strayModelCount}
              mode={mode}
              onModeChange={view.changeMode}
              aspectPickerValue={aspectPickerValue}
              aspectOptions={aspectOptions}
              aspectValue={aspectValue}
              defaultAspectSize={defaultAspectSize}
              applyAspect={applyAspect}
              sizeTier={customSize ? "custom" : view.sizeTier}
              sizeTiers={view.sizeTiers}
              sizeArea={view.sizeArea}
              megapixelControl={view.megapixelControl}
              sizeMax={view.sizeMax}
              customLimits={view.customLimits}
              chooseSizeTier={view.chooseSizeTier}
              applyCustomRatio={view.applyCustomRatio}
              setCustomDimensions={view.setCustomDimensions}
              savedSizes={view.savedSizes}
              saveCustomSize={view.saveCustomSize}
              renameSavedSize={view.renameSavedSize}
              removeSavedSize={view.removeSavedSize}
              pickSavedSize={view.pickSavedSize}
              customSize={Boolean(customSize)}
              aspectLocked={Boolean(aspectLocked)}
              width={width}
              widthMeta={widthMeta}
              setWidth={setWidth}
              height={height}
              heightMeta={heightMeta}
              setHeight={setHeight}
              steps={steps}
              stepsMeta={stepsMeta}
              setSteps={setSteps}
              count={count}
              countMeta={countMeta}
              setCount={setCount}
              loraActiveCount={loraActiveCount}
              loraSummary={loraSummary}
              lorasOpen={lorasOpen}
              onOpenLoras={() => setLorasOpen(open => !open)}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generateDisabled={Boolean(generateDisabled)}
              generateDisabledReason={generateDisabledReason}
              generate={generate}
              refreshComfyStatus={retryComfyStatus}
              comfyRetrying={Boolean(comfyRetrying)}
              referenceInputs={referenceInputs}
              referenceOpenRequest={view.referenceOpenRequest}
              referenceInpaint={referenceInpaint}
              referenceRole={referenceRole}
              loraMismatch={view.loraMismatch}
              onDismissLoraMismatch={view.dismissLoraMismatch}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceError={(message) => showToast(message, "error")}
              pinnedSeed={view.seed}
              onRandomSeed={() => view.setSeed("")}
              generationEstimate={view.generationEstimate}
              generateKey={view.generateKey}
            />
            {historyPopover}
          </ExpandingComposer>
  );

  return (
    <GenerationPreviewMode.Provider value={prefs.generationPreviewMode}>
    <TileLongPressContext.Provider value={phoneTiles}>
    <ItemActionsContext.Provider value={itemActionHandlers}>
    <GallerySelectionContext.Provider value={selection}>
    <FavoriteContext.Provider value={toggleFavorite}>
    <GenerationProfiles.Provider value={models?.profiles || noProfiles}>
    <div className={cn(phone ? "phone-shell" : "app-shell", canUseNegativePrompt && "negative-open", (searchOpen || searchOn) && "is-searching")} style={!phone ? { "--islands-h": `${islandsHeight ? islandsHeight + 8 : 0}px` } as React.CSSProperties : undefined}>
      {phone ? <RunSheet run={runSheet} onClose={() => setRunSheet(null)} openItem={openItem} onShowInGallery={showRunInGallery} /> : null}
      {phone ? (
        <PhoneShell
          view={{ ...view, lorasOpen, openLoras: () => setLorasOpen(open => !open), phoneSearchOpen: searchOpen, setPhoneSearchOpen: setSearchOpen, openSettings }}
          galleryBody={galleryBody}
          canUseNegativePrompt={canUseNegativePrompt}
          comfyOffline={Boolean(comfyOffline)}
          createOpen={phoneCreate}
          setCreateOpen={setPhoneCreate}
          selection={selection}
        />
      ) : (
        <>
          <main ref={galleryStageRef} className="stage-gallery" onScroll={onGalleryScroll} onWheel={view.onGalleryUserScroll} onTouchStart={view.onGalleryUserScroll}>
            <GalleryManagement selection={selection} status={<SurfaceStatus className="is-toolbar" />} modeSelector={<MediaModeToggle kind="gallery" className="gallery-generation-mode" labelled mode={mode} onChange={view.changeMode} />} search={<GallerySearchBar search={gallerySearch} setSearch={setGallerySearch} count={view.galleryTotalApprox} open={searchOpen} setOpen={setSearchOpen} items={renderedGallery} />} showToolbar tools={<GalleryViewControls prefs={prefs} setPrefs={setPrefs} hasVideos={renderedGallery.some((item: GalleryItem) => item.type === 'video')} searching={Boolean(searchOn)} />}>{galleryBody}</GalleryManagement>
            <div className="bottom-fade" />
          </main>
          {studioDock}
          {composer}
        </>
      )}
      {settings ? <React.Suspense fallback={<Modal open size="sheet" className="settings-modal" title="Settings" onOpenChange={(open) => { if (!open) setSettings(false); }}><p role="status">Opening settings…</p></Modal>}><SettingsDialog view={view} open={Boolean(settings)} section={settingsSection} onSectionChange={setSettingsSection} onClose={() => setSettings(false)} onGetModels={thisComputer ? () => { setSettings(false); openGetModels(); } : undefined} /></React.Suspense> : null}
      <NoComfySheet open={noComfyOpen} onOpenChange={setNoComfyOpen} onChangeAddress={thisComputer ? () => openSettings("workers") : undefined} />
      <GetModelsSheet open={getModelsOpen} onOpenChange={setGetModelsOpen} showToast={showToast} onStarted={view.onStarterStarted} onUse={view.selectStarterModel} onFindModels={thisComputer ? modelFolders?.openDialog : undefined} />
      {familySetup.family ? (
        <FamilySetupDialog
          family={familySetup.family}
          profileId={familySetup.profileId}
          open={familySetupOpen}
          onOpenChange={setFamilySetupOpen}
          showToast={showToast}
          onUse={view.pickModel}
          onChanged={() => { view.refreshModels(false); view.refreshWorkflows(); }}
          comfyUrl={health?.comfyUrl}
        />
      ) : null}
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {phone ? null : <AdvancedPopover open={advancedOpen} onClose={() => setAdvancedOpen(false)}>{view.phoneAdvancedControls}</AdvancedPopover>}
      <LoraPopover open={lorasOpen} onClose={() => setLorasOpen(false)}>{React.isValidElement(view.modelLoraControls) ? React.cloneElement(view.modelLoraControls as React.ReactElement<{ browseFirst?: boolean }>, { browseFirst: true }) : view.modelLoraControls}</LoraPopover>
      {animationItems ? <AnimatePhotos items={animationItems} profiles={models?.profiles || []} autoResizeInputs={prefs.autoResizeInputs} onClose={() => setAnimationItems(null)} /> : null}
      {modelFolders ? <ModelFoldersDialog folders={modelFolders} runningCount={runningCount} /> : null}
      <UpscaleSetupDialog
        setup={upscaleSetup}
        status={upscaleStatus}
        install={upscaleInstall}
        reason={upscaleUnavailableReason}
        quality={upscaleSetup.quality}
        comfyUrl={health?.comfyUrl}
        onQualityChange={(upscaleQuality) => setPrefs({ upscaleQuality })}
        onOpenLibrary={() => { upscaleSetup.closeSetup(); openSettings("models"); }}
        showToast={showToast}
      />
      <ActivityColumn activities={[upscaleActivity, modelActivity, generationActivity]} onHeight={setIslandsHeight} />
      {active ? (() => {
        const hasNeighbors = ((view.viewerGallery || []) as GalleryItem[]).length > 1;
        // What made this output, at the top of its preview: the profile it ran
        // through, then the settings worth seeing without opening Details.
        // Its profile's friendly name, also for an output from a profile renamed since (itemProfile.ts).
        const activeProfile = itemProfile(active, models?.profiles || []);
        const activeProfileName = itemProfileName(active, models?.profiles || []);
        const profileTitle = (activeProfile ? modelName(activeProfile).name : activeProfileName) || (active.settings?.modelName ? partName(String(active.settings.modelName)) : "") || "Generation";
        // A LoRA's catalogue entry by its saved path, or by its file name when the folder differs.
        const loraInfoOf = (file: string) => loraInfos?.[file] || Object.entries(loraInfos || {}).find(([name]) => name.split(/[\\/]/).pop() === file)?.[1];
        const detailNames = { profile: activeProfileName, lora: (file: string) => loraName(file, (loraInfos || knownLoraInfo())?.[file]) };
        const detailEntries = generationDetailEntries(active, detailNames);
        const processing: Array<[string, string]> = [];
        if (active.upscale?.status === 'done') processing.push(['Upscale', active.upscale.width && active.upscale.height ? `${active.upscale.width} × ${active.upscale.height}` : 'Applied']);
        if (active.upscale?.faceDetail) processing.push(['Face Detail', 'Applied']);
        if (active.settings?.inpaint) processing.push(['Inpainting', 'Applied']);
        const outputSection = detailEntries.find((section: GenerationDetailSection) => section.title === 'Output');
        if (processing.length && outputSection) { outputSection.rows.push(...processing); sortDetailRows(outputSection); }
        const profileDetail = [
          active.width && active.height ? `${active.width} × ${active.height}` : '',
          active.settings?.steps ? `${active.settings.steps} Steps` : '',
          active.type === 'video' && active.settings?.duration ? `${active.settings.duration} s` : '',
        ].filter(Boolean).join(' · ');
        // The phone's title sits in the top row beside Star · Info · Close: the
        // name, then where it is in the gallery, when it was made and its size.
        const viewerList = (view.viewerGallery || []) as GalleryItem[];
        const viewerIndex = viewerList.findIndex((item) => item.id === active.id);
        const madeAt = active.createdAt ? new Date(active.createdAt) : null;
        const phoneDetail = [
          viewerList.length > 1 && viewerIndex >= 0 ? `${viewerIndex + 1} / ${viewerList.length}` : '',
          madeAt && !Number.isNaN(madeAt.getTime()) ? madeAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
          profileDetail,
        ].filter(Boolean).join(' · ');
        return (
          <div className="scrim" role="dialog" aria-modal="true" aria-label="Image Viewer" data-focus-trap tabIndex={-1} onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - viewerDragEndRef.current < 200) return;
            setActive(null);
          }} ref={setViewerNode}>
            <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
              <div className={cn("viewer-stage", showDetails && "with-side")} data-viewer-empty>
                {/* The title, always (UI-PATTERNS › Action Placement): the profile, then where it is, when and how it was made. */}
                <header className={cn("viewer-profile-summary", phone && "is-phone")} data-open-surface>
                  <strong>{profileTitle}</strong>
                  {phoneDetail ? <span>{phoneDetail}</span> : null}
                </header>
                <div
                  data-generation-size={`${active.width} × ${active.height}`}
                  className={cn("viewer-canvas", active.type === 'video' && 'is-video', viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging")}
                  data-open-surface
                  style={{ "--zoom": viewerZoom, "--pan-x": `${viewerPan.x}px`, "--pan-y": `${viewerPan.y}px` } as React.CSSProperties}
                  ref={viewerWheelRef}
                  onPointerDown={startViewerDrag}
                  onPointerMove={dragViewer}
                  onPointerUp={stopViewerDrag}
                  onPointerCancel={stopViewerDrag}
                  onTouchStart={startViewerTouch}
                  onTouchMove={moveViewerTouch}
                  onTouchEnd={endViewerTouch}
                  onTouchCancel={endViewerTouch}
                  onClick={clickViewer}
                  onDoubleClick={(event) => { event.stopPropagation(); if (Date.now() - Number(event.currentTarget.dataset.lastTouchAt || 0) < 700) return; zoomViewer(viewerZoom > view.viewerNativeZoom * 1.05 ? view.viewerNativeZoom : view.viewerNativeZoom * 2.5, { x: event.clientX, y: event.clientY, element: event.currentTarget }); }}
                >
                  {active.status === "error" ? <FailurePanel item={active} onCopy={copyToClipboard} onReuse={() => itemActionHandlers.reuse(active)} fixes={view.failureFixes} showToast={showToast} onNodesInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : compareOpen && active.upscale?.url && !upscaledWithRun(active) ? <UpscaleCompare item={active} zoomed={viewerZoom > 1} /> : (
                  <GenerationMedia item={active} fit="contain" stage scale={(viewerZoom / (view.viewerNativeZoom || 1)) * (window.devicePixelRatio || 1)}>
                  {active.status === "pending" ? <GenerationProgress item={active} formatElapsed={formatElapsed} /> : null}
                  </GenerationMedia>
                  )}
                </div>
                {hasNeighbors ? (
                  <>
                    <Tip content="Previous"><button className="viewer-arrow prev" aria-label="Previous Output" onClick={() => moveViewer(-1)}><ChevronLeft size={20} /></button></Tip>
                    <Tip content="Next"><button className="viewer-arrow next" aria-label="Next Output" onClick={() => moveViewer(1)}><ChevronRight size={20} /></button></Tip>
                  </>
                ) : null}
                {showDetails ? (
                  <aside translate="no" data-open-surface className="viewer-side" onWheel={(event) => event.stopPropagation()}>
                    <div className="viewer-side-head">
                      <h3>Details</h3>
                      {/* The desktop panel closes itself, as it covers the corner Info sits in; on the phone Info (pressed) closes it, so there is one close. */}
                      {phone ? null : <Tip content="Close Details (I)"><button type="button" className="icon-button viewer-side-close" aria-label="Close Details" onClick={() => setShowDetails(false)}><X size={16} /></button></Tip>}
                    </div>
                    <div className="viewer-side-body">
                      <PromptReadout label="Prompt" text={active.prompt || ""} onCopy={() => copyToClipboard(active.prompt || "", phone ? "Prompt copied" : "")} />
                      {active.negative ? <PromptReadout label="Negative" text={active.negative} onCopy={() => copyToClipboard(active.negative || "", phone ? "Negative prompt copied" : "")} /> : null}
                      {detailEntries.length ? (
                        <section className="detail-settings" aria-label="Generation Details">
                          {detailEntries.map((section: GenerationDetailSection) => (
                            <div className="detail-section" key={section.title}>
                              <h3 className="detail-heading">{section.title}</h3>
                              {section.note ? <p className="detail-note">{section.note}</p> : null}
                              {section.rows.length ? (
                                <div className="detail-grid">
                                  {section.rows.map(([key, value], index) => (
                                    <React.Fragment key={`${key}-${index}`}>
                                      <span>{key}</span><strong>{value}</strong>
                                    </React.Fragment>
                                  ))}
                                </div>
                              ) : null}
                              {section.loras?.length ? (
                                <ul className="detail-loras" aria-label="LoRAs">
                                  {section.loras.map((lora, index) => (
                                    <li key={`${lora.name}-${index}`} className="detail-lora">
                                      {/* As in the LoRA chooser: the name, then on the right its strength and View Source; its information under the name. */}
                                      <span className="detail-lora-name" title={lora.file}>{lora.name}</span>
                                      <span className="detail-lora-strength" aria-label={`Strength ${lora.strength}`}>{lora.strength}</span>
                                      <LoraSources info={loraInfoOf(lora.file)} label={lora.name} />
                                      <LoraDetails info={loraInfoOf(lora.file)} label={lora.name} enabled file={lora.file} />
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ))}
                        </section>
                      ) : null}
                    </div>
                    <DetailsFooter
                      onCopy={() => copyToClipboard(generationInputsText(active), 'Inputs copied')}
                      onRecreate={active.prompt ? () => itemActionHandlers.reuse(active) : undefined}
                    />
                  </aside>
                ) : null}
                {phone ? (
                  <>
                    {active.type === "image" && !showDetails ? <div data-open-trigger className="viewer-zoom-pill is-phone">{imageZoomControls}</div> : null}
                    <PhoneViewerBar
                      item={active}
                      showDetails={Boolean(showDetails)}
                      onToggleDetails={() => setShowDetails((value: boolean) => !value)}
                      compare={{ open: compareOpen, toggle: () => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer('fit'); } }}
                    />
                  </>
                ) : (
                <>
                {active.type === "image" ? <div data-open-trigger className={cn("viewer-zoom-pill", showDetails && "with-side")}>{imageZoomControls}</div> : null}
                <div data-open-trigger className={cn("viewer-dock", showDetails && "with-side")} role="toolbar" aria-label="Image Actions">
                  <ViewerDockActions
                    item={active}
                    compare={{ open: compareOpen, toggle: () => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer(); } }}
                    details={Boolean(showDetails)}
                  />
                  <span className="viewer-divider" />
                  <Tip content="Close (Esc)" side="top"><button className="icon-button viewer-dock-close" aria-label="Close" onClick={() => setActive(null)}><X size={16} /></button></Tip>
                </div>
                {/* Info opens Details from the top right; the open panel has its own Close. */}
                {!showDetails ? <Tip content="Show Details (I)"><button type="button" data-open-trigger className="viewer-info" aria-label="Info" aria-pressed={false} onClick={() => setShowDetails(true)}><Info size={17} /></button></Tip> : null}
                </>
                )}
                {/* Over the viewer, messages sit at its top edge, between the corner buttons. */}
                <SurfaceStatus className="is-viewer" />
                {/* Phones and tablets: the dock has no room for Close, so it sits in the corner. */}
                <button className="viewer-close" aria-label="Close Viewer" onClick={() => setActive(null)}><X size={18} /></button>
              </div>
            </div>
          </div>
        );
      })() : null}
      {models?.features?.presets === true && view.presetLibraryOpen ? <React.Suspense fallback={<Modal open title="Image & Model Library" onOpenChange={() => view.setPresetLibraryOpen(false)}><p role="status">Opening presets…</p></Modal>}><PresetLibrary onClose={() => view.setPresetLibraryOpen(false)} models={models} refreshModels={refreshModels} onApply={view.applyImagePreset} onPrompt={view.applyPresetPrompt} showToast={showToast} /></React.Suspense> : null}
      {workflowGalleryOpen ? <React.Suspense fallback={<Modal open title="Workflow Gallery" onOpenChange={(open) => { if (!open) setWorkflowGalleryOpen(false); }}><p role="status">Opening workflows…</p></Modal>}><WorkflowGallery view={{ ...view, onClose: () => setWorkflowGalleryOpen(false) }} /></React.Suspense> : null}
      {/* Generation progress for screen readers: started, rendering, ready. */}
      <div className="sr-only" role="status" aria-live="polite">{view.status && view.status !== "Ready" && !/^Rendering|^Queued/.test(view.status) ? view.status : ""}</div>
      <StatusAnnouncer />
    </div>
    </GenerationProfiles.Provider>
    </FavoriteContext.Provider>
    </GallerySelectionContext.Provider>
    </ItemActionsContext.Provider>
    </TileLongPressContext.Provider>
    </GenerationPreviewMode.Provider>
  );
}
