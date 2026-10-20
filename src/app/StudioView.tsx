import { ViewerZoomControls } from './ViewerZoomControls';
import { GalleryManagement } from './GalleryManagement';
import { AnimatePhotos, animationProfiles } from './AnimatePhotos';
import { PromptField } from './PromptField';
import { LoraPopover } from './LoraPopover';
import React from 'react';
import { useNeighborPrefetch } from './useNeighborPrefetch';
import { GridAutoplayButton } from './GridAutoplayButton';
import { ArrowLeft, ChevronDown, CircleStop, ChevronLeft, ChevronRight, ChevronUp, EyeOff, GalleryHorizontalEnd, Library, Lock, LockKeyhole, Maximize2, Minimize2, PanelLeft, Pin, PinOff, MoreHorizontal, RotateCcw, Settings, SlidersHorizontal, Smartphone, Wand2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, nearTextLimit, settingsText, type GenerationDetailSection } from './format';
import { GallerySkeleton, Media, Skeleton, Tip } from './components';
import { useHorizontalWheel, useWheelRef } from './wheel';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { GenerationProfiles, GenerationProgress } from './GenerationProgress';
import { ComposerBar } from './ComposerBar';
import { ExpandingComposer } from './ExpandingComposer';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { features } from './constants';
import { RunCard, runKind } from './RunStack';
import { RunSheet } from './RunSheet';
import { StackRunsButton } from './StackRunsButton';
import { runTitle, type Run } from './runs';
import { UpscaleCompare } from './UpscaleCompare';
import { upscaledWithRun } from './useUpscale';
import { UpscaleSetupDialog } from './UpscaleDialogs';
import { ModelFoldersDialog } from './ModelFoldersDialog';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { useUpscaleDownloadActivity } from './UpscaleDownloadActivity';
import { FailurePanel } from './GenerationFailure';
import { useModelDownloadActivity } from './ModelDownloadActivity';
import { useGenerationActivity, useTilesOnScreen } from './GenerationActivity';
import { ActivityColumn } from './Activities';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { ViewerActions } from './ViewerActions';

import { HiddenLockScreen, HiddenUnlockSheet } from './HiddenLock';
import { HiddenSetupDialog } from './HiddenSetup';
import { HiddenActionsContext } from './hiddenContext';
import { LockMark } from './LockMark';
import { TileLongPressContext } from './GalleryTile';
import { PhoneShell } from './PhoneStudio';
import { PhoneViewerBar, ViewerDockActions } from './ItemActionSurfaces';
import { ItemActionsContext, type ItemActionHandlers } from './itemActions';
import { GallerySelectionContext, useGallerySelection } from './gallerySelection';
import { usePhone, useThisComputer } from './device';
import { haptic } from './phoneControls';
import { ConnectedCard } from './ConnectedCard';
import { Toaster } from './Toaster';
import { EmptyStage } from './EmptyStage';
import type { SettingsSection } from './SettingsDialog';
import { Modal } from './Modal';
import { GetModelsSheet, StarterModels } from './StarterModels';
import { FamilySetupDialog, useFamilySetupRequests } from './FamilySetupDialog';
import { NoComfySheet } from './NoComfySheet';
import { FeedbackHost } from './FeedbackDialog';
import { ShortcutsSheet } from './shortcuts';
import { useHistoryDismiss } from './useHistoryDismiss';
import { useFocusTrap } from './useFocusTrap';
import { PromptHistoryPopover } from './PromptHistory';
import { GallerySearchBar, SearchEmpty, useGallerySearchKeys } from './GallerySearch';
import { canStar, emptySearch, FavoriteContext, searchActive, type GallerySearch } from './favorites';
import { refreshPrompts, usePromptHistory } from './recentPrompts';
import type { GalleryItem } from './types';
import type { HiddenState } from './useHidden';
import { memoLatest } from '@/lib/memo-latest';

// App rebuilds every prop on each render (a keystroke in the prompt, a poll);
// these skip re-rendering unless their data actually changed.
const StableGallery = memoLatest(VirtualMasonryGallery);
const StableComposerBar = memoLatest(ComposerBar);

type ZenStripProps = {
  items: GalleryItem[];
  activeId?: string;
  stripRef: React.Ref<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onSelect: (id: string) => void;
  titleFromPrompt: (text: string) => string;
};

const ZenStrip = memoLatest(function ZenStrip({ items, activeId, stripRef, onPointerDown, onPointerMove, onPointerUp, onSelect, titleFromPrompt }: ZenStripProps) {
  return (
    <div
      ref={stripRef}
      className="zen-gallery-strip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {items.map((item) => (
        <Tip key={item.id} content={item.run ? `${runTitle(item.run)} · ${runKind(item.run)}` : titleFromPrompt(item.prompt || item.filename || "")}><button data-zen-id={item.id} className={cn(item.id === activeId && "active", item.run && "is-run")} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} onDragStart={(event) => event.preventDefault()}>
          <Media item={item} muted />
          {item.run ? <span className="zen-run-count" aria-hidden="true">{item.run.count}</span> : null}
        </button></Tip>
      ))}
    </div>
  );
});

