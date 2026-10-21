// First: browser storage under its old HEISS UI names moves to Studio's before anything reads it.
import "./app/storageMigration";
import "./app/domGuard";
import { withReferenceChains } from "../server/reference-chains.js";
import { sameLoraFamily } from "../server/lora-policy.js";
import { isQueuedItem } from "./app/GalleryViewControls";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { showToastTone as showToast } from "./app/toast";
import "./styles.css";

import { useComposerState } from "./app/useComposerState";
import { useModelFolders } from './app/useModelFolders';
import { usePreferences } from './app/usePreferences';
import { useComfyStatus } from './app/useComfyStatus';
import { useStarterPick } from './app/useStarterPick';
import { OPEN_DIALOG, useAppKeys, useLoraSync, useWindowGuards } from './app/useAppEffects';
import { copyItemToClipboard, copyToClipboard } from './app/clipboardNotices';
import type { AutoUpscale, GalleryItem, LoraSelection, MediaInput, Mode, Models, Paths, Profile, ReferenceAsset, ReferenceInpaint, ReferenceRole, ReferenceRoleControl, SelectedReferenceAsset, TouchGesture, WorkflowPreferences, WorkflowSummary } from './app/types';
import { fallbackAspectPresets } from './app/constants';
import { statusForProfile } from "./app/backendStatus";
import { clampProfileCount, generationPlan, imageDimension, profileCountRange, profileImageCount, profileImageSize, referenceImageSize } from './app/generationOptions';
import { canRestoreLoras, composerSettings, modePrompts, modeSettings, modeReferences, savedModeReferences } from './app/composerSettings';
import { loraName } from './app/catalogueNames';
import { apiJson, loadDraft, referenceAssetFromGallery, saveDraft } from './app/api';
import { characterMeta, clampText, formatElapsed, generationDetailEntries, settingMax, textLength, titleFromPrompt } from './app/format';
import { useGalleryColumnCount } from './app/gallery';
import { normalizeLoras } from './app/loras';
import { arrangeReferences, referenceRoleFor, referenceRoleOffered, withReference, withoutReferences } from './app/referenceSlots';
import { deleteLoraStack, restoreLoraStack, loraFamilyKey, loraFavorites, loraRecents, loraStacks, recordLoraRecents, rememberActiveLoras, rememberedLoraStrength, rememberLoraStrengths, renameLoraStack, saveLoraStack, toggleLoraFavorite, updateLoraStack, type LoraSnapshot } from './app/lora-storage';
import { useConfirmation } from './app/useConfirmation';
import { StudioView } from './app/StudioView';
import { DeviceGate } from './app/DeviceGate';
import { CrashBoundary } from './app/CrashScreen';
import { TooltipProvider } from './components/ui/tooltip';
import { setShareSettings } from './app/shareSettings';
import { validVideoFrames } from './app/videoDuration';
import { ModelLoraControls, PhoneAdvancedControls } from './app/SidebarControls';
import { useGenerationActions } from './app/useGenerationActions';
import { loraFit, useLoraInfo } from './app/useLoraInfo';
import type { LoraMismatch } from './app/LoraMismatchChip';
import { useViewerControls } from './app/useViewerControls';
import { useGalleryGroups } from './app/useGalleryGroups';
import { viewerOrder } from './app/viewerOrder';
import { useUnstackedRuns } from './app/useUnstackedRuns';
import { useRunSettling } from './app/useRunSettling';
import { runTitle, type Run } from './app/runs';
import { useGalleryStore } from './app/useGalleryStore';
import { emptySearch, searchActive, useFavorites, type GallerySearch } from './app/favorites';
import { sizePlan, tiledDecodeFor, upscaleDisplayUrl, upscaleSize, useUpscale } from './app/useUpscale';
import { closestPreset, fitRatio, MEGAPIXEL, snapSide } from './app/sizing';
import type { MegapixelControl, SizeTier } from './app/SizeMenu';
import { useVisibleInterval } from './hooks/use-visible-interval';
import { useKeyboardInset } from './hooks/use-keyboard-inset';
import { useArrowKeyGroups } from './hooks/use-arrow-key-groups';
import { useGenerationEstimate } from './app/useGenerationEstimate';
import { listNames, setComfyRestartClock, setComfyRestartResult, setComfyRestarting } from './app/ComfyRestart';
import { memoLatest } from './lib/memo-latest';
import { refreshHardware } from './app/hardware';
import { generateShortcut } from './app/shortcuts';
import { presetFit, type ImagePreset } from './app/presets';

// Rebuilt from scratch on every App render (each keystroke in the prompt); skips unless its data changed.
const StableModelLoraControls = memoLatest(ModelLoraControls);
const StablePhoneAdvancedControls = memoLatest(PhoneAdvancedControls);

/** Custom's range for one side: 256 to 4096, on the model's step or 16, whichever is coarser. */
function customSideLimits(meta: Record<string, number> = {}) {
  return { min: 256, max: Math.min(Number(meta.max) || 4096, 4096), step: Math.max(Number(meta.step) || 0, 16) };
}

function imageInputsForProfile(profile: Profile | null | undefined): MediaInput[] {
  if (!profile) return [];
  const declared = (profile.mediaInputs || []).filter((input) => input.kind === "image");
  // Video models take a picture only when they declare it (image-to-video's start image).
  if (declared.length) return declared;
  if (profile.kind !== "image") return [];
  // Edit models read a reference; everything else can only start from a picture and redraw it.
  if (profile.capabilities.imageToImage) {
    return [{ id: "reference", kind: "image", required: true, min: 1, max: 1, label: "Reference Image", role: "reference" }];
  }
  if (profile.capabilities.startImage) {
    return [{ id: "reference", kind: "image", required: false, min: 0, max: 1, label: "Start Image", role: "start" }];
  }
  return [];
}


// Another dialog on top owns the keyboard. The viewer is a dialog too, but it is
// the surface these shortcuts drive, so it does not count (data-focus-trap).