function comfyStatusLabel(status: any) {
  const name = status?.label || "ComfyUI";
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
const PresetLibrary = React.lazy(() => import('./PresetLibrary').then((module) => ({ default: module.PresetLibrary })));
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
  const { active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, clickViewer, comfyStatus, galleryGroups, stackRuns, openRuns, setRunOpen, unstackRun, copyToClipboard, count, countMeta, currentProfile, customSize, zenGallery, formatElapsed, galleryColumnCount, galleryLoaded, galleryCrossing, galleryStageRef, generate, generateDisabled, generateDisabledReason, generationDetailEntries, goLatestZen, hasMoreGallery, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, loraSummary, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, onGalleryScroll, openItem, prefs, hiddenSpace, hideItems, unhideItems, profileBadges, prompt, promptLimit, refreshComfyStatus, removeReferenceAsset, renderedGallery, resetViewer, runningCount, selectReferenceAsset, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setZenControls, setZenGalleryOpen, setZenMode, showDetails, settings, showNegativePrompt, showToast, sidebarControls, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitZenPrompt, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, upscaleBusyIds, activateUpscale, cancelUpscale, upscaleDisplayUrl, upscaleSetup, upscaleStatus, upscaleInstall, upscaleUnavailableReason, health, setPrefs, upscaleNotices, dismissUpscaleNotice, refreshModels, refreshWorkflows, modelFolders } = view;
  // Smart upscale works on images, and only while it is on in Settings.
  const strayModelCount = modelFolders?.strayCount || 0;
  const canUseNegativePrompt = true;
  const negativeSupported = currentProfile?.capabilities?.negativePrompt !== false;
  const { confirmAction, referenceAssets, referenceInputs, referenceInpaint, referenceRole, retryComfyStatus, comfyRetrying, comfyReconnectedAt } = view;
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  const toggleFavorite = view.toggleFavorite as (items: GalleryItem[], favorite: boolean) => void;
  const searchOn = searchActive(gallerySearch);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const hidden = view.hidden as HiddenState;
  // Hidden, locked (or mid-unlock): the lock takes the gallery's place.
  const hiddenLocked = hiddenSpace && (!hidden.unlocked || hidden.unlockStage === "opening");
  // Stable across renders, so the memoised tiles do not all redraw when anything changes.
  const hideRef = React.useRef(hideItems);
  const unhideRef = React.useRef(unhideItems);
  hideRef.current = hideItems;
  unhideRef.current = unhideItems;
  const hiddenRef = React.useRef(hidden);
  hiddenRef.current = hidden;
  const hiddenActions = React.useMemo(() => ({
    space: hidden.space,
    enabled: hidden.enabled,
    unlocked: hidden.unlocked,
    hide: (items: GalleryItem[]) => hideRef.current(items),
    unhide: (items: GalleryItem[]) => unhideRef.current(items),
    unlock: () => {
      const current = hiddenRef.current;
      // Straight from the click, so the system's Touch ID sheet is allowed to show.
      if (current.usablePasskey && current.support?.available) current.unlockBiometric();
      else current.requestUnlock(null);
    }
  }), [hidden.space, hidden.enabled, hidden.unlocked]);
  // Crossing between the gallery and Hidden (or unlocking) fades the stage in anew.
  // Two identical animations, alternated, so each crossing restarts it.
  const passageKey = `${hidden.space}|${hiddenLocked ? "shut" : "open"}`;
  const passage = React.useRef({ key: passageKey, count: 0 });
  if (passage.current.key !== passageKey) passage.current = { key: passageKey, count: passage.current.count + 1 };
  const passageClass = passage.current.count ? `hidden-pass-${passage.current.count % 2 ? "a" : "b"}` : null;
  const toggleHiddenSpace = () => {
    if (hiddenSpace) { hidden.setSpace("gallery"); return; }
    hidden.setSpace("hidden");
    if (!hidden.enabled) { hidden.ensureReady({ kind: "enter" }); return; }
    // Straight from the click, so the system's Touch ID sheet is allowed to show.
    if (!hidden.unlocked && hidden.usablePasskey && hidden.support?.available) hidden.unlockBiometric();
  };
  // Phones get the simplified phone studio, unless someone chose the full one.
  const phoneDevice = usePhone();
  const phone = phoneDevice && !prefs.fullStudioOnPhone;
  const [composerExpanded, setComposerExpanded] = React.useState(false);
  const [composerPrimaryTarget, setComposerPrimaryTarget] = React.useState<HTMLDivElement | null>(null);
  const [lorasOpen, setLorasOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  React.useEffect(() => {
    if (!composerExpanded || phone) return;
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.zen-prompt, [role="dialog"], [role="alertdialog"]')) return;
      setComposerExpanded(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [composerExpanded, phone]);
  React.useEffect(() => {
    if (!zenControls) return;
    setComposerExpanded(true);
    setZenControls(false);
  }, [zenControls, setZenControls]);
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
      const field = historyKind === 'negative' ? document.querySelector<HTMLTextAreaElement>('.zen-prompt textarea[aria-label="Negative Prompt"]') : zenPromptRef.current as HTMLTextAreaElement | null;
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
    submitZenPrompt(event);
  };
  const historyPopover = (
    <PromptHistoryPopover
      kind={historyKind}
      open={historyOpen && !phone}
      onClose={(reason) => { setHistoryOpen(false); if (reason === "escape") (historyKind === 'negative' ? document.querySelector<HTMLTextAreaElement>('.zen-prompt textarea[aria-label="Negative Prompt"]') : zenPromptRef.current as HTMLTextAreaElement | null)?.focus(); }}
      onPick={insertPrompt}
      hiddenSpace={Boolean(hiddenSpace)}
      onError={(message) => showToast(message, "error")}
    />
  );
  const [phoneCreate, setPhoneCreate] = React.useState(false);
  const [phoneActionsFor, setPhoneActionsFor] = React.useState<GalleryItem | null>(null);
  const openTileActions = React.useCallback((item: GalleryItem) => { haptic('press'); setPhoneActionsFor(item); }, []);
  const [animationItems, setAnimationItems] = React.useState<GalleryItem[] | null>(null);
  // Selecting several, in either layout. A change of layout, privacy domain or filtered view ends it.
  const selection = useGallerySelection(renderedGallery, JSON.stringify([phone, hiddenSpace, hiddenLocked, mode, gallerySearch]));
  useHistoryDismiss(Boolean(phone && selection.selecting), selection.end);
  const phoneTiles = React.useMemo(() => phone ? { onLongPress: openTileActions } : null, [phone, openTileActions]);
  // Zen shows one image at a time: a search there would narrow a strip with nothing to say so.
  React.useEffect(() => {
    if (!prefs.zenMode) return;
    setSearchOpen(false);
    if (searchActive(gallerySearch)) setGallerySearch(emptySearch);
  }, [prefs.zenMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSearch = React.useCallback(() => {
    setSearchOpen(true);
    document.querySelector<HTMLInputElement>('.gallery-search input, .phone-searchbar input')?.focus();
  }, []);
  useGallerySearchKeys(!prefs.zenMode && !hiddenLocked, openSearch);
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
  // The viewer offers Animate and Extend Video only where a first-frame video profile can run them.
  const canAnimate = animationProfiles(models?.profiles || []).length > 0;
  // The item actions' handlers read the latest view, so the memoised tiles keep one stable value.
  const liveView = React.useRef(view);
  liveView.current = view;
  const phoneRef = React.useRef(phone);
  phoneRef.current = phone;
  const smartUpscale = prefs.smartUpscale;
  const itemActionHandlers = React.useMemo<ItemActionHandlers>(() => {
    const live = () => liveView.current;
    // On a phone the composer is a sheet: it opens above the viewer with the change in place, so closing it returns there.
    const compose = () => { if (phoneRef.current) setPhoneCreate(true); };
    return {
      showToast: (...args) => live().showToast(...args),
      smartUpscale,
      upscaleBusy: (item) => Boolean(live().upscaleBusyIds?.has(item.id)),
      upscale: (item) => live().activateUpscale(item),
      cancelUpscale: (item) => live().cancelUpscale(item),
      copyPrompt: (item, announce) => live().copyToClipboard(item.prompt || "", announce),
      copyItem: (item) => live().copyItemToClipboard(item),
      reuse: (item) => { live().applyAllSettings(item); compose(); },
      promptsOnly: (item) => { live().applyPromptsOnly(item); compose(); },
      useAsReference: canUseStartImage ? (item) => {
        live().useOutputAsStartImage(item);
        if (phoneRef.current) { live().setActive(null); setPhoneCreate(true); }
      } : undefined,
      animate: canAnimate ? (item) => setAnimationItems([item]) : undefined,
      hide: (item) => live().hideItems([item]),
      unhide: (item) => live().unhideItems([item]),
      remove: (item) => live().deleteItem(item),
      star: (item) => live().toggleFavorite([item], !item.favorite),
      animateItems: (items) => setAnimationItems(items),
      starItems: (items, favorite) => live().toggleFavorite(items, favorite),
      hideItems: (items) => live().hideItems(items),
      unhideItems: (items) => live().unhideItems(items),
      removeItems: (items) => live().deleteItems(items),
    };
  }, [smartUpscale, canUseStartImage, canAnimate]);
  const hiddenCount = hiddenSpace ? renderedGallery.filter((item: GalleryItem) => item.status === "done").length : 0;
  const hiddenLockScreen = (
    <AnimatePresence>
      {hiddenLocked ? <HiddenLockScreen key="lock" hidden={hidden} onLeave={() => hidden.setSpace("gallery")} onSetup={() => hidden.ensureReady({ kind: "enter" })} /> : null}
    </AnimatePresence>
  );
  const comfyOffline = comfyStatus && !comfyStatus.connected && !comfyStatus.checking;
  // Back closes the viewer and the workflow gallery rather than leaving the app.
  useHistoryDismiss(Boolean(active), () => setActive(null));
  const viewerRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(viewerRef, Boolean(active));
  useHistoryDismiss(Boolean(workflowGalleryOpen), () => setWorkflowGalleryOpen(false));
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>("general");
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
  // Leaving Hidden setup to pick the output folder comes back to setup afterwards.
  const resumeHiddenSetup = React.useRef(false);
  React.useEffect(() => {
    if (settings || !resumeHiddenSetup.current) return;
    resumeHiddenSetup.current = false;
    if (!hidden.enabled) hidden.setSetupOpen(true);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  // A run opened from somewhere other than its stack (zen, a phone's sheet) is scrolled to once laid out.
  const [focusRun, setFocusRun] = React.useState("");
  const [runSheet, setRunSheet] = React.useState<Run | null>(null);
  const showRunInGallery = React.useCallback((run: Run) => {
    setRunSheet(null);
    if (prefs.zenMode) setZenMode(false);
    setRunOpen(run.id, true);
    setFocusRun(run.id);
  }, [prefs.zenMode, setRunOpen, setZenMode]);
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
  // viewer on another image, zen on an older one, the gallery scrolled away.
  const pendingIds = React.useMemo(() => ((visibleGallery || []) as GalleryItem[]).filter((item) => item.status === "pending").map((item) => item.id), [visibleGallery]);
  const pendingTileOnScreen = useTilesOnScreen(galleryStageRef, !phone && !prefs.zenMode && !active ? pendingIds : []);
  const watchingGeneration = active ? active.status === "pending" : prefs.zenMode ? zenDisplayItem?.status === "pending" : pendingTileOnScreen;
  const generationActivity = useGenerationActivity({
    items: visibleGallery || [],
    enabled: !phone && !hiddenLocked,
    watching: watchingGeneration,
    reveal: (item) => !item.privateVault || hiddenSpace,
    onJump: (item) => {
      if (active) setActive(null);
      if (prefs.zenMode) { selectZenItem(item.id); return; }
      // The run's own tile, wherever it is; the top when it isn't rendered yet.
      window.requestAnimationFrame(() => {
        const tile = galleryStageRef.current?.querySelector(`[data-tile-id="${CSS.escape(String(item.id))}"]`);
        if (tile) tile.scrollIntoView({ block: "center", behavior: "smooth" });
        else galleryStageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
    onView: (item) => openItem(item)
  });
  const [islandsHeight, setIslandsHeight] = React.useState(0);
  const viewerCopy = useCopyFeedback();
  const [compareOpen, setCompareOpen] = React.useState(false);
  // The pictures either side of the open one are fetched ahead, so a swipe lands on one already there.
  useNeighborPrefetch(active || null, (view.viewerGallery || []) as GalleryItem[]);
  // A different image has its own comparison, so never carry the mode over.
  React.useEffect(() => { setCompareOpen(false); }, [active?.id]);
  const viewerWheelRef = useWheelRef<HTMLElement>(wheelViewer);
  // Only Ctrl+wheel (page zoom) is swallowed, so the details panel still scrolls.
  const scrimWheelRef = useWheelRef<HTMLDivElement>((event) => { if (event.ctrlKey) event.preventDefault(); });
  const setViewerNode = React.useCallback((node: HTMLDivElement | null) => {
    viewerRef.current = node;
    return scrimWheelRef(node);
  }, [scrimWheelRef]);
  // A plain wheel scrolls the zen thumbnail strip sideways.
  useHorizontalWheel(zenStripRef, Boolean(prefs.zenMode && zenGallery.length && zenGalleryOpen));
  // .bottom-fade is fixed and full width: keep it off the gallery's scrollbar.
  React.useEffect(() => {
    const gallery = galleryStageRef.current as HTMLElement | null;
    if (prefs.zenMode || !gallery) return;
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
  }, [prefs.zenMode]);
  // One compact dock, bottom right, in both layouts. Transient actions (tidy up,
  // cancel queue) rise above it as small chips, so the dock never changes size.
  const dockChip = { initial: { opacity: 0, y: 8, scale: 0.94 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 6, scale: 0.96 }, transition: { type: "spring" as const, duration: 0.34, bounce: 0 } };
  const studioDockRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const dock = studioDockRef.current;
    const shell = dock?.closest<HTMLElement>('.app-shell, .zen-shell');
    if (!dock || !shell) return;
    const measure = () => shell.style.setProperty('--studio-dock-w', `${dock.offsetWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => { observer.disconnect(); shell.style.removeProperty('--studio-dock-w'); };
  }, [phone, prefs.zenMode]);

  const studioDock = (
    <div className="studio-dock" ref={studioDockRef}>
      <div className="dock-transients">
        <AnimatePresence initial={false}>
          {phoneDevice && prefs.fullStudioOnPhone ? (
            // Chose the full studio on a phone: the way back stays in plain sight.
            <motion.div key="simple" {...dockChip}>
              <button type="button" className="dock-chip" onClick={() => setPrefs({ fullStudioOnPhone: false })}>
                <Smartphone size={14} />
                <span>Simple view</span>
              </button>
            </motion.div>
          ) : null}
          {runningCount ? (
            <motion.div key="cancel" {...dockChip}>
              <Tip content="Stop everything running and queued" side="left">
                <button type="button" className="dock-chip is-cancel" onClick={cancelQueue}>
                  <CircleStop size={14} />
                  <span>Stop</span>
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
      {prefs.zenMode ? (
        <Tip content="Exit Zen (Esc)"><button className="icon-button" aria-label="Exit Zen" onClick={() => setZenMode(false)}><Minimize2 size={16} /></button></Tip>
      ) : null}
    </div>
  );
  const hiddenBar = (
    <AnimatePresence>
      {hiddenSpace && !hiddenLocked ? (
        <motion.div
          key="hidden-bar"
          className="hidden-bar"
          initial={{ opacity: 0, y: -10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
        >
          <Tip content="Back to the Gallery"><button type="button" data-hidden-exit className="hidden-bar-back" aria-label="Back to the Gallery" onClick={toggleHiddenSpace}><ArrowLeft size={14} /></button></Tip>
          <span className="hidden-bar-title"><LockKeyhole size={13} /> Hidden{hiddenCount ? <i><AnimatedNumber value={hiddenCount} /></i> : null}</span>
          <Tip content="Lock Hidden"><button type="button" className="hidden-bar-lock" onClick={() => hidden.lock(true)}><Lock size={12} /> Lock</button></Tip>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
  // The gallery, its empty and offline stages and the lock: the same in every layout.
  const galleryBody = (
    <>
          {hiddenLocked || galleryCrossing ? <section className="gallery" /> : !galleryLoaded ? <section className="gallery virtual-gallery" style={{ "--gallery-columns": galleryColumnCount } as React.CSSProperties}><GallerySkeleton columns={galleryColumnCount} /></section> : renderedGallery.length ? (
            <StableGallery
              key={`${hiddenSpace ? "hidden" : "gallery"}:${mode}`}
              cancelJob={cancelJob}
              groups={galleryGroups}
              moments={features.moments && prefs.showMoments}
              stackRuns={stackRuns}
              openRuns={openRuns}
              settleVersion={view.settleVersion}
              stackStyle={prefs.runStackStyle === "flow" ? "flow" : "burst"}
              setRunOpen={setRunOpen}
              onUnstack={unstackRun}
              onStackPress={phone ? setRunSheet : undefined}
              focusRun={focusRun}
              onFocused={() => setFocusRun("")}
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
              upscaleNotices={upscaleNotices}
              onDismissUpscaleNotice={dismissUpscaleNotice}
              titleFromPrompt={titleFromPrompt}
            />
          ) : searchOn ? (
            <SearchEmpty search={gallerySearch} hiddenSpace={Boolean(hiddenSpace)} onClear={() => { setGallerySearch(emptySearch); setSearchOpen(false); }} />
          ) : hiddenSpace && !comfyOffline ? (
            <section className="gallery"><div className="empty stage-empty hidden-empty">
              <div className="stage-mark"><LockMark className="stage-layer" stage="open" /></div>
              <div className="stage-copy">
                <h2>Nothing Hidden Yet</h2>
                <p>Generate here, or hide images from the gallery with <EyeOff size={13} className="inline-icon" />.</p>
              </div>
            </div></section>
          ) : (
            <EmptyStage
              known={Boolean(comfyStatus?.checked)}
              offline={Boolean(comfyOffline) || Boolean(comfyStatus?.restarting)}
              restarting={Boolean(comfyStatus?.restarting)}
              device={comfyStatus?.device}
              retrying={Boolean(comfyRetrying)}
              onRetry={retryComfyStatus}
              onOpenConnection={() => openSettings("connection")}
              comfyUrl={comfyStatus?.url || health?.comfyUrl}
              nearby={comfyStatus?.nearby}
              onNoComfy={() => setNoComfyOpen(true)}
              noModels={Boolean(models) && !modelProfiles?.length}
              onFindModels={modelFolders?.openDialog}
              starter={mode === "image" ? starterModels : undefined}
            />
          )}
            {hiddenLockScreen}
          {renderedGallery.length && !hiddenLocked ? <ConnectedCard at={comfyReconnectedAt} device={comfyStatus?.device} /> : null}
            {galleryLoaded && hasMoreGallery && !hiddenSpace ? (
              <button className="gallery-load-more" onClick={loadMoreGalleryItems}>
                Load more
              </button>
            ) : null}
    </>
  );

  const imageZoomControls = <ViewerZoomControls zoom={viewerZoom} nativeZoom={view.viewerNativeZoom || 1} onZoom={zoomViewer} onNative={() => resetViewer()} onFit={view.fitViewer} />;
  const composer = (
          <ExpandingComposer expanded={composerExpanded} onExpandedChange={setComposerExpanded}>
            <div className="composer-prompt-row">
              <PromptField kind="positive" value={prompt} textareaRef={zenPromptRef} ariaLabel={hiddenSpace ? "Prompt (Hidden)" : "Prompt"} onKeyDown={promptKeyDown} onChange={(value) => setPrompt(clampText(value, promptLimit))} onClear={() => setPrompt("")} historyAvailable={hasPromptHistory} historyOpen={historyOpen && historyKind === 'positive'} onHistory={toggleHistory} />
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
              onAdvanced={() => setAdvancedOpen(true)}
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
              hiddenSpace={Boolean(hiddenSpace)}
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
              referenceInpaint={referenceInpaint}
              referenceRole={referenceRole}
              loraMismatch={view.loraMismatch}
              onDismissLoraMismatch={view.dismissLoraMismatch}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "It’s removed from uploads.", action: "Delete", destructive: true })}
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
    <HiddenActionsContext.Provider value={hiddenActions}>
    <TileLongPressContext.Provider value={phoneTiles}>
    <ItemActionsContext.Provider value={itemActionHandlers}>
    <GallerySelectionContext.Provider value={selection}>
    <FavoriteContext.Provider value={toggleFavorite}>
    <GenerationProfiles.Provider value={models?.profiles || noProfiles}>
    <div className={cn(phone ? "phone-shell" : prefs.zenMode ? "zen-shell" : "app-shell", canUseNegativePrompt && "negative-open", hiddenSpace && "is-hidden-space", hiddenLocked && "is-hidden-locked", !hiddenLocked && (searchOpen || searchOn) && "is-searching", passageClass)} style={!phone ? { "--islands-h": `${islandsHeight ? islandsHeight + 8 : 0}px` } as React.CSSProperties : undefined}>
      {phone ? <RunSheet run={runSheet} onClose={() => setRunSheet(null)} openItem={openItem} onShowInGallery={showRunInGallery} /> : null}
      {phone ? (
        <PhoneShell
          view={{ ...view, lorasOpen, openLoras: () => setLorasOpen(open => !open), phoneSearchOpen: searchOpen, setPhoneSearchOpen: setSearchOpen, openSettings }}
          galleryBody={galleryBody}
          canUseNegativePrompt={canUseNegativePrompt}
          comfyOffline={Boolean(comfyOffline)}
          hiddenLocked={Boolean(hiddenLocked)}
          toggleHiddenSpace={toggleHiddenSpace}
          createOpen={phoneCreate}
          setCreateOpen={setPhoneCreate}
          actionsFor={phoneActionsFor}
          setActionsFor={setPhoneActionsFor}
          selection={selection}
        />
      ) : prefs.zenMode ? (
        <>
          <div className="zen-stage">
            {hiddenLocked ? null : zenDisplayItem?.run ? (
              <RunCard key={zenDisplayItem.run.id} run={zenDisplayItem.run} onOpen={() => showRunInGallery(zenDisplayItem.run)} />
            ) : zenDisplayItem ? (
              <button
                aria-label={zenDisplayItem.status === "pending" ? "Generating" : "Open in the viewer"}
                className={cn("zen-output", viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging", zenDisplayItem.status === "pending" && "is-pending")}
                onClick={() => {
                  if (zenDisplayItem.status === "pending") return;
                  if (Date.now() - viewerDragEndRef.current < 220) return;
                  if (viewerDragRef.current?.moved) return;
                  openItem(zenDisplayItem);
                }}
                ref={viewerWheelRef}
                onPointerDown={startViewerDrag}
                onPointerMove={dragViewer}
                onPointerUp={stopViewerDrag}
                onPointerCancel={stopViewerDrag}
                onTouchStart={startViewerTouch}
                onTouchMove={moveViewerTouch}
                onTouchEnd={endViewerTouch}
                onTouchCancel={endViewerTouch}
                style={{ "--tile-ratio": `${zenDisplayItem.width || 1} / ${zenDisplayItem.height || 1}`, "--zoom": viewerZoom, "--pan-x": `${viewerPan.x}px`, "--pan-y": `${viewerPan.y}px` } as React.CSSProperties}
              >
                <GenerationMedia item={zenDisplayItem} muted fit="contain">
                {zenDisplayItem.status === "pending" ? <GenerationProgress item={zenDisplayItem} formatElapsed={formatElapsed} /> : null}
                </GenerationMedia>
              </button>
            ) : galleryCrossing ? null : !galleryLoaded ? (
              <div className="zen-empty skeleton-stage">
                <Skeleton className="skeleton-logo" />
              </div>
            ) : hiddenSpace ? (
              <div className="zen-empty hidden-empty">
                <div className="stage-mark"><LockMark className="stage-layer" stage="open" /></div>
                <p>Nothing Hidden Yet</p>
              </div>
            ) : (
              <div className="zen-empty">
                <img src="/heiss-mark-white.svg" alt="Studio" />
              </div>
            )}
            {hiddenLockScreen}
            <div className="zen-fade" />
            <div className="bottom-fade" />
          </div>
          {zenGallery.length > 1 ? (
            <div className="zen-arrows">
              <Tip content="Previous Output"><button aria-label="Previous Output" onClick={() => moveZen(-1)}><ChevronLeft size={22} /></button></Tip>
              <Tip content="Next Output"><button aria-label="Next Output" onClick={() => moveZen(1)}><ChevronRight size={22} /></button></Tip>
            </div>
          ) : null}
          {zenItem && !zenItem.run ? (
            <div className={cn("zen-zoom-dock", zenControls && "with-side")}>
              {zenDisplayItem.type === "image" ? imageZoomControls : null}
            </div>
          ) : null}
          {zenGallery.length && !zenGalleryOpen ? (
            <Tip content="Show Gallery"><button data-open-trigger className="zen-gallery-restore" aria-label="Show Gallery" onClick={() => setZenGalleryOpen(true)}>
              <ChevronDown size={16} />
            </button></Tip>
          ) : null}
          {studioDock}
          {hiddenBar}
          {composer}
          {zenGallery.length && zenGalleryOpen && !hiddenLocked ? (
            <div data-open-surface className="zen-gallery-wrap">
              <Tip content="Hide Gallery"><button className="zen-gallery-toggle" aria-label="Hide Gallery" onClick={() => setZenGalleryOpen(false)}><ChevronUp size={16} /></button></Tip>
              {zenGallery[0]?.id !== zenItem?.id ? <Tip content="Jump to latest output"><button className="zen-latest" onClick={goLatestZen}>Latest</button></Tip> : null}
              <ZenStrip
                items={zenGallery}
                activeId={zenItem?.id}
                stripRef={zenStripRef}
                onPointerDown={startZenStripDrag}
                onPointerMove={dragZenStrip}
                onPointerUp={stopZenStripDrag}
                onSelect={selectZenItem}
                titleFromPrompt={titleFromPrompt}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <main ref={galleryStageRef} className="stage-gallery" onScroll={onGalleryScroll} onWheel={view.onGalleryUserScroll} onTouchStart={view.onGalleryUserScroll}>
            <GalleryManagement selection={selection} modeSelector={<div className="gallery-generation-mode mode-tabs" role="group" aria-label="Gallery Mode">
              {(["image", "video"] as const).map((nextMode) => (
                <button key={nextMode} type="button" aria-pressed={mode === nextMode} className={cn(mode === nextMode && "active")} onClick={() => view.changeMode(nextMode)}>
                  {nextMode === "image" ? "Images" : "Videos"}
                </button>
              ))}
            </div>} search={<GallerySearchBar onToggleHidden={toggleHiddenSpace} search={gallerySearch} setSearch={setGallerySearch} count={hiddenSpace ? renderedGallery.length : view.galleryTotalApprox} open={searchOpen} setOpen={setSearchOpen} hiddenSpace={Boolean(hiddenSpace)} items={renderedGallery} />} showToolbar={!hiddenLocked} tools={<>{renderedGallery.some((item: GalleryItem) => item.type === 'video') ? <GridAutoplayButton labelled /> : null}<StackRunsButton labelled on={Boolean(prefs.stackRuns)} disabled={searchOn} onToggle={() => setPrefs({ stackRuns: !prefs.stackRuns })} /></>}>{galleryBody}</GalleryManagement>
            <div className="bottom-fade" />
          </main>
          {studioDock}
          {hiddenBar}
          {composer}
        </>
      )}
      {settings ? <React.Suspense fallback={<Modal open title="Settings" onOpenChange={(open) => { if (!open) setSettings(false); }}><p role="status">Opening settings…</p></Modal>}><SettingsDialog view={view} open={Boolean(settings)} section={settingsSection} onSectionChange={setSettingsSection} onClose={() => setSettings(false)} onGetModels={thisComputer ? () => { setSettings(false); openGetModels(); } : undefined} /></React.Suspense> : null}
      <NoComfySheet open={noComfyOpen} onOpenChange={setNoComfyOpen} onChangeAddress={thisComputer ? () => openSettings("connection") : undefined} />
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
      <FeedbackHost />
      {advancedOpen ? <Modal open title="Advanced Settings" className="composer-advanced-modal" onOpenChange={setAdvancedOpen}><div className="composer-advanced-body">{view.grokMediaControls}{view.phoneVideoDurationControls}{view.phoneAdvancedControls}</div></Modal> : null}
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
        onOpenLibrary={() => { upscaleSetup.closeSetup(); openSettings("library"); }}
        showToast={showToast}
      />
      <ActivityColumn activities={[upscaleActivity, modelActivity, generationActivity]} onHeight={setIslandsHeight} />
      <HiddenSetupDialog hidden={hidden} comfyOnline={Boolean(comfyStatus?.connected)} comfyUrl={health?.comfyUrl} onRecheck={refreshComfyStatus} onDone={() => { if (!hidden.intent || hidden.intent.kind === "enter") hidden.setSpace("hidden"); }} onChooseFolder={() => { resumeHiddenSetup.current = true; hidden.setSetupOpen(false); openSettings("library"); }} />
      <HiddenUnlockSheet hidden={hidden} />
      {active ? (() => {
        const hasNeighbors = ((view.viewerGallery || []) as GalleryItem[]).length > 1;
        // What made this output, at the top of its preview: the profile it ran
        // through, then the settings worth seeing without opening Details.
        const activeProfile = (models?.profiles || []).find((profile: { id: string }) => profile.id === active.settings?.profileId) || null;
        const profileTitle = activeProfile?.displayName || activeProfile?.label || active.settings?.modelName || active.model || "Generation";
        const profileDetail = [
          active.width && active.height ? `${active.width} × ${active.height}` : "",
          active.type === "video" && active.settings?.duration ? `${active.settings.duration} s` : "",
          active.settings?.steps ? `${active.settings.steps} steps` : "",
          active.settings?.cfg ? `CFG ${active.settings.cfg}` : "",
          [active.settings?.sampler, active.settings?.scheduler].filter(Boolean).join(" / "),
          active.settings?.seed && active.settings.seed !== "Random" ? `Seed ${active.settings.seed}` : "",
          active.durationMs ? formatElapsed(active.durationMs) : ""
        ].filter(Boolean).join(" · ");
        return (
          <div className="scrim" role="dialog" aria-modal="true" aria-label="Image Viewer" data-focus-trap tabIndex={-1} onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - viewerDragEndRef.current < 200) return;
            setActive(null);
          }} ref={setViewerNode}>
            <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
              <div className={cn("viewer-stage", showDetails && "with-side")} data-viewer-empty>
                <header className="viewer-profile-summary" data-open-surface>
                  <strong>{profileTitle}</strong>
                  {profileDetail ? <span>{profileDetail}</span> : null}
                </header>
                <div
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
                  {active.status === "error" ? <FailurePanel item={active} onCopy={copyToClipboard} onReuse={() => applyAllSettings(active)} fixes={view.failureFixes} showToast={showToast} onNodesInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : compareOpen && active.upscale?.url && !upscaledWithRun(active) ? <UpscaleCompare item={active} zoomed={viewerZoom > 1} /> : (
                  <GenerationMedia item={active} fit="contain">
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
                    </div>
                    <div className="viewer-side-body">
                      <div className="prompt-readout">
                        <span>Prompt</span>
                        <div className="readout-box">
                          <p>{active.prompt || "No prompt recorded"}</p>
                          <Tip content="Copy Prompt"><button className="readout-copy" aria-label="Copy Prompt" onClick={() => viewerCopy.copyWith(() => copyToClipboard(active.prompt || ""), "prompt")}><CopyIcon copied={viewerCopy.copied === "prompt"} size={13} /></button></Tip>
                          <Tip content="Use Prompt"><button type="button" className="readout-copy readout-use" aria-label="Use Prompt" disabled={!active.prompt} onClick={() => { setPrompt(clampText(active.prompt || "", promptLimit)); showToast("Prompt applied."); }}><Wand2 size={13} /></button></Tip>
                        </div>
                      </div>
                      {active.negative ? (
                        <div className="prompt-readout">
                          <span>Negative</span>
                          <div className="readout-box">
                            <p>{active.negative}</p>
                            <Tip content="Copy Negative Prompt"><button className="readout-copy" aria-label="Copy Negative Prompt" onClick={() => viewerCopy.copyWith(() => copyToClipboard(active.negative || ""), "negative")}><CopyIcon copied={viewerCopy.copied === "negative"} size={13} /></button></Tip>
                            <Tip content="Use Negative Prompt"><button type="button" className="readout-copy readout-use" aria-label="Use Negative Prompt" disabled={!active.negative} onClick={() => { setNegative(clampText(active.negative || "", negativeLimit)); showToast("Negative prompt applied."); }}><Wand2 size={13} /></button></Tip>
                          </div>
                        </div>
                      ) : null}
                      {/* On a phone the composer is a sheet: each of these opens it with the change in place, as Reuse does. */}
                      <ViewerActions
                        item={active}
                        onUseSettings={() => applyAllSettings(active)}
                        onUseLoras={() => applyLoras(active)}
                        onUseAsReference={canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked && !active.library ? () => useOutputAsStartImage(active) : undefined}
                      />
                      {generationDetailEntries(active).length ? (
                        <section className="settings-disclosure">
                          <div className="detail-heading"><h3>Generation Settings</h3><button type="button" className="detail-copy" aria-label="Copy Generation Settings" onClick={() => viewerCopy.copyWith(() => copyToClipboard(settingsText(active)), "settings")}><CopyIcon copied={viewerCopy.copied === "settings"} size={13} /><span>{viewerCopy.copied === "settings" ? "Copied" : "Copy as Text"}</span></button></div>
                          {generationDetailEntries(active).map((section: GenerationDetailSection) => (
                            <div className="detail-section" key={section.title}>
                              <h4>{section.title}</h4>
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
                                      <span className="detail-lora-name" title={lora.name}>{lora.name}</span>
                                      <i aria-hidden="true" />
                                      <span className="detail-lora-strength" aria-label={`strength ${lora.strength}`}>{lora.strength}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ))}
                        </section>
                      ) : null}
                    </div>
                  </aside>
                ) : null}
                {phone ? (
                  <>
                    {upscaleNotices?.get(active.id) ? (
                      <div className="viewer-phone-notice"><UpscaleNoticePopover notice={upscaleNotices.get(active.id)} placement="viewer" onDismiss={() => dismissUpscaleNotice(active.id)} /></div>
                    ) : null}
                    {active.type === "image" && !showDetails ? <div className="viewer-phone-zoom">{imageZoomControls}</div> : null}
                    <PhoneViewerBar
                      item={active}
                      showDetails={Boolean(showDetails)}
                      onToggleDetails={() => setShowDetails((value: boolean) => !value)}
                      compare={{ open: compareOpen, toggle: () => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer('fit'); } }}
                    />
                  </>
                ) : (
                <div data-open-trigger className={cn("viewer-dock", showDetails && "with-side")}>
                  {active.type === "image" ? imageZoomControls : null}
                  <span className="viewer-divider is-zoom-control" />
                  <ViewerDockActions
                    item={active}
                    compare={{ open: compareOpen, toggle: () => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer(); } }}
                    upscaleNotice={upscaleNotices?.get(active.id)}
                    onDismissUpscaleNotice={() => dismissUpscaleNotice(active.id)}
                  />
                  <span className="viewer-divider" />
                  <Tip content={showDetails ? "Hide Details" : "Show Details"}><button className={cn("icon-button", showDetails && "active")} aria-label="Toggle Details" aria-pressed={showDetails} onClick={() => setShowDetails((value: boolean) => !value)}><SlidersHorizontal size={15} /></button></Tip>
                  <Tip content="Close (Esc)"><button className="icon-button viewer-dock-close" aria-label="Close" onClick={() => setActive(null)}><X size={16} /></button></Tip>
                </div>
                )}
                {/* Phones and tablets: the dock has no room for Close, so it sits in the corner. */}
                <button className="viewer-close" aria-label="Close Viewer" onClick={() => setActive(null)}><X size={18} /></button>
              </div>
            </div>
          </div>
        );
      })() : null}
      {models?.features?.presets === true && view.presetLibraryOpen ? <React.Suspense fallback={<Modal open title="Image & Model Library" onOpenChange={() => view.setPresetLibraryOpen(false)}><p role="status">Opening presets…</p></Modal>}><PresetLibrary onClose={() => view.setPresetLibraryOpen(false)} models={models} refreshModels={refreshModels} onApply={view.applyImagePreset} onPrompt={view.applyPresetPrompt} showToast={showToast} confirmAction={confirmAction} /></React.Suspense> : null}
      {workflowGalleryOpen ? <React.Suspense fallback={<Modal open title="Workflow Gallery" onOpenChange={(open) => { if (!open) setWorkflowGalleryOpen(false); }}><p role="status">Opening workflows…</p></Modal>}><WorkflowGallery view={{ ...view, onClose: () => setWorkflowGalleryOpen(false) }} /></React.Suspense> : null}
      {/* Generation progress for screen readers: started, rendering, ready. */}
      <div className="sr-only" role="status" aria-live="polite">{view.status && view.status !== "Ready" && !/^Rendering|^Queued/.test(view.status) ? view.status : ""}</div>
      {/* Portaled to <body>: inside the fixed shell it would sit under every dialog's scrim. */}
      <Toaster offset={islandsHeight ? islandsHeight + 8 : 0} />
    </div>
    </GenerationProfiles.Provider>
    </FavoriteContext.Provider>
    </GallerySelectionContext.Provider>
    </ItemActionsContext.Provider>
    </TileLongPressContext.Provider>
    </HiddenActionsContext.Provider>
    </GenerationPreviewMode.Provider>
  );
}