function App() {
  useKeyboardInset();
  useArrowKeyGroups();
  const now = Date.now();
  const initialDraft = useMemo(() => loadDraft(), []);
  const { prefs, setPrefs } = usePreferences();
  const {
    mode, setMode,
    prompt, setPrompt,
    negative, setNegative,
    model, setModel,
    textEncoder, setTextEncoder,
    textEncoders, setTextEncoders,
    vae, setVae,
    clipType, setClipType,
    weightDtype, setWeightDtype,
    width, setWidth,
    height, setHeight,
    steps, setSteps,
    cfg, setCfg,
    denoise, setDenoise,
    inpaintMask, setInpaintMask,
    inpaintStrength, setInpaintStrength,
    inpaintFeather, setInpaintFeather,
    seed, setSeed,
    count, setCount,
    frames, setFrames,
    fps, setFps,
    duration, setDuration,
    resolution, setResolution,
    sampler, setSampler,
    scheduler, setScheduler,
    loras, setLoras,
    customSize, setCustomSize,
    startImage, setStartImage,
    startImageId, setStartImageId,
    startImageName, setStartImageName,
    referenceAssets, setReferenceAssets,
  } = useComposerState(initialDraft, prefs);
  const [models, setModels] = useState<Models | null>(null);
  const { health, backendStatus, comfyRetrying, refreshHealth, refreshComfyStatus, retryComfyStatus } = useComfyStatus({ refreshModels });
  // Read by every download link and share as it is made (shareSettings.ts); kept in step here.
  setShareSettings(prefs);
  const comfyStatus = statusForProfile(backendStatus, { kind: mode, family: models?.profiles.find((profile) => profile.id === model)?.family });
  const primaryConnected = backendStatus.backends?.primary?.connected ?? backendStatus.connected;
  const [paths, setPaths] = useState<Paths>({});
  const [loraSnapshotRevision, setLoraSnapshotRevision] = useState(0);
  const advanced = true;
  const [settings, setSettings] = useState(false);
  const [showNegativePrompt, setShowNegativePrompt] = useState(Boolean(initialDraft.showNegativePrompt));
  const [status, setStatus] = useState("Ready");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowPreferences, setWorkflowPreferences] = useState<WorkflowPreferences>({ favorites: [], lastUsed: {}, thumbnails: {} });
  const [workflowGalleryOpen, setWorkflowGalleryOpen] = useState(false);
  const [presetLibraryOpen, setPresetLibraryOpen] = useState(false);
  const modelsRefreshRef = useRef<Promise<unknown> | null>(null);
  const [active, setActive] = useState<GalleryItem | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerPan, setViewerPan] = useState({ x: 0, y: 0 });
  const [showDetails, setShowDetails] = useState(Boolean(initialDraft.showDetails));
  const generatePostingRef = useRef(false);
  const viewerDragRef = useRef<{ id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const viewerDragEndRef = useRef<number>(0);
  const [isDraggingViewer, setIsDraggingViewer] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryStageRef = useRef<HTMLElement | null>(null);
  const galleryScroll = useRef<Record<string, number>>({});
  const pendingScroll = useRef<string | null>(null);
  // Set when LoRAs are applied for a workflow we're about to switch to (e.g. "Copy
  // all settings"), so the switch doesn't load that workflow's saved stack over them.
  const explicitLorasFor = useRef(Array.isArray(initialDraft.loras) ? String(initialDraft.model || "") : "");
  const loraEditRevision = useRef(0);
  const composerByMode = useRef(modeSettings(initialDraft));
  const selectedModelRef = useRef(model);
  selectedModelRef.current = model;
  const selectedModeRef = useRef(mode);
  selectedModeRef.current = mode;
  composerByMode.current[mode] = composerSettings({ model, textEncoder, textEncoders, vae, clipType, weightDtype, width, height, steps, cfg, denoise, inpaintStrength, inpaintFeather, seed, count, frames, fps, duration, resolution, sampler, scheduler, loras, customSize });
  const touchGestureRef = useRef<TouchGesture | null>(null);
  // The gallery search: words and the Favourites filter. Lives in memory only, never saved.
  const [gallerySearch, setGallerySearch] = useState<GallerySearch>(emptySearch);
  const lastTapRef = useRef(0);
  const lastTouchRef = useRef(0);
  const {
    gallery,
    visibleGallery,
    renderedGallery,
    galleryLoaded,
    galleryCrossing,
    hasMoreGallery,
    galleryTotalApprox,
    galleryRevision,
    loadGallery,
    loadGalleryDelta,
    loadMoreGalleryItems,
    setGallery,
    upsertGalleryItems,
    removeGalleryItems,
    removeGalleryItemsWhere,
    patchGalleryItems,
  } = useGalleryStore({ mode, showFailedItems: prefs.showFailedItems, search: gallerySearch });
  const toggleFavorite = useFavorites({ patchGalleryItems, removeGalleryItems, setActive, search: gallerySearch, showToast });

  // Moments and runs: a way of looking at the gallery, worked out from what is
  // loaded (runs.js). Runs stack only when asked, and never in search results.
  const stackRuns = Boolean(prefs.stackRuns) && !searchActive(gallerySearch);
  // The Status filter's Hide Queued: only the gallery view drops them; running counts and Stop All still see them.
  const shownGallery = useMemo(() => prefs.hideQueuedItems ? visibleGallery.filter((item) => !isQueuedItem(item)) : visibleGallery, [visibleGallery, prefs.hideQueuedItems]);
  const foundGroups = useGalleryGroups(shownGallery, { runs: stackRuns });
  const { groups: keptGroups, unstack } = useUnstackedRuns(foundGroups);
  // Runs settle rather than snap: a run being worked on stays plain tiles, and
  // folds once it's been quiet and is off screen (useRunSettling).
  const { groups: galleryGroups, settleVersion } = useRunSettling(keptGroups, { enabled: stackRuns, showToast });
  // Which stacked runs are laid out open, on their shelves.
  const [openRuns, setOpenRuns] = useState<Set<string>>(() => new Set());
  const setRunOpen = useCallback((runId: string, open: boolean) => {
    setOpenRuns((current) => {
      if (current.has(runId) === open) return current;
      const next = new Set(current);
      if (open) next.add(runId); else next.delete(runId);
      return next;
    });
  }, []);
  // Taking a run apart for good: its tiles stay separate, with a way back.
  const unstackRun = useCallback((run: Run) => {
    unstack(run, true);
    setOpenRuns((current) => {
      if (!current.has(run.id)) return current;
      const next = new Set(current);
      next.delete(run.id);
      return next;
    });
    showToast(`Unstacked ${runTitle(run)}`, "default", { action: { label: "Undo", onClick: () => { unstack(run, false); setOpenRuns((current) => new Set([...current, run.id])); } } });
  }, [unstack]); // eslint-disable-line react-hooks/exhaustive-deps
  // The viewer steps through the gallery as it is laid out: a stacked run's
  // takes one after another where the stack stands, not wherever they fell in time.
  const viewerGallery = useMemo(() => viewerOrder(shownGallery, stackRuns ? galleryGroups : null, openRuns), [shownGallery, stackRuns, galleryGroups, openRuns]);

  useEffect(() => {
    refreshHealth();
    refreshComfyStatus();
    refreshModels(false);
    refreshWorkflows();
    refreshPaths();
    // A failed first load would leave the skeleton spinning forever: say so, and keep trying.
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const load = () => loadGallery().catch(() => {
      if (cancelled) return;
      attempt += 1;
      if (attempt === 1) showToast("Couldn’t load the gallery. Trying again…", "error");
      timer = window.setTimeout(load, Math.min(15000, 2000 * attempt));
    });
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadGallery]);


  // Keep the current stack within one model family; a different family starts empty.
  // Explicit recreated settings and image/video mode drafts restore their own stacks.
  const lorasModelRef = useRef("");
  useEffect(() => {
    const previous = lorasModelRef.current;
    lorasModelRef.current = model;
    if (!model) return;
    if (explicitLorasFor.current === model) {
      explicitLorasFor.current = "";
      return;
    }
    if (previous) {
      const before = models?.profiles.find(profile => profile.id === previous);
      const after = models?.profiles.find(profile => profile.id === model);
      setLorasWithMemory(sameLoraFamily(before, after) ? current => current : []);
      return;
    }
    let current = true;
    const revision = loraEditRevision.current;
    apiJson<{ found: boolean; loras: LoraSelection[] }>(`/api/loras/${encodeURIComponent(model)}`)
      .then((data) => { if (current && canRestoreLoras(revision, loraEditRevision.current, data.found)) setLoras(normalizeLoras(data.loras)); })
      .catch(() => null);
    return () => { current = false; };
  }, [model]);

  // ComfyUI came back (started late, or restarted): pick everything up again
  // without a reload. Only a real offline → online change counts.
  const wasConnected = useRef<boolean | null>(null);
  const [comfyReconnectedAt, setComfyReconnectedAt] = useState(0);
  // A new ComfyUI version counts too: an update and restart can fall between two checks
  // without ever looking offline, and what it runs may have changed (a model it couldn't before).
  const lastComfyVersion = useRef("");
  useEffect(() => {
    if (!backendStatus.checked) return;
    const previous = wasConnected.current;
    wasConnected.current = backendStatus.connected;
    const version = backendStatus.connected ? backendStatus.version || "" : "";
    const updated = Boolean(version && lastComfyVersion.current && version !== lastComfyVersion.current);
    if (version) lastComfyVersion.current = version;
    if (!updated && (previous !== false || !backendStatus.connected)) return;
    refreshModels(false);
    refreshWorkflows();
    refreshHealth();
    refreshHardware();
    refreshUpscaleStatus(prefs.upscaleQuality, { fresh: true });
    setComfyReconnectedAt(Date.now());
  }, [backendStatus.connected, backendStatus.checked, backendStatus.version]);

  // A restart Studio asked for: every surface says "restarting", the poll speeds
  // up so ComfyUI's return shows at once, and a restart that never comes back
  // hands over to plain reconnecting with one clear message.
  const comfyRestarting = Boolean(comfyStatus.restarting);
  // The restart this device watched, so its end is told here once, and only here.
  const watchedRestart = useRef(0);
  const lastRestart = comfyStatus.lastRestart;
  useEffect(() => {
    if (comfyRestarting && comfyStatus.restartStartedAt) {
      watchedRestart.current = comfyStatus.restartStartedAt;
      setComfyRestartClock({ startedAt: comfyStatus.restartStartedAt, elapsedMs: comfyStatus.restartElapsedMs ?? 0, typicalMs: comfyStatus.restartTypicalMs });
    } else {
      setComfyRestartClock(null);
    }
    if (lastRestart && lastRestart.startedAt === watchedRestart.current) {
      watchedRestart.current = 0;
      setComfyRestartResult(lastRestart);
      if (lastRestart.outcome === "failed") showToast("ComfyUI didn’t come back after the restart. Check its window for errors.", "error");
      else if (lastRestart.failedPacks?.length) showToast(`ComfyUI is back, but ${listNames(lastRestart.failedPacks)} didn’t load. See its window for details.`, "error");
      else if (lastRestart.newPacks?.length) showToast(`ComfyUI is back with ${listNames(lastRestart.newPacks)}.`, "success");
    }
    setComfyRestarting(comfyRestarting);
  }, [comfyRestarting, comfyStatus.restartStartedAt, comfyStatus.restartTypicalMs, lastRestart?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onRestart = () => {
      refreshComfyStatus();
      window.setTimeout(() => refreshComfyStatus(), 1200);
    };
    window.addEventListener("studio:comfy-restart", onRestart);
    return () => window.removeEventListener("studio:comfy-restart", onRestart);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useVisibleInterval(refreshComfyStatus, comfyRestarting ? 1500 : 5000);

  useVisibleInterval(loadGalleryDelta, 2500);

  useWindowGuards(mode);
  useLoraSync(() => setLoraSnapshotRevision((value) => value + 1));
  useAppKeys({ active, setActive, settings, setSettings, workflowGalleryOpen, setWorkflowGalleryOpen, promptRef });

  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(128, Math.max(44, textarea.scrollHeight))}px`;
  }, [prompt]);



  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-open-trigger], [data-open-surface], [data-radix-popper-content-wrapper], [role='listbox'], [role='tooltip']")) return;
      if (active && showDetails && target.closest("[data-viewer-empty]")) setShowDetails(false);
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, showDetails]);




  // Each mode keeps its own prompts and references.
  const modePromptsRef = useRef(modePrompts(initialDraft));
  const promptSelection = useRef(mode);
  if (promptSelection.current === mode) modePromptsRef.current[mode] = { prompt, negative };
  useEffect(() => {
    if (promptSelection.current === mode) return;
    promptSelection.current = mode;
    const next = modePromptsRef.current[mode];
    setPrompt(next.prompt);
    setNegative(next.negative);
  }, [mode]);
  const reusedImage = useRef<Pick<GalleryItem, "id"> | null>(null);
  const referenceEditRevision = useRef(0);
  const [reuseReferencePending, setReuseReferencePending] = useState(false);
  type ModeReference = { assets: SelectedReferenceAsset[]; image: string; id: string; name: string };
  const modeReferencesRef = useRef<Record<Mode, ModeReference>>(modeReferences(initialDraft));
  const referenceSelection = useRef(mode);
  if (referenceSelection.current === mode) {
    modeReferencesRef.current[mode] = { assets: referenceAssets, image: startImage, id: startImageId, name: startImageName };
  }
  useEffect(() => {
    if (referenceSelection.current === mode) return;
    referenceSelection.current = mode;
    const next = modeReferencesRef.current[mode];
    setReferenceAssets(next.assets);
    setStartImage(next.image);
    setStartImageId(next.id);
    setStartImageName(next.name);
  }, [mode]);
  // Each mode keeps its own place in the gallery. The grid measures itself
  // after mount, so the saved position goes back once it has a height to
  // scroll to (two frames, the second after that measurement has landed).
  useEffect(() => {
    if (!galleryLoaded || !pendingScroll.current) return;
    const key = pendingScroll.current;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (pendingScroll.current !== key) return;
        pendingScroll.current = null;
        galleryStageRef.current?.scrollTo({ top: galleryScroll.current[key] || 0, behavior: "instant" });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [galleryLoaded, mode]);
  const draftPrompt = { current: modePromptsRef.current[mode] };
  useEffect(() => {
    const galleryReferences = savedModeReferences(modeReferencesRef.current);
    const galleryReference = galleryReferences[mode];
    const draft = {
      mode,
      modePrompts: { ...modePromptsRef.current },
      modeSettings: { ...composerByMode.current },
      modeReferences: galleryReferences,
      prompt: draftPrompt.current.prompt,
      negative: draftPrompt.current.negative,
      model,
      textEncoder,
      textEncoders,
      vae,
      clipType,
      weightDtype,
      width,
      height,
      steps,
      cfg,
      denoise,
      seed,
      count,
      frames,
      fps,
      duration,
      resolution,
      sampler,
      scheduler,
      loras,
      customSize,
      startImageId: galleryReference.id,
      startImageName: galleryReference.name,
      referenceAssets: galleryReference.assets,
      inpaintStrength,
      inpaintFeather,
      advanced,
      showDetails,
      showNegativePrompt
    };
    const save = () => {
      try {
        saveDraft(draft);
      } catch {
        saveDraft({ ...draft, startImage: "", startImageId: draft.startImageId });
      }
    };
    // Typing changes the draft on every keystroke: write it once typing pauses,
    // and straight away if the page is closed first.
    const timer = window.setTimeout(save, 300);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [mode, prompt, negative, model, textEncoder, textEncoders, vae, clipType, weightDtype, width, height, steps, cfg, denoise, inpaintStrength, inpaintFeather, seed, count, frames, fps, duration, resolution, sampler, scheduler, loras, customSize, startImageId, startImageName, referenceAssets, advanced, showDetails, showNegativePrompt]);

  useEffect(() => {
    if (!active) return;
    const activeItem = active;
    const viewerItems = visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error");
    const currentIndex = viewerItems.findIndex((item) => item.id === activeItem.id);
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector(OPEN_DIALOG)) return;
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-video-viewer]'))) return;
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" && currentIndex >= 0) {
        event.preventDefault();
        setViewerZoom(1);
        setViewerPan({ x: 0, y: 0 });
        setActive(viewerItems[(currentIndex + 1) % viewerItems.length]);
      }
      if (event.key === "ArrowLeft" && currentIndex >= 0) {
        event.preventDefault();
        setViewerZoom(1);
        setViewerPan({ x: 0, y: 0 });
        setActive(viewerItems[(currentIndex - 1 + viewerItems.length) % viewerItems.length]);
      }
      if (activeItem.type === 'image' && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        viewerActions.stepViewer(1);
      }
      if (activeItem.type === 'image' && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        viewerActions.stepViewer(-1);
      }
      if (event.key === "0") {
        event.preventDefault();
        resetViewer();
      }
      // Delete only: Backspace is pressed by reflex to mean "go back".
      if (event.key === "Delete") {
        event.preventDefault();
        deleteItem(activeItem);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, gallery, mode]);

  // The viewer holds the item it opened with; follow the gallery's copy, so an
  // upscale starting, ticking and finishing (or a star) shows while it is open.
  useEffect(() => {
    setActive((current) => {
      if (!current) return current;
      const fresh = gallery.find((item) => item.id === current.id);
      return fresh && fresh !== current ? fresh : current;
    });
  }, [gallery]);

  // Only what can't be undone asks first (UI-PATTERNS › Messages); everything else acts at once.
  const { confirmAction, confirmationDialog } = useConfirmation(false);

  const { upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, toggleUpscale, cancelUpscale, chooseAutoUpscale } = useUpscale({
    gallery,
    prefs,
    showToast,
    loadGalleryDelta,
    patchGalleryItems,
    setPrefs
  });



  function refreshModels(notify = true) {
    const request = apiJson<Models>("/api/models")
      .then((loaded: Models) => {
        // However a profile declares its reference stack, it reaches the composer chained (one References button).
        const data = { ...loaded, profiles: loaded.profiles.map(withReferenceChains) };
        setModels(data);
        const profileId = selectedModelRef.current || "";
        if (!profileId && !notify) {
          const nextMode = selectedModeRef.current;
          const defaultProfile = data.profiles.find((item) => item.id === data.defaults[nextMode === "video" ? "videoModel" : "imageModel"]) || data.profiles.find((item) => item.kind === nextMode);
          if (defaultProfile) applyProfile(defaultProfile);
        }
        if (notify) setStatus("Ready");
      })
      .catch((error) => {
        setStatus(error.message);
        if (notify) showToast("Couldn’t refresh models", "error", { action: { label: "Try Again", onClick: () => refreshModels(true) } });
      });
    modelsRefreshRef.current = request;
    return request;
  }

  function refreshWorkflows() {
    // /api/models asks ComfyUI afresh; /api/workflows reuses that answer, so it waits for a
    // refresh in flight rather than racing it and showing a model as still missing files.
    const pending = modelsRefreshRef.current || Promise.resolve();
    pending.catch(() => null)
      .then(() => apiJson<{ workflows: WorkflowSummary[]; preferences: WorkflowPreferences }>("/api/workflows"))
      .then((data) => {
        setWorkflows(data.workflows || []);
        if (data.preferences) setWorkflowPreferences(data.preferences);
      })
      .catch(() => null);
  }



  function refreshPaths() {
    apiJson<Paths>("/api/paths")
      .then(setPaths)
      .catch(() => null);
  }

  function applyProfile(profile: Profile, setModelId = true) {
    if (setModelId) setModel(profile.id);
    // A custom size is yours, so it stays across models of the same kind, fitted to the new one's limits.
    const keepCustom = customSize && profile.kind === mode && (!referenceAssets.length || referenceRoleOffered(currentProfile));
    if (!keepCustom) setCustomSize(false);
    if (profile.capabilities.duration) setDuration(Number(profile.defaults.duration || 6));
    if (profile.capabilities.resolution) setResolution(String(profile.defaults.resolution || ""));
    setCount(profileImageCount(profile, prefs.defaultImageCount));
    setTextEncoder(String(profile.defaults.textEncoder || ""));
    setTextEncoders((profile.encoderSlots || []).map((slot) => slot.default));
    setVae(String(profile.defaults.vae || ""));
    setClipType(String(profile.defaults.clipType || ""));
    setWeightDtype(String(profile.defaults.weightDtype || "default"));
    if (keepCustom) {
      const fitted = { width: snapSide(width, customSideLimits(profile.constraints?.width)), height: snapSide(height, customSideLimits(profile.constraints?.height)) };
      setWidth(fitted.width);
      setHeight(fitted.height);
      if (fitted.width !== width || fitted.height !== height) {
        showToast(`Custom size fitted to ${profile.displayName || profile.label || "this model"}: ${fitted.width} × ${fitted.height}`, "default");
      }
    } else {
      const size = profileImageSize(profile);
      setWidth(size.width);
      setHeight(size.height);
    }
    setSteps(Number(profile.defaults.steps || profile.constraints?.steps?.default || (profile.kind === "video" ? prefs.defaultVideoSteps : prefs.defaultImageSteps)));
    setCfg(Number(profile.defaults.cfg ?? profile.constraints?.cfg?.default ?? 1));
    setSampler(String(profile.defaults.sampler || "euler_ancestral"));
    setScheduler(String(profile.defaults.scheduler || "beta"));
    setDenoise(Number(profile.defaults.denoise ?? profile.constraints?.denoise?.default ?? 0.65));
    setInpaintStrength(Number(profile.defaults.inpaintStrength ?? 1));
    if (profile.kind === "video") {
      setFrames(Number(profile.defaults.frames || prefs.defaultVideoFrames));
      setFps(Number(profile.defaults.fps || profile.constraints?.fps?.default || prefs.defaultFps));
    }
    if (profile.kind === selectedModeRef.current) applyProfileReferences(profile);
  }

  function applyProfileReferences(profile: Profile) {
    if (!imageInputsForProfile(profile).length) {
      setReferenceAssets([]);
      setStartImage("");
      setStartImageId("");
      setStartImageName("");
    } else {
      const nextInputs = imageInputsForProfile(profile);
      setReferenceAssets((current) => nextInputs.flatMap((input, index) => {
        const compatible = current.find((item) => item.slot === input.id) || (nextInputs.length === 1 && index === 0 ? current[0] : undefined);
        return compatible ? [{ slot: input.id, asset: compatible.asset }] : [];
      }));
    }
  }

  /** Recreate: the references a run used, back in their slots (by asset id; one deleted since shows as missing). */
  function applyReusedReferences(profile: Profile, recorded: unknown) {
    const inputs = imageInputsForProfile(profile);
    const records = (Array.isArray(recorded) ? recorded : []) as Array<{ slot?: string; assetId?: string; source?: string; name?: string }>;
    if (!inputs.length || !records.length) return;
    setReferenceAssets(records.flatMap((record, index) => {
      const input = inputs.find((candidate) => candidate.id === record.slot) || inputs[index];
      if (!input || !record.assetId) return [];
      const asset: ReferenceAsset = { id: record.assetId, source: record.source === 'generation' ? 'generation' : 'upload', name: record.name || 'Reference image', mime: '', width: 0, height: 0, size: 0, createdAt: '', thumbnailUrl: `/api/reference-assets/${encodeURIComponent(record.assetId)}/thumbnail` };
      return [{ slot: input.id, asset }];
    }));
  }

  /** Updates the LoRA stack and remembers it for a workflow: the current one by
   *  default, or the one being switched to when settings are applied together. */
  function setLorasWithMemory(update: React.SetStateAction<LoraSelection[]>, workflowId: string = model) {
    loraEditRevision.current += 1;
    if (workflowId && workflowId !== model) explicitLorasFor.current = workflowId;
    setLoras((current) => {
      const next = normalizeLoras(typeof update === 'function' ? update(current) : update);
      rememberLoraStrengths(workflowId, next);
      rememberActiveLoras(workflowId, next);
      return next;
    });
  }

  const loraStrengthForCurrentWorkflow = (name: string, fallback: number) => rememberedLoraStrength(model, name, fallback);

  function changeMode(next: Mode) {
    if (next === mode) return;
    galleryScroll.current[mode] = galleryStageRef.current?.scrollTop || 0;
    pendingScroll.current = next;
    const nextReferences = modeReferencesRef.current[next];
    referenceSelection.current = next;
    setReferenceAssets(nextReferences.assets);
    setStartImage(nextReferences.image);
    setStartImageId(nextReferences.id);
    setStartImageName(nextReferences.name);
    const nextPrompt = modePromptsRef.current[next];
    promptSelection.current = next;
    setPrompt(nextPrompt.prompt);
    setNegative(nextPrompt.negative);
    setMode(next);
    const saved = composerByMode.current[next];
    const savedProfile = models?.profiles.find((profile) => profile.id === (saved?.model || models.defaults[next === 'video' ? 'videoModel' : 'imageModel']) && profile.kind === next);
    if (next === 'video' && reusedImage.current && !imageInputsForProfile(savedProfile).length) {
      const candidates = models?.profiles.filter((profile) => profile.kind === 'video' && profile.ready !== false && imageInputsForProfile(profile).length) || [];
      const compatible = candidates.find((profile) => profile.family === savedProfile?.family) || candidates[0];
      if (compatible) { applyProfile(compatible); return; }
    }
    if (saved?.model && (!models || models.profiles.some((profile) => profile.id === saved.model && profile.kind === next))) {
      const setters: Record<string, (value: any) => void> = { cfg: setCfg, clipType: setClipType, count: setCount, customSize: setCustomSize, denoise: setDenoise, duration: setDuration, fps: setFps, frames: setFrames, height: setHeight, inpaintFeather: setInpaintFeather, inpaintStrength: setInpaintStrength, model: setModel, resolution: setResolution, sampler: setSampler, scheduler: setScheduler, seed: setSeed, steps: setSteps, textEncoder: setTextEncoder, textEncoders: setTextEncoders, vae: setVae, weightDtype: setWeightDtype, width: setWidth };
      for (const [key, value] of Object.entries(saved)) setters[key]?.(value);
      setLorasWithMemory(normalizeLoras(saved.loras), saved.model);
      const profile = models?.profiles.find((item) => item.id === saved.model);
      setCount(clampProfileCount(profile, saved.count ?? (prefs.defaultImageCount), next));
      return;
    }
    if (!models) return;
    if (next === "image") {
      const profile = models.profiles.find((item) => item.id === models.defaults.imageModel);
      if (profile) applyProfile(profile);
    } else {
      const profile = models.profiles.find((item) => item.id === models.defaults.videoModel);
      if (profile) applyProfile(profile);
    }
  }

  function applyAspect(value: string, targetMode = mode) {
    if (value === "default") {
      const size = profileImageSize(currentProfile, targetMode);
      setCustomSize(false);
      setWidth(size.width);
      setHeight(size.height);
      return;
    }
    if (value === "free" || value === "custom") {
      setCustomSize(true);
      return;
    }
    const preset = aspectOptions.find((item) => item.value === value) || fallbackAspectPresets[targetMode].find((item) => item.value === value);
    if (!preset) return;
    setCustomSize(false);
    setWidth(preset.w);
    setHeight(preset.h);
  }

  /* The size menu (components.tsx AspectPicker). Default and 2K start from a
     preset; Custom is any width and height. Moving between them keeps what's
     on screen as close as it can: into Custom at the size you were seeing,
     out of it to the preset nearest its shape. */
  function chooseSizeTier(tier: SizeTier) {
    if (tier === "custom") {
      if (customSize) return;
      const shown = sizePlan(sizeTier, width, height, currentProfile?.native, sizeMax, sizeArea, customLimits.width.step).final;
      // Fitted as a whole, not side by side, so a side at Custom's limit doesn't reshape it.
      const fitted = fitRatio(shown.width / shown.height, shown.width * shown.height, customLimits.width, customLimits.height, 16);
      setWidth(fitted.width);
      setHeight(fitted.height);
      setCustomSize(true);
      return;
    }
    if (customSize) {
      const defaults = currentProfile?.defaults || {};
      const defaultPreset = { label: "Default", value: "default", w: Number(defaults.width || 1024), h: Number(defaults.height || 1024) };
      const preset = closestPreset([defaultPreset, ...aspectOptions], { width, height });
      if (preset) { setWidth(preset.w); setHeight(preset.h); }
      setCustomSize(false);
    }
    // With Megapixels in 2K's place there's no 2K to choose: leave the saved pick for when it's back.
    if (!megapixelMode) chooseAutoUpscale(tier);
  }
  /** A ratio row while in Custom: that shape at about the same area. */
  function applyCustomRatio(ratio: number) {
    const size = fitRatio(ratio, width * height, customLimits.width, customLimits.height, 16);
    setWidth(size.width);
    setHeight(size.height);
  }
  function setCustomDimensions(next: { width: number; height: number }) {
    setWidth(next.width);
    setHeight(next.height);
    setCustomSize(true);
  }

  const modelProfiles = useMemo(() => {
    if (!models) return [];
    const favorites = new Set(workflowPreferences.favorites || []);
    const lastUsed = workflowPreferences.lastUsed || {};
    return models.profiles.filter((profile) => profile.kind === mode).sort((a, b) => {
      const favoriteDelta = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      if (favoriteDelta) return favoriteDelta;
      const recentDelta = Date.parse(lastUsed[b.id] || "0") - Date.parse(lastUsed[a.id] || "0");
      if (recentDelta) return recentDelta;
      const customDelta = Number(a.family === "custom") - Number(b.family === "custom");
      if (customDelta) return customDelta;
      return (a.displayName || a.label).localeCompare(b.displayName || b.label);
    });
  }, [mode, models, workflowPreferences]);

  const currentProfile = useMemo(() => {
    const profile = models?.profiles.find((item) => item.id === model);
    if (!profile) return null;
    const selected = profile.imageModes?.[referenceAssets.length || startImage || startImageId ? 'reference' : 'generate'];
    // Keep reference slots available while the text-only mode is active.
    return selected ? { ...profile, ...selected } : profile;
  }, [model, models, referenceAssets.length, startImage, startImageId]);
  /* A text encoder saved with the draft can stop fitting its slot (a rescan, a sharper
     file check): fall back to the slot's default instead of sending a pick the server rejects. */
  useEffect(() => {
    const slots = currentProfile?.encoderSlots || [];
    if (!slots.length) return;
    const fitting = slots.map((slot, index) => slot.options.includes(textEncoders[index]) ? textEncoders[index] : slot.default);
    if (fitting.some((name, index) => name !== textEncoders[index])) setTextEncoders(fitting);
    if (textEncoder && !slots[0].options.includes(textEncoder)) setTextEncoder(slots[0].default);
  }, [currentProfile, textEncoders, textEncoder]);
  const toggleModelFavoriteRef = useRef<(id: string) => void>(() => undefined);
  const pickModelRef = useRef<(id: string) => void>(() => undefined);
  const modelMenu = useMemo(() => ({
    favorites: workflowPreferences.favorites || [],
    recents: Object.entries(workflowPreferences.lastUsed || {}).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).map(([id]) => id),
    toggleFavorite: (id: string) => toggleModelFavoriteRef.current(id)
  }), [workflowPreferences]);
  const profileBadges = useMemo(() => {
    const favorites = new Set(workflowPreferences.favorites || []);
    return Object.fromEntries((models?.profiles || []).map((profile) => [
      profile.id,
      favorites.has(profile.id) ? "Favorite" : profile.family === "custom" ? "Workflow" : ""
    ]).filter(([, badge]) => badge));
  }, [models, workflowPreferences]);
  const aspectOptions = currentProfile?.aspectPresets?.length ? currentProfile.aspectPresets : fallbackAspectPresets[mode];
  const referenceInputs = imageInputsForProfile(currentProfile);
  const referenceInput = referenceInputs[0] || null;
  // One picture per slot, in slot order, whatever the saved list says (referenceSlots.js).
  const arrangedReferenceAssets = arrangeReferences(referenceAssets, referenceInputs);
  const storedReferenceAsset = referenceInput ? arrangedReferenceAssets.find((item) => item.slot === referenceInput.id)?.asset || null : null;
  const referenceAsset: ReferenceAsset | null = storedReferenceAsset || (referenceInput && startImageId ? {
    id: startImageId,
    source: "upload",
    name: startImageName || "Reference image",
    mime: "",
    width: 0,
    height: 0,
    size: 0,
    createdAt: "",
    // Only the id survives a reload; uploads can still be previewed from it, anything else falls back to an icon.
    thumbnailUrl: `/api/reference-assets/${encodeURIComponent(startImageId)}/thumbnail`
  } : null);
  const composerReferenceAssets = referenceAsset && referenceInput && !storedReferenceAsset
    ? arrangeReferences([{ slot: referenceInput.id, asset: referenceAsset }, ...arrangedReferenceAssets], referenceInputs)
    : arrangedReferenceAssets;
  // A reused output becomes the first video reference once a compatible workflow is active.
  useEffect(() => {
    const item = reusedImage.current;
    if (mode !== 'video' || !item || !referenceInput) return;
    const revision = referenceEditRevision.current;
    let live = true;
    setReuseReferencePending(true);
    referenceAssetFromGallery(item.id).then((asset) => {
      if (!live || reusedImage.current !== item) return;
      reusedImage.current = null;
      if (referenceEditRevision.current === revision) {
        setReferenceAssets((current) => withReference(current, referenceInputs, referenceInput.id, asset));
        setStartImage('');
        setStartImageId(asset.id);
        setStartImageName(asset.name);
      }
      setReuseReferencePending(false);
    }).catch((error) => {
      if (!live) return;
      reusedImage.current = null;
      setReuseReferencePending(false);
      showToast(error instanceof Error ? error.message : 'Couldn’t use the reused image as a video reference', 'error');
    });
    return () => { live = false; setReuseReferencePending(false); };
  }, [mode, model, referenceInput?.id]);
  const canUseStartImage = Boolean(referenceInput);
  // A mask belongs to the image it was painted on, for a model that can inpaint.
  // Settings › Studio › Inpainting can switch it off: no brush, no mask, no inpaint settings.
  const canInpaint = Boolean(prefs.inpainting && currentProfile?.capabilities.inpaint && referenceInput && (referenceAsset?.url || referenceAsset?.thumbnailUrl));
  const activeInpaintMask = canInpaint && inpaintMask && inpaintMask.assetId === referenceAsset?.id ? inpaintMask : null;
  useEffect(() => {
    if (inpaintMask && !activeInpaintMask) setInpaintMask(null);
  }, [inpaintMask, activeInpaintMask]);
  const widthMeta = currentProfile?.constraints?.width || {};
  const heightMeta = currentProfile?.constraints?.height || {};
  useEffect(() => {
    if (activeInpaintMask) return;
    const nextWidth = imageDimension(width, widthMeta), nextHeight = imageDimension(height, heightMeta);
    if (nextWidth !== width) setWidth(nextWidth);
    if (nextHeight !== height) setHeight(nextHeight);
  }, [activeInpaintMask, model, width, height, widthMeta.min, widthMeta.max, widthMeta.step, heightMeta.min, heightMeta.max, heightMeta.step]);
  /* Workflows may declare that a reference image dictates the output framing
     (aspectPolicy: "reference"). When one is selected we hide the manual aspect
     and size controls and let the reference's own dimensions drive generation. */
  const framingReference = currentProfile?.aspectPolicy === "reference"
    ? composerReferenceAssets.find((item) => item.slot === referenceInput?.id)?.asset || null
    : null;
  // Only an image being edited frames the output; a painted mask always edits it, and so does
  // a model without the switch, whatever was picked on another.
  const referenceRole: ReferenceRole = referenceRoleFor(currentProfile, prefs.referenceRole, Boolean(activeInpaintMask));
  const referenceForAspect = referenceRole === "edit" ? framingReference : null;
  const aspectLocked = Boolean(referenceForAspect && referenceForAspect.width > 0 && referenceForAspect.height > 0);
  // The size picked before a reference took over, put back when it lets go (same model only).
  const sizeBeforeLock = useRef<{ model: string; width: number; height: number; customSize: boolean } | null>(null);
  useEffect(() => {
    if (!aspectLocked || !referenceForAspect) {
      const before = sizeBeforeLock.current;
      sizeBeforeLock.current = null;
      if (before && before.model === model) {
        setWidth(before.width);
        setHeight(before.height);
        setCustomSize(before.customSize);
      }
      return;
    }
    // Kept from before the first lock only: on another model the size is already the reference's.
    if (!sizeBeforeLock.current) sizeBeforeLock.current = { model, width, height, customSize: Boolean(customSize) };
    setCustomSize(false);
    const size = referenceImageSize(currentProfile, referenceForAspect, { pixels: Number(currentProfile?.defaults.width || 1024) * Number(currentProfile?.defaults.height || 1024), resize: prefs.autoResizeInputs });
    if (size) { setWidth(size.width); setHeight(size.height); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectLocked, referenceForAspect?.id, referenceForAspect?.width, referenceForAspect?.height, model, prefs.autoResizeInputs]);
  const manualReference = composerReferenceAssets.find((item) => item.slot === referenceInput?.id)?.asset || null;
  useEffect(() => {
    if (aspectLocked || activeInpaintMask || referenceRoleOffered(currentProfile)) return;
    const size = referenceImageSize(currentProfile, manualReference, { pixels: width * height, resize: prefs.autoResizeInputs });
    if (!size) return;
    setCustomSize(!aspectOptions.some((item) => item.w === size.width && item.h === size.height));
    setWidth(size.width);
    setHeight(size.height);
    // Adopt framing when a reference or model changes, preserving later manual choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectLocked, manualReference?.id, manualReference?.width, manualReference?.height, model, prefs.autoResizeInputs]);
  /* A reference that dictates the framing, or a painted mask, takes the size
     tabs off the composer and the run skips 2K/4K (useGenerationActions). The
     saved pick stays, so it is back once the reference is gone or only guides. */
  useEffect(() => {
    if (mode === "video" && currentProfile?.capabilities.frames) setFrames((value) => validVideoFrames(currentProfile, value));
  }, [mode, currentProfile, frames]);
  useEffect(() => {
    if (currentProfile?.capabilities.resolution && !(currentProfile.options?.resolutions || []).includes(resolution)) setResolution(String(currentProfile.defaults.resolution || ""));
    if (currentProfile?.capabilities.duration) {
      const range = currentProfile.constraints?.duration || {};
      setDuration((value) => Math.round(Math.max(range.min ?? 1, Math.min(range.max ?? 15, Number.isFinite(value) ? value : Number(currentProfile.defaults.duration || 6)))));
    }
  }, [currentProfile, duration, resolution]);
  const frameMeta = currentProfile?.constraints?.frames || {};
  const countMeta = profileCountRange(currentProfile, mode);
  useEffect(() => { setCount((value) => clampProfileCount(currentProfile, value, mode)); }, [currentProfile, mode]);
  const stepsMeta = currentProfile?.constraints?.steps || {};
  const cfgMeta = currentProfile?.constraints?.cfg || {};
  const denoiseMeta = currentProfile?.constraints?.denoise || {};
  const fpsMeta = currentProfile?.constraints?.fps || {};
  const promptLimit = settingMax(currentProfile?.constraints?.prompt);
  const negativeLimit = settingMax(currentProfile?.constraints?.negative);
  const promptRemaining = promptLimit ? Math.max(0, promptLimit - textLength(prompt)) : undefined;
  const profileOptions = currentProfile?.options || {};
  const aspectValue = `${width}x${height}`;
  /* Megapixels (Settings › Studio) takes 2K's place, for images: Default draws every shape
     at that many pixels (the presets stay what's picked, as with 2K), and the menu's field in
     Custom rescales the size you have, keeping its shape. Unset, each model keeps its own size. */
  const megapixelMode = mode === "image" && Boolean(prefs.megapixelSizing);
  // As far as the model's sides reach (4096 at most, as in Custom), and no further than 16.
  const megapixelMax = Math.max(1, Math.min(16, Math.floor((Math.min(Number(widthMeta.max) || 8192, Number(heightMeta.max) || 8192, 4096) ** 2) / MEGAPIXEL)));
  // A target from a model that went further is held to this one's reach, in the field as in the run.
  const megapixelTarget = megapixelMode && Number(prefs.megapixels) > 0 ? Math.min(Number(prefs.megapixels), megapixelMax) : null;
  const sizeArea = megapixelTarget && !customSize ? megapixelTarget * MEGAPIXEL : 0;
  const nativeTiers = (["2k", "4k"] as const).filter(tier => currentProfile?.native?.[tier] === "yes" && Math.min(Number(widthMeta.max) || 8192, Number(heightMeta.max) || 8192) >= (tier === "4k" ? 4096 : 2048));
  const sizeTiers: SizeTier[] = mode === "image" && !megapixelMode ? ["none", ...nativeTiers, "custom"] : ["none", "custom"];
  // The size menu's tab: Custom is the size as typed; Default and 2K start from a preset (2K for images only).
  const savedTier = upscaleSize(prefs.autoUpscale);
  const sizeTier: AutoUpscale = customSize || mode !== "image" || megapixelMode || !sizeTiers.includes(savedTier) ? "none" : savedTier;
  const sizeMax = Math.min(Number(widthMeta.max) || 8192, Number(heightMeta.max) || 8192);
  const customLimits = { width: customSideLimits(widthMeta), height: customSideLimits(heightMeta) };
  const megapixelControl: MegapixelControl | null = megapixelMode ? {
    target: megapixelTarget,
    max: megapixelMax,
    onChange: (value: number) => {
      setPrefs({ megapixels: value });
      if (!customSize) return;
      const size = fitRatio(width / height, value * MEGAPIXEL, customLimits.width, customLimits.height, 16);
      setWidth(size.width);
      setHeight(size.height);
    },
    onReset: () => setPrefs({ megapixels: null })
  } : null;
  const defaultSize = profileImageSize(currentProfile, mode);
  const defaultAspectSize = `${defaultSize.width}x${defaultSize.height}`;
  const aspectPickerValue = aspectValue === defaultAspectSize ? "default" : customSize || !aspectOptions.some((item) => item.value === aspectValue) ? "free" : aspectValue;
  const galleryColumnCount = useGalleryColumnCount();
  // Upscales count too, so Stop shows (and stops them) while only an upscale is running.
  const runningCount = visibleGallery.filter((item) => item.status === "pending" || item.upscale?.status === "running").length;
  // Steps far slower than this model's usual mean a GPU out of memory, not a busy one.
  // Said once a session, and only about a run that finished while this page watched.
  const watchedRuns = useRef(new Set<string>());
  const slowHintShown = useRef(false);
  useEffect(() => {
    for (const item of gallery) if (item.status === "pending") watchedRuns.current.add(item.jobId || item.id);
    if (slowHintShown.current) return;
    const slow = gallery.find((item) => item.status === "done" && item.timing?.slow && watchedRuns.current.has(item.jobId || item.id));
    if (!slow) return;
    slowHintShown.current = true;
    showToast("That run was much slower than usual. ComfyUI may be short on graphics memory. Close other apps that use it, or try a smaller size.", "warning");
  }, [gallery]); // eslint-disable-line react-hooks/exhaustive-deps

  // What Generate would take with these settings, the way generate() would send them.
  const estimateGenerationPlan = generationPlan({ count, kind: mode, profile: currentProfile, references: referenceAssets, queueMode: prefs.variationQueueMode });
  // Estimated the way generate() sends it: at the size it's drawn at.
  // Not where generate() skips the plan: a mask, or an edited reference that sets the size.
  const estimatePlan = mode === "image" && !activeInpaintMask && !referenceForAspect ? sizePlan(sizeTier, Number(width), Number(height), currentProfile?.native, sizeMax, sizeArea, customLimits.width.step) : null;
  const estimateSize = estimatePlan?.draw || { width, height };
  const generationEstimate = useGenerationEstimate({
    mode, model: currentProfile?.model || model, profileId: currentProfile?.id || model, family: currentProfile?.family || '', width: estimateSize.width, height: estimateSize.height, steps,
    count: estimateGenerationPlan.requestCount, runs: estimateGenerationPlan.imageRuns, frames: mode === "video" ? frames : 0, revision: runningCount,
    // Learned apart on the server: runs that read images, and a native size's tiled decode.
    refs: composerReferenceAssets.length, tiled: tiledDecodeFor(estimatePlan)
  });
  // Models on this computer that ComfyUI does not read, and the one-step fix for them.
  const modelFolders = useModelFolders({
    connected: primaryConnected,
    emptyModels: Boolean(models && primaryConnected && !models.profiles.some((profile) => profile.ready !== false)),
    onModelsChanged: () => { refreshModels(false); refreshWorkflows(); },
    showToast,
    hints: prefs.modelFolderHints,
    onStopHints: () => setPrefs({ modelFolderHints: false })
  });
  const missingReferenceInput = referenceInputs.find((input) => (input.required || (input.min || 0) > 0) && !composerReferenceAssets.some((item) => item.slot === input.id));
  const missingRequiredReference = Boolean(missingReferenceInput);
  // Built-in families say exactly what they lack; custom workflows fall back to their encoder/VAE fields.
  const modelMissingParts = currentProfile?.missing || [];
  const modelSetupMissing = Boolean(currentProfile && (currentProfile.ready === false
    || (!currentProfile.encoderSlots && ((currentProfile.capabilities.textEncoder && !textEncoder) || (currentProfile.capabilities.vae && !vae)))));
  const generateDisabled = reuseReferencePending || !currentProfile || modelSetupMissing || missingRequiredReference;
  const generateDisabledReason = reuseReferencePending ? 'Loading the reused image' : missingRequiredReference ? `${missingReferenceInput?.label || "Reference image"} is required`
    : modelMissingParts.length ? `Needs ${modelMissingParts.map((item) => item.label).join(", ")}`
    : modelSetupMissing ? "This model needs files first"
    : !currentProfile ? (models ? "Choose a model" : "Loading models…") : undefined;
  const loraActiveCount = currentProfile?.capabilities.lora ? loras.filter((item) => item.enabled && item.name).length : 0;
  // Active LoRAs whose files clearly say another model family (lora-info.js): a quiet note above the prompt bar.
  const loraOptionNames = useMemo(() => ((currentProfile?.options?.loras || models?.loras || []) as unknown[]).map((option) => typeof option === "string" ? option : String((option as { name?: string })?.name || "")).filter(Boolean), [currentProfile, models]);
  const loraInfos = useLoraInfo(loraActiveCount ? loraOptionNames : []);
  // The closed composer names the stack: the first active LoRA, and how many more.
  const activeLoras = loraActiveCount ? loras.filter((item) => item.enabled && item.name) : [];
  const loraSummary = activeLoras.length ? `${loraName(activeLoras[0].name, loraInfos[activeLoras[0].name])}${activeLoras.length > 1 ? ` +${activeLoras.length - 1}` : ''}` : '';
  const [dismissedLoraWarnings, setDismissedLoraWarnings] = useState<string[]>([]);
  const loraMismatch = useMemo<LoraMismatch | null>(() => {
    if (!loraActiveCount || !currentProfile) return null;
    const wrong = loras.filter((item) => item.enabled && item.name && loraFit(loraInfos[item.name], currentProfile) === "other").map((item) => item.name);
    if (!wrong.length) return null;
    const key = `${currentProfile.id}|${[...wrong].sort().join("|")}`;
    if (dismissedLoraWarnings.includes(key)) return null;
    return { key, names: wrong, madeFor: [...new Set(wrong.map((name) => loraInfos[name]?.base).filter(Boolean))] as string[], model: currentProfile.familyName || currentProfile.displayName || currentProfile.label };
  }, [loraActiveCount, currentProfile, loras, loraInfos, dismissedLoraWarnings]);
  const dismissLoraMismatch = useCallback((key: string) => setDismissedLoraWarnings((current) => [...current, key]), []);

  function onGalleryUserScroll() {
    pendingScroll.current = null;
  }

  function onGalleryScroll(event: { currentTarget: HTMLElement }) {
    if (!hasMoreGallery) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    // The next page is asked for with two and a half screens still to go, so a fast scroll never reaches the end first.
    if (remaining < Math.max(1600, target.clientHeight * 2.5)) loadMoreGalleryItems();
  }

  function chooseModel(profileId: string) {
    const profile = models?.profiles.find((item) => item.id === profileId);
    if (profile) applyProfile(profile);
    else setModel(profileId);
  }

  function applyPresetPrompt(preset: ImagePreset) {
    const kind = preset.type || 'image';
    const target = mode === kind ? currentProfile : models?.profiles.find((item) => item.id === (composerByMode.current[kind]?.model || (kind === 'video' ? models.defaults.videoModel : models.defaults.imageModel)));
    changeMode(kind);
    setPrompt(clampText(preset.prompt, settingMax(target?.constraints?.prompt)));
    setNegative(clampText(preset.negative, settingMax(target?.constraints?.negative)));
    setShowNegativePrompt(Boolean(preset.negative));
    showToast('Prompt applied', 'success');
  }

  function applyImagePreset(preset: ImagePreset, profile: Profile) {
    const fit = presetFit(preset, profile);
    if (fit.blockers.length) { showToast(fit.blockers[0], 'error'); return; }
    changeMode(preset.type || 'image');
    applyProfile(profile);
    reusedImage.current = preset.galleryItemId ? { id: preset.galleryItemId } : null;
    setPrompt(clampText(preset.prompt, settingMax(profile.constraints?.prompt)));
    setNegative(clampText(preset.negative, settingMax(profile.constraints?.negative)));
    setShowNegativePrompt(Boolean(preset.negative));
    setSeed(fit.settings.seed ?? '');
    if (fit.settings.width !== undefined) setWidth(fit.settings.width);
    if (fit.settings.height !== undefined) setHeight(fit.settings.height);
    setCustomSize(true);
    if (fit.settings.steps !== undefined) setSteps(fit.settings.steps);
    if (fit.settings.cfg !== undefined) setCfg(fit.settings.cfg);
    if (fit.settings.sampler) setSampler(fit.settings.sampler);
    if (fit.settings.scheduler) setScheduler(fit.settings.scheduler);
    if (fit.settings.fps !== undefined) setFps(fit.settings.fps);
    if (fit.settings.frames !== undefined) setFrames(fit.settings.frames);
    const vae = preset.resources.find((item) => item.folder === 'vae' && item.localName);
    if (vae?.localName) setVae(vae.localName);
    const encoders = preset.resources.filter((item) => item.folder === 'text_encoders' && item.localName).map((item) => item.localName!);
    if (encoders.length) { setTextEncoder(encoders[0]); setTextEncoders(encoders); }
    setLorasWithMemory(fit.loras.map((item) => ({ name: item.localName!, strength: item.weight!, enabled: true })), profile.id);
    setReferenceAssets([]); setStartImage(''); setStartImageId(''); setStartImageName('');
    showToast(preset.settings.seed !== undefined ? 'Preset applied. Its seed is fixed until you change it.' : 'Preset applied', 'success');
  }

  function resetCreation() {
    if (currentProfile) applyProfile(currentProfile, false);
    setPrompt("");
    setNegative("");
    setSeed("");
    setLorasWithMemory([]);
    setReferenceAssets([]);
    setStartImage("");
    setStartImageId("");
    setStartImageName("");
    setInpaintMask(null);
  }

  pickModelRef.current = (profileId: string) => pickModel(profileId);
  function pickModel(profileId: string) {
    const next = models?.profiles.find((item) => item.id === profileId);
    if (next && profileId !== model) {
      // A switch loads the workflow's own defaults, which the composer shows; only
      // a reference image it had to drop is news.
      if (referenceAssets.length > 0 && !imageInputsForProfile(next).length) showToast(`Reference image removed. ${next.displayName || next.label || "This model"} doesn’t use one.`, "warning");
    }
    chooseModel(profileId);
    const lastUsed = { [profileId]: new Date().toISOString() };
    setWorkflowPreferences((current) => ({ ...current, lastUsed: { ...current.lastUsed, ...lastUsed } }));
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastUsed })
    }).then((data) => { if (data.preferences) setWorkflowPreferences(data.preferences); }).catch(() => null);
  }

  function toggleModelFavorite(profileId: string) {
    const current = workflowPreferences.favorites || [];
    const favorites = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
    setWorkflowPreferences((prefs) => ({ ...prefs, favorites }));
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites })
    }).then((data) => {
      if (data.preferences) setWorkflowPreferences(data.preferences);
      refreshWorkflows();
    }).catch(() => showToast("Couldn’t save the favorite", "error"));
  }

  toggleModelFavoriteRef.current = toggleModelFavorite;

  function selectWorkflow(profileId: string) {
    // Picking a video workflow from the image gallery (or the reverse) switches mode with it.
    const profile = models?.profiles.find((item) => item.id === profileId);
    if (profile && profile.kind !== mode) changeMode(profile.kind);
    chooseModel(profileId);
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastUsed: { [profileId]: new Date().toISOString() } })
    }).then((data) => {
      if (data.preferences) setWorkflowPreferences(data.preferences);
      refreshWorkflows();
    }).catch(() => null);
  }

  async function readStartImage(file: File | undefined) {
    if (!file) return;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const uploaded = await apiJson<{ startImageId: string }>("/api/start-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: data, name: file.name })
    });
    setStartImage("");
    setStartImageId(uploaded.startImageId);
    setStartImageName(file.name);
  }

  function selectReferenceAsset(slot: string, asset: ReferenceAsset) {
    referenceEditRevision.current += 1;
    if (!referenceInputs.some((input) => input.id === slot)) return;
    setReferenceAssets((current) => withReference(current, referenceInputs, slot, asset));
    setStartImage("");
    if (slot === referenceInput?.id) {
      setStartImageId(asset.id);
      setStartImageName(asset.name);
    }
  }

  /** Takes the pictures in `slots` off, from what the composer shows, and closes up the rest. */
  function removeReferenceAsset(slots: string | string[]) {
    referenceEditRevision.current += 1;
    const next = withoutReferences(composerReferenceAssets, referenceInputs, Array.isArray(slots) ? slots : [slots]);
    const first = next.find((item) => item.slot === referenceInput?.id)?.asset;
    setReferenceAssets(next);
    setStartImage("");
    setStartImageId(first?.id || "");
    setStartImageName(first?.name || "");
  }

  async function useOutputAsStartImage(item: GalleryItem) {
    if (!canUseStartImage || item.status !== "done" || item.type !== "image" || !item.url) {
      showToast("This model can’t use this image as a reference", "error");
      return;
    }
    try {
      const data = await apiJson<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id })
      });
      changeMode("image");
      selectReferenceAsset(referenceInput!.id, data.asset);
      setActive(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t use this image", "error");
    }
  }

  const generationActions = useGenerationActions({
    active, canUseStartImage, confirmAction, count, currentProfile, denoise, frames, fps, duration, resolution, generateDisabled, generatePostingRef, height, loadGallery, loadGalleryDelta, loras, missingRequiredReference, mode, model, negative, prefs, prompt, referenceAssets: composerReferenceAssets, inpaint: activeInpaintMask ? { mask: activeInpaintMask.dataUrl, strength: inpaintStrength, feather: inpaintFeather } : null, sizeTier, sizeMax, sizeArea, sizeStep: customLimits.width.step, sampler, scheduler, seed, setActive, setGallery, upsertGalleryItems, removeGalleryItems, removeGalleryItemsWhere, patchGalleryItems, setStatus, showToast, startImage, startImageId, startImageName, steps, cfg, textEncoder, textEncoders, vae, clipType, weightDtype, width, visibleGallery, generateDisabledReason, comfyOffline: Boolean(comfyStatus.checked && !comfyStatus.connected && !comfyStatus.checking), comfyRestarting: Boolean(comfyStatus.restarting),
    openModelSetup: () => setWorkflowGalleryOpen(true),
    retryComfyStatus,
    refreshModels
  });
  const { generate, cancelJob, cancelQueue, clearFailedItems, resetAllSettings, deleteItem, deleteItems } = generationActions;

  const viewerActions = useViewerControls({
    onReuseProfile: applyProfileReferences, onReuseReferences: applyReusedReferences, referenceForAspect,
    onReuseOutput: (item: GalleryItem | null) => { reusedImage.current = item?.type === 'image' && item.status === 'done' && item.url && !item.library ? item : null; },
    negativeForMode: (next: Mode) => modePromptsRef.current[next].negative, draft: { prompt, negative, seed, mode, model, width, height, steps, cfg, count, duration, resolution, loras, showNegativePrompt, clipType, customSize, denoise, fps, frames, sampler, scheduler, textEncoder, textEncoders, vae, weightDtype, startImage, startImageId, startImageName }, active, deleteItem, generate, generateDisabled, height, lastTapRef, lastTouchRef, mode, models, prefs, setActive, setCfg, setClipType, setCount, setCustomSize, setDenoise, setFps, setFrames, setDuration, setResolution, setHeight, setIsDraggingViewer, setLoras: setLorasWithMemory, setMode: changeMode, setModel, setNegative, setPrompt, setSampler, setScheduler, setSeed, setShowDetails, setShowNegativePrompt, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setViewerPan, setViewerZoom, setWeightDtype, setWidth, showToast, touchGestureRef, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, visibleGallery, width, viewerGallery
  });
  const { fitViewer, cycleViewerSize, viewerNativeZoom, resetViewer, openItem, applyAllSettings, applyPromptsOnly, applyLoras, moveViewer, submitPrompt, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch } = viewerActions;

  const { starterPick, rememberStarter, selectStarterModel } = useStarterPick({ models, mode, changeMode, pickModel, refreshModels, promptRef });

  // "Back to recommended": the sampling values the model's makers ship, once anything moved from them.
  const recommendedValues = currentProfile ? {
    steps: Number(currentProfile.defaults.steps || currentProfile.constraints?.steps?.default || (currentProfile.kind === "video" ? prefs.defaultVideoSteps : prefs.defaultImageSteps)),
    cfg: Number(currentProfile.defaults.cfg ?? currentProfile.constraints?.cfg?.default ?? 1),
    sampler: String(currentProfile.defaults.sampler || ""),
    scheduler: String(currentProfile.defaults.scheduler || ""),
    denoise: Number(currentProfile.defaults.denoise ?? currentProfile.constraints?.denoise?.default ?? 0.65)
  } : null;
  const recommended = {
    family: currentProfile?.familyName || "",
    differs: Boolean(recommendedValues && (steps !== recommendedValues.steps || cfg !== recommendedValues.cfg
      || (recommendedValues.sampler && sampler !== recommendedValues.sampler) || (recommendedValues.scheduler && scheduler !== recommendedValues.scheduler)
      || (currentProfile?.capabilities.denoise && denoise !== recommendedValues.denoise))),
    restore: () => {
      if (!recommendedValues) return;
      setSteps(recommendedValues.steps);
      setCfg(recommendedValues.cfg);
      if (recommendedValues.sampler) setSampler(recommendedValues.sampler);
      if (recommendedValues.scheduler) setScheduler(recommendedValues.scheduler);
      setDenoise(recommendedValues.denoise);
    }
  };

  const currentWorkflow = useMemo(() => workflows.find((w) => w.profileId === model) || null, [workflows, model]);
  // LoRA stacks are shared by every workflow of the same model family.
  const loraFamily = loraFamilyKey(currentProfile?.family);
  const loraStackList = useMemo(() => loraStacks(loraFamily, model), [loraFamily, model, loraSnapshotRevision]);
  const loraFavoriteList = useMemo(() => loraFavorites(), [loraSnapshotRevision]);
  const loraRecentList = useMemo(() => loraRecents(), [loraSnapshotRevision]);
  const bumpLoraLibrary = () => setLoraSnapshotRevision((value) => value + 1);
  const loraLibrary = {
    familyLabel: currentProfile?.family || '',
    stacks: loraStackList,
    favorites: loraFavoriteList,
    recents: loraRecentList,
    loadStack: (stack: LoraSnapshot) => setLorasWithMemory(stack.loras),
    saveStack: (name: string) => { const stack = saveLoraStack(loraFamily, name, loras); bumpLoraLibrary(); return stack; },
    updateStack: (id: string) => { updateLoraStack(loraFamily, id, loras); bumpLoraLibrary(); showToast('Stack updated', 'success'); },
    renameStack: (id: string, name: string) => { renameLoraStack(loraFamily, id, name); bumpLoraLibrary(); },
    // Reversible, so it acts at once and offers Undo (UI-PATTERNS › Messages).
    deleteStack: async (stack: LoraSnapshot) => {
      const family = loraFamily;
      deleteLoraStack(family, stack.id);
      bumpLoraLibrary();
      showToast(`Deleted ${stack.name}`, 'removed', { action: { label: 'Undo', onClick: () => { restoreLoraStack(family, stack); bumpLoraLibrary(); } } });
      return true;
    },
    toggleFavorite: (name: string) => { toggleLoraFavorite(name); bumpLoraLibrary(); },
    recordRecents: (names: string[]) => { recordLoraRecents(names); bumpLoraLibrary(); }
  };
  // The first reference, shown at the top of the sidebar's Basics with how much it may change.
  const sidebarReference = referenceInput && referenceAsset ? { asset: referenceAsset, label: referenceInput.role === "start" ? "Start image" : referenceInput.label || "Reference image", remove: () => removeReferenceAsset(referenceInput.id) } : null;
  const sidebarView = { sidebarReference, inpaintActive: Boolean(activeInpaintMask), inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather, canUseStartImage, cfg, cfgMeta, changeMode, clipType, count, countMeta, currentProfile, currentWorkflow, customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, duration, resolution, height, heightMeta, loras, loraActiveCount, loraSummary, mode, models, profileOptions, readStartImage, sampler, scheduler, seed, setCfg, setCount, setDenoise, setFps, setFrames, setDuration, setResolution, setHeight, setLoras: setLorasWithMemory, setSampler, setScheduler, setSeed, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setWeightDtype, setWidth, setWorkflowGalleryOpen, startImageName, steps, stepsMeta, textEncoder, textEncoders, refreshModels, refreshWorkflows, showToast, modelFolders, vae, weightDtype, width, widthMeta, workflowPreferences, loraLibrary, rememberedLoraStrength: loraStrengthForCurrentWorkflow, recommended, prefs, setPrefs, upscaleStatus };
  // The same settings as the sidebar, laid out for the phone's Advanced sheet.
  const modelLoraControls = <StableModelLoraControls view={sidebarView} />;
  const phoneAdvancedControls = <StablePhoneAdvancedControls view={sidebarView} />;

  const baseView = { fitViewer, cycleViewerSize, viewerNativeZoom, presetLibraryOpen, setPresetLibraryOpen, applyImagePreset, applyPresetPrompt, changeMode, viewerGallery, gallerySearch, setGallerySearch, toggleFavorite, seed, setSeed, galleryGroups, settleVersion, stackRuns, openRuns, setRunOpen, unstackRun, active, applyAllSettings, applyPromptsOnly, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, sizeTier, sizeTiers, sizeArea, megapixelControl, sizeMax, customLimits, chooseSizeTier, applyCustomRatio, setCustomDimensions, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, clearFailedItems, resetAllSettings, clickViewer, comfyStatus, copyToClipboard, copyItemToClipboard, count, countMeta, currentProfile, customSize, deleteItem, deleteItems, gallery, galleryColumnCount, galleryLoaded, galleryCrossing, galleryStageRef, galleryTotalApprox, generate, generateDisabled, generateDisabledReason, hasMoreGallery, health, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, loraSummary, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, negative, negativeLimit, now, onGalleryScroll, onGalleryUserScroll, openItem, prefs, profileBadges, prompt, promptLimit, refreshComfyStatus, retryComfyStatus, comfyRetrying, comfyReconnectedAt, refreshHealth, refreshModels, refreshWorkflows, removeReferenceAsset, renderedGallery, resetCreation, resetViewer, runningCount, selectReferenceAsset, selectWorkflow, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setWorkflowPreferences, setWorkflows, showDetails, showNegativePrompt, showToast, modelLoraControls, phoneAdvancedControls, startViewerDrag, startViewerTouch, status, steps, stepsMeta, stopViewerDrag, submitPrompt, touchGestureRef, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, workflowPreferences, workflows, promptRef, dragViewer, endViewerTouch, characterMeta, formatElapsed, generationDetailEntries, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, settings, setPrefs, upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, toggleUpscale, cancelUpscale, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, chooseAutoUpscale, upscaleDisplayUrl, modelFolders, generationEstimate, onStarterStarted: rememberStarter, selectStarterModel, generateKey: generateShortcut(prefs.enterToGenerate), failureFixes: generationActions.failureFixes };

  // Painting on the first reference, for a model that can inpaint (InpaintStudio.tsx).
  const referenceInpaint: ReferenceInpaint | null = canInpaint && referenceInput && referenceAsset ? {
    slot: referenceInput.id,
    mask: activeInpaintMask?.dataUrl || null,
    onChange: (dataUrl: string | null) => setInpaintMask(dataUrl ? { assetId: referenceAsset.id, dataUrl } : null)
  } : null;
  // The switch shows on the framing reference, once one is there. A painted mask settles it as an
  // edit: it stays, locked on Edit, so the chips say so (EDIT, the others greyed, no +).
  const referenceRoleControl: ReferenceRoleControl | null = referenceRoleOffered(currentProfile) && referenceInput && framingReference ? {
    slot: referenceInput.id,
    value: referenceRole,
    locked: Boolean(activeInpaintMask),
    onChange: (value: ReferenceRole) => { if (!activeInpaintMask) setPrefs({ referenceRole: value }); }
  } : null;
  // The phone's LoRAs row clears the stack in one tap, with Undo in the status pill.
  const clearLoras = () => { const before = loras; setLoras([]); showToast('LoRAs cleared', 'default', { action: { label: 'Undo', onClick: () => setLoras(before) } }); };
  const view = { ...baseView, clearLoras, sampler, cfg, loraMismatch, dismissLoraMismatch, referenceAssets: composerReferenceAssets, referenceInputs, referenceInpaint, referenceRole: referenceRoleControl };
  return (
    <>
      <StudioView view={view} />
      {confirmationDialog}
    </>
  );
}

// Other devices sign in before the studio loads (DeviceGate.tsx).
// A render error anywhere shows the crash screen (with Reload and Report) instead of a blank page.
// One tooltip provider for the whole app holds the shared hover delay and lets neighbours open at once.
// Framer Motion follows the system reduced-motion setting, as the CSS animations do.
createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion="user"><TooltipProvider><CrashBoundary><DeviceGate><App /></DeviceGate></CrashBoundary></TooltipProvider></MotionConfig>);
