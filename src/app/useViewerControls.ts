import { fallbackAspectPresets } from './constants';
import { clampProfileCount, outputProfile, referenceImageSize } from './generationOptions';
import { compatibleLoras, normaliseReusedSettings, removedLorasNote } from './outputReuse';
import { fetchLoraInfo, knownLoraInfo } from './useLoraInfo';
import { reusedNegative } from './composerSettings';
import { clampText, settingMax } from './format';
import { touchCenter, touchDistance } from './gallery';
import { usePhone } from './device';
import { normalizeLoras } from './loras';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { flushSync } from 'react-dom';
import { toast } from './toast';
import { wheelPixels } from './wheel';
import type { GalleryItem, Profile, TouchGesture } from './types';
import { MAX_ZOOM, MIN_ZOOM, Velocity, anchoredPan as anchorPan, clampPan, liveTransform, measureViewer, mediaSize, paint, rubber, rubberZoom, type Pan } from './viewerGesture';

const VIEWER_CONTROLS = 'button, a, input, select, textarea, [role="slider"], .studio-video-error';
function viewerControl(event: React.SyntheticEvent) {
  const control = (event.target as Element).closest(VIEWER_CONTROLS);
  return control && control !== event.currentTarget;
}

/** Where an object-fit: contain image actually draws inside its box. */
function containedRect(media: HTMLImageElement | HTMLVideoElement) {
  const box = media.getBoundingClientRect();
  const { width: naturalW, height: naturalH } = mediaSize(media);
  if (!naturalW || !naturalH || !box.width || !box.height) return box;
  const scale = Math.min(box.width / naturalW, box.height / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, right: box.left + (box.width + w) / 2, bottom: box.top + (box.height + h) / 2 };
}

export function useViewerControls(view: any) {
  const {
    active, generate, generateDisabled, height, lastTapRef,
    models, prefs, setActive, setCfg, setClipType, setCount, setCustomSize, setDenoise, setFps,
    setFrames, setDuration, setResolution, setHeight, setIsDraggingViewer, setLoras, setMode, setModel, setNegative, setPrompt,
    setSampler, setScheduler, setSeed, setShowDetails, setShowNegativePrompt, setStartImage, setStartImageId, setStartImageName, setSteps,
    setTextEncoder, setTextEncoders, setVae, setViewerPan, setViewerZoom, setWeightDtype, setWidth,
    showToast, viewerDragEndRef, viewerDragRef, viewerPan,
    viewerZoom, visibleGallery, width
  } = view;
  const [viewerNativeZoom, setViewerNativeZoom] = useState(1);
  const nativeZoomRef = useRef(1);
  const sizeMode = useRef<'native' | 'fit' | 'manual'>('native');
  // Desktop opens images at 1:1. A phone screen would show a corner of one at
  // that size, so there they open fitted, and a double tap toggles from fit.
  const phone = usePhone();
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const openingMode = () => phoneRef.current ? 'fit' as const : 'native' as const;
  const homeZoom = () => phoneRef.current ? 1 : nativeZoomRef.current;
  const swipeZoom = useRef(1);
  useLayoutEffect(() => {
    const item = active;
    if (item?.type !== 'image') {
      if (item?.type === 'video') { nativeZoomRef.current = 1; setViewerNativeZoom(1); setViewerZoom(1); }
      return;
    }
    const canvas = document.querySelector<HTMLElement>('.viewer-canvas');
    if (!canvas) return;
    sizeMode.current = openingMode();
    let first = true;
    // From the record's size when it has one, so the picture opens at its
    // final size before a pixel of it loads, and never resizes as it does.
    const measure = () => {
      const surface = canvas.querySelector<HTMLElement>('.generation-surface');
      const width = surface ? mediaSize(surface).width : 0;
      if (!width) return;
      const geometry = measureViewer(canvas);
      if (!geometry?.w) return;
      const factor = width / geometry.w;
      if (!first && Math.abs(factor - nativeZoomRef.current) < 0.0001) return;
      const previous = nativeZoomRef.current;
      nativeZoomRef.current = factor;
      setViewerNativeZoom(factor);
      if (sizeMode.current === 'fit') setViewerZoom(1);
      else if (first || sizeMode.current === 'native') setViewerZoom(factor);
      else setViewerZoom((zoom: number) => zoom * factor / previous);
      if (first) setViewerPan({ x: 0, y: 0 });
      first = false;
    };
    measure();
    canvas.addEventListener('load', measure, true);
    const resize = new ResizeObserver(measure);
    resize.observe(canvas);
    const media = new MutationObserver(measure);
    media.observe(canvas, { childList: true, subtree: true });
    return () => { canvas.removeEventListener('load', measure, true); resize.disconnect(); media.disconnect(); };
  }, [active?.id, active?.url, active?.upscaleActive]);
  function fitViewer() {
    sizeMode.current = 'fit';
    setViewerZoom(1);
    setViewerPan({ x: 0, y: 0 });
  }
  /**
   * The desktop's percentage button: Fit, then 1:1, then Full Size (the
   * picture filling the whole viewer, edges cropped), and round again,
   * skipping a step that would look the same as where it is.
   */
  function cycleViewerSize() {
    const canvas = document.querySelector<HTMLElement>('.viewer-canvas');
    const geometry = canvas ? measureViewer(canvas) : null;
    const fill = geometry?.w && geometry.h ? Math.max((geometry.right - geometry.left) / geometry.w, (geometry.bottom - geometry.top) / geometry.h) : 1;
    const steps: Array<['fit' | 'native' | 'fill', number]> = [['fit', 1], ['native', nativeZoomRef.current], ['fill', fill]];
    const zoom = latestView.current.viewerZoom;
    const near = (value: number) => Math.abs(value - zoom) < zoom * 0.01;
    const at = steps.findIndex(([, value]) => near(value));
    for (let offset = 1; offset <= steps.length; offset += 1) {
      const [mode, value] = steps[(Math.max(at, -1) + offset + steps.length) % steps.length];
      if (near(value)) continue;
      if (mode === 'fit') fitViewer();
      else if (mode === 'native') resetViewer('native');
      else { sizeMode.current = 'manual'; setViewerZoom(value); setViewerPan({ x: 0, y: 0 }); }
      return;
    }
  }
  const swipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swiping = useRef(false);
  const tapPointRef = useRef<Pan | null>(null);
  const latestView = useRef(view);
  latestView.current = view;
  // A swipe in flight is only abandoned when the viewer itself goes away. An
  // arrow key or a close mid-slide is handled by the timeout itself, which
  // puts the picture back instead of leaving it painted off screen.
  useEffect(() => () => {
    if (swipeTimer.current) clearTimeout(swipeTimer.current);
    swiping.current = false;
  }, []);
  const lastTouchRef = view.lastTouchRef as React.MutableRefObject<number>;
  const touchGestureRef = view.touchGestureRef as React.MutableRefObject<TouchGesture | null>;
  function resetViewer(mode: 'native' | 'fit' = 'native') {
    lastTapRef.current = 0;
    tapPointRef.current = null;
    sizeMode.current = mode;
    setViewerZoom(mode === 'fit' ? 1 : nativeZoomRef.current);
    setViewerPan({ x: 0, y: 0 });
  }

  function openItem(item: GalleryItem) {
    resetViewer(openingMode());
    // The side panel squeezes the image below laptop widths, so it starts closed there.
    setShowDetails(typeof window === "undefined" ? true : !window.matchMedia("(max-width: 1024px)").matches);
    setActive(item);
  }

  /** Puts back what "Apply settings" replaced: the draft someone was halfway through. */
  function restoreDraft(before: any) {
    view.onReuseOutput?.(null);
    setMode(before.mode);
    setModel(before.model);
    // Switching workflow resets its defaults in an effect; restore the rest after it ran.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setPrompt(before.prompt);
      setNegative(before.negative);
      setShowNegativePrompt(before.showNegativePrompt);
      setSeed(before.seed);
      setWidth(before.width);
      setHeight(before.height);
      setSteps(before.steps);
      if (before.cfg !== undefined) setCfg(before.cfg);
      setCount(before.count);
      setDuration(before.duration);
      setResolution(before.resolution);
      setLoras(before.loras);
      const setters: Record<string, (value: any) => void> = { clipType: setClipType, customSize: setCustomSize, denoise: setDenoise, fps: setFps, frames: setFrames, sampler: setSampler, scheduler: setScheduler, startImage: setStartImage, startImageId: setStartImageId, startImageName: setStartImageName, textEncoder: setTextEncoder, textEncoders: setTextEncoders, vae: setVae, weightDtype: setWeightDtype };
      for (const [key, setter] of Object.entries(setters)) if (setter && before[key] !== undefined) setter(before[key]);
    }));
  }

  /**
   * Recreate: loads an output's model, prompts, size, LoRAs, references and
   * settings into the composer, seed included, so generating makes the same
   * picture again unless something is changed. Edit (`newSeed`) loads the same
   * with a new seed, to change it. Returns whether its model is installed.
   */
  function applyAllSettings(item: GalleryItem, options: { newSeed?: boolean } = {}) {
    const before = view.draft ? { ...view.draft } : null;
    const itemSettings = item.settings || {};
    const matchingProfile = outputProfile(models?.profiles || [], item);
    const targetProfile: Profile | undefined = matchingProfile || models?.profiles?.find((profile: Profile) => profile.id === view.draft?.model && profile.kind === view.mode && profile.ready !== false);
    if (!targetProfile) { applyPromptsOnly(item, true); return false; }
    const nextMode = targetProfile.kind;
    const matchingAspects = targetProfile.aspectPresets?.length ? targetProfile.aspectPresets : fallbackAspectPresets[nextMode];
    const settings = normaliseReusedSettings(targetProfile, item, { available: models, fallback: !matchingProfile, current: view.draft || {}, loraInfos: knownLoraInfo() || {} });
    if (!matchingProfile && targetProfile.aspectPolicy === 'reference' && view.referenceForAspect) {
      Object.assign(settings, referenceImageSize(targetProfile, view.referenceForAspect) || {});
    }
    if (!['width', 'height', 'steps', 'cfg'].every((name) => Number.isFinite(settings[name]))) { applyPromptsOnly(item, true); return false; }
    setMode(nextMode);
    setModel(targetProfile.id);
    view.onReuseProfile?.(targetProfile);
    const nextPromptLimit = settingMax(targetProfile.constraints?.prompt);
    const nextNegativeLimit = settingMax(targetProfile.constraints?.negative);
    setPrompt(clampText(item.prompt || "", nextPromptLimit));
    const currentNegative = view.negativeForMode?.(nextMode) ?? view.draft?.negative ?? "";
    const nextNegative = reusedNegative(clampText(item.negative || "", nextNegativeLimit), currentNegative);
    setNegative(nextNegative);
    setShowNegativePrompt(true);
    setWidth(settings.width);
    setHeight(settings.height);
    setSteps(settings.steps);
    setCfg(settings.cfg);
    setDenoise(settings.denoise);
    if (!options.newSeed && itemSettings.seed && itemSettings.seed !== "Random") setSeed(String(itemSettings.seed));
    else setSeed("");
    setCount(clampProfileCount(targetProfile, itemSettings.variationCount || itemSettings.count || view.draft?.count || 1));
    setFrames(settings.frames);
    setDuration(settings.duration);
    setResolution(settings.resolution);
    setFps(settings.fps);
    setSampler(settings.sampler);
    setScheduler(settings.scheduler);
    setTextEncoder(settings.textEncoder);
    setTextEncoders?.(settings.textEncoders);
    setVae(settings.vae);
    setClipType(settings.clipType);
    setWeightDtype(settings.weightDtype);
    // Save the stack under the workflow we're switching to, not the one we're leaving.
    setLoras(normalizeLoras(settings.loras), targetProfile.id);
    // Before any LoRA panel has asked what the files are for, ask now and drop what doesn't fit.
    if (settings.loras.length && !knownLoraInfo()) {
      void fetchLoraInfo().then((infos) => {
        const { loras, removed } = compatibleLoras(normalizeLoras(settings.loras), targetProfile, infos);
        if (!removed) return;
        setLoras(loras, targetProfile.id);
        showToast(removedLorasNote(removed), "removed");
      }).catch(() => undefined);
    }
    if (matchingProfile || !settings.hasImageInput) {
      setStartImage(settings.hasImageInput ? item.referenceImage || "" : "");
      if (setStartImageId) setStartImageId(settings.hasImageInput ? item.startImageId || item.referenceImage || "" : "");
      setStartImageName(settings.hasImageInput ? item.referenceImageName || String(itemSettings.referenceImageName || "") : "");
    }
    setCustomSize(!matchingAspects.some((option: { w: number; h: number }) => option.w === settings.width && option.h === settings.height));
    if (matchingProfile) view.onReuseReferences?.(targetProfile, itemSettings.referenceAssets);
    view.onReuseOutput?.(item);
    const seedNote = !options.newSeed && itemSettings.seed && itemSettings.seed !== "Random" ? ` Seed ${itemSettings.seed} is fixed until you change it.` : "";
    const removed = settings.removedLoras ? ` ${removedLorasNote(settings.removedLoras)}.` : "";
    const message = matchingProfile
      ? `${options.newSeed ? "Ready to edit" : "Ready to rerun"}.${removed}${seedNote}`
      : `Its model isn’t available. Settings adjusted for ${targetProfile.displayName || targetProfile.label}.${removed}${seedNote}`;
    toast(message, {
      duration: 8000,
      action: before ? { label: "Undo", onClick: () => restoreDraft(before) } : undefined
    });
    return Boolean(matchingProfile);
  }

  function applyPromptsOnly(item: GalleryItem, unavailable = false) {
    const profile = models?.profiles?.find((candidate: Profile) => candidate.id === view.draft?.model && candidate.kind === view.mode);
    setPrompt(clampText(item.prompt || '', settingMax(profile?.constraints?.prompt)));
    setNegative(clampText(item.negative || '', settingMax(profile?.constraints?.negative)));
    toast(unavailable ? 'A compatible model isn’t available. Only prompts applied.' : 'Prompts applied.');
  }

  async function applyLoras(item: GalleryItem) {
    const recorded = normalizeLoras(item.settings?.loras);
    if (!recorded.length) {
      showToast("This output has no LoRAs", "error");
      return;
    }
    const profile = models?.profiles?.find((candidate: Profile) => candidate.id === view.draft?.model);
    const { loras, removed } = profile ? compatibleLoras(recorded, profile, knownLoraInfo() || await fetchLoraInfo().catch(() => ({}))) : { loras: recorded, removed: 0 };
    if (!loras.length) { showToast(`${removedLorasNote(removed)}: none fit this model`, "error"); return; }
    setLoras(loras);
    showToast(removed ? `LoRAs applied · ${removedLorasNote(removed)}` : "LoRAs applied", "success");
  }

  /** What the viewer steps through: the gallery in the order it is laid out (main.tsx viewerGallery). */
  function viewerItems(): GalleryItem[] {
    return view.viewerGallery || visibleGallery.filter((item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error");
  }

  function moveViewer(direction: 1 | -1) {
    // The latest view, not the render this closure came from: a swipe settles a
    // beat after the fingers lift, and the gallery may have moved on by then.
    const current = latestView.current;
    const activeItem: GalleryItem | null = current.active || null;
    if (!activeItem) return;
    const doneItems: GalleryItem[] = current.viewerGallery || viewerItems();
    const currentIndex = doneItems.findIndex((item: GalleryItem) => item.id === activeItem.id);
    if (currentIndex < 0 || doneItems.length < 2) return;
    resetViewer(openingMode());
    setActive(doneItems[(currentIndex + direction + doneItems.length) % doneItems.length]);
  }

  function submitPrompt(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Cmd/Ctrl+Enter always generates, even with "Enter to generate" off.
    const modified = event.metaKey || event.ctrlKey;
    if (!prefs.enterToGenerate && !modified) return;
    // Enter that confirms an IME composition (Japanese, Chinese, Korean) is not a submit.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    // generate() explains itself when something is missing, instead of doing nothing.
    generate();
  }

  /** The pan that keeps the point under the cursor still as the zoom changes. */
  function anchoredPan(nextZoom: number, clientX: number, clientY: number, element: HTMLElement) {
    if (nextZoom <= 1) return { x: 0, y: 0 };
    const geometry = measureViewer(element);
    if (!geometry) return viewerPan;
    const point = { x: clientX, y: clientY };
    return anchorPan(geometry, nextZoom, viewerZoom, viewerPan, point, point);
  }

  function zoomViewer(nextZoom: number, anchor?: { x: number; y: number; element: HTMLElement }) {
    sizeMode.current = 'manual';
    // Three decimals, so a touchpad's small steps still add up.
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom * 1000) / 1000));
    if (anchor) setViewerPan(anchoredPan(clamped, anchor.x, anchor.y, anchor.element));
    else if (clamped <= 1) setViewerPan({ x: 0, y: 0 });
    setViewerZoom(clamped);
  }

  function stepViewer(direction: number) {
    zoomViewer(latestView.current.viewerZoom + nativeZoomRef.current * direction * 0.25);
  }

  // Attached natively and non-passive (useWheelRef), so preventDefault holds
  // and Ctrl+wheel or a touchpad pinch never zooms the page as well.
  function wheelViewer(event: WheelEvent, element: HTMLElement) {
    if (active?.type === 'video') return;
    event.preventDefault();
    event.stopPropagation();
    const { y } = wheelPixels(event, element.clientHeight);
    if (y === 0) return;
    // Proportional to how far the wheel moved: a mouse notch (~100 px) is
    // about x1.16, a precision touchpad glides. Capped per event.
    const factor = Math.exp(Math.max(-0.35, Math.min(0.35, -y * 0.0015)));
    zoomViewer(viewerZoom * factor, { x: event.clientX, y: event.clientY, element });
  }

  function clickViewer(event: React.MouseEvent) {
    const target = event.target as Element;
    if (viewerControl(event)) return;
    event.stopPropagation();
    if (Date.now() - viewerDragEndRef.current < 220) return;
    if (viewerDragRef.current?.moved) return;
    const canvas = event.currentTarget as HTMLElement;
    const media = canvas.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
    if (media) {
      const rect = containedRect(media);
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        setActive(null);
        return;
      }
    }
    if (target.closest('[data-video-viewer]') || active?.type === "video") return;
    // On touch a single tap only closes (outside the image); zoom is a double tap
    // or a pinch, so a stray tap never jumps the picture to 200%.
    if (Date.now() - lastTouchRef.current < 700) return;
    zoomViewer(viewerZoom > homeZoom() * 1.05 ? homeZoom() : homeZoom() * 2);
  }

  function startViewerDrag(event: React.PointerEvent) {
    // Secondary/pen buttons belong to the native media context menu.
    if (event.button !== 0) return;
    if (viewerControl(event) || (event.target as Element).closest('[data-video-viewer]')) return;
    if (event.pointerType === "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    viewerDragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: viewerPan.x, panY: viewerPan.y, moved: false };
    setIsDraggingViewer(true);
  }

  function dragViewer(event: React.PointerEvent) {
    if (event.pointerType === "touch") return;
    const drag = viewerDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (viewerZoom > 1) setViewerPan({ x: drag.panX + dx, y: drag.panY + dy });
  }

  function stopViewerDrag(event: React.PointerEvent) {
    if (event.pointerType === "touch") return;
    if (viewerDragRef.current?.id === event.pointerId) {
      const moved = viewerDragRef.current.moved;
      setIsDraggingViewer(false);
      if (moved) viewerDragEndRef.current = Date.now();
      window.setTimeout(() => { viewerDragRef.current = null; }, 0);
    }
  }

  // React listens to touchstart and touchmove passively, so preventDefault()
  // there does nothing but log a warning; touch-action: none on the stage is
  // what keeps the browser from scrolling or zooming the page meanwhile.
  // A gesture paints the canvas itself (viewerGesture.ts) and only tells React
  // where it came to rest, so a pinch never waits on the studio rendering.
  function viewerCanvas(event: React.TouchEvent) {
    return event.currentTarget as HTMLElement;
  }

  function beginPinch(canvas: HTMLElement, touches: React.TouchList, zoom: number, pan: Pan) {
    lastTapRef.current = 0;
    tapPointRef.current = null;
    touchGestureRef.current = {
      mode: "pinch",
      geometry: measureViewer(canvas),
      distance: Math.max(1, touchDistance(touches)),
      zoom,
      pan,
      center: touchCenter(touches),
      current: { zoom, pan },
      moved: false
    };
  }

  function startViewerTouch(event: React.TouchEvent) {
    if (swiping.current) return;
    // A video swipes like a picture, except from its controls (the timeline
    // scrubs), and never pinches or pans: it has no zoom.
    const target = event.target as Element;
    if (viewerControl(event)) return;
    if (target.closest('[data-video-viewer]') && (event.touches.length !== 1 || viewerZoom > 1 || target.closest('.studio-video-controls, .studio-video-error'))) return;
    const canvas = viewerCanvas(event);
    // The last swipe is still carrying its picture off: let it land first.
    if (canvas.dataset.settle === "slide") return;
    const gesture = touchGestureRef.current;
    // A third finger changes nothing; the finger left from a pinch only
    // matters again once a second joins it, for a new pinch.
    if ((gesture?.mode === "done" && event.touches.length < 2) || (gesture?.mode === "pinch" && event.touches.length > 2)) return;
    // Caught mid-spring, it carries on from where it is on screen.
    sizeMode.current = 'manual';
    const start = gesture?.mode === "pinch" ? gesture.current : gesture?.mode === "pan" ? { zoom: gesture.zoom, pan: gesture.current } : liveTransform(canvas, { zoom: viewerZoom, pan: viewerPan });
    paint(canvas, start.zoom, start.pan);
    if (event.touches.length >= 2) {
      beginPinch(canvas, event.touches, start.zoom, start.pan);
      return;
    }
    const touch = event.touches[0];
    if (start.zoom > 1.001) {
      touchGestureRef.current = { mode: "pan", id: touch.identifier, x: touch.clientX, y: touch.clientY, zoom: start.zoom, pan: start.pan, geometry: measureViewer(canvas), current: start.pan, moved: false };
      return;
    }
    swipeZoom.current = start.zoom;
    // At fit size one finger swipes: sideways for the next image, down to close.
    const velocity = new Velocity();
    velocity.add(touch.clientX, touch.clientY);
    touchGestureRef.current = { mode: "swipe", id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, dy: 0, axis: null, velocity, moved: false };
  }

  // Like the inpaint canvas: every frame is clamped as it is drawn, so letting
  // go never moves the picture. Only a pinch below 100% springs back, to fit.
  function moveViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    if (!gesture) return;
    const canvas = viewerCanvas(event);
    if (gesture.mode === "pinch" && event.touches.length >= 2) {
      if (!gesture.geometry) gesture.geometry = measureViewer(canvas);
      const geometry = gesture.geometry;
      if (!geometry) return;
      const distance = touchDistance(event.touches);
      const center = touchCenter(event.touches);
      if (Math.abs(distance - gesture.distance) > 4 || Math.hypot(center.x - gesture.center.x, center.y - gesture.center.y) > 4) gesture.moved = true;
      const zoom = Math.min(MAX_ZOOM, rubberZoom(gesture.zoom * (distance / gesture.distance)));
      // Smaller than fit it shrinks in place; it comes back on release.
      const pan = zoom <= MIN_ZOOM ? { x: 0, y: 0 } : clampPan(geometry, zoom, anchorPan(geometry, zoom, gesture.zoom, gesture.pan, gesture.center, center));
      gesture.current = { zoom, pan };
      paint(canvas, zoom, pan);
      return;
    }
    if (gesture.mode === "swipe" && event.touches.length === 1) {
      const touch = event.touches[0];
      gesture.velocity.add(touch.clientX, touch.clientY);
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      if (!gesture.axis && Math.hypot(gesture.dx, gesture.dy) > 8) {
        gesture.moved = true;
        // Decided once, so a sideways swipe that sags doesn't start closing.
        gesture.axis = Math.abs(gesture.dx) >= Math.abs(gesture.dy) ? "x" : "y";
      }
      if (gesture.axis === "x") {
        // Nothing to go to: it gives, but only a little.
        const x = viewerNeighbors() ? gesture.dx : rubber(gesture.dx, 0, 0, 80);
        paint(canvas, 1, { x, y: 0 });
      } else if (gesture.axis === "y") {
        paint(canvas, 1, { x: 0, y: active ? Math.max(0, gesture.dy) : rubber(gesture.dy, 0, 0, 80) });
      }
      return;
    }
    if (gesture.mode === "pan" && event.touches.length === 1) {
      const touch = Array.from(event.touches).find((entry) => entry.identifier === gesture.id);
      if (!touch) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gesture.moved = true;
      const pan = clampPan(gesture.geometry, gesture.zoom, { x: gesture.pan.x + dx, y: gesture.pan.y + dy });
      gesture.current = pan;
      paint(canvas, gesture.zoom, pan);
    }
  }

  /** Where the picture rests, in state and on screen; `spring` eases it there. */
  function settleViewer(canvas: HTMLElement, zoom: number, pan: Pan, spring = true) {
    if (spring) paint(canvas, zoom, pan, "settle");
    else {
      paint(canvas, zoom, pan);
      delete canvas.dataset.gesture;
    }
    setViewerZoom(zoom);
    setViewerPan(pan);
  }

  function viewerNeighbors() {
    return Boolean(active) && viewerItems().length > 1;
  }

  /** The next picture slides in from the side the finger was heading away from. */
  function swipeTo(canvas: HTMLElement, direction: 1 | -1) {
    if (swiping.current) return;
    swiping.current = true;
    const width = canvas.clientWidth || window.innerWidth;
    const itemId = () => latestView.current.active?.id || "";
    const fromId = itemId();
    paint(canvas, 1, { x: -direction * width, y: 0 }, "slide");
    swipeTimer.current = setTimeout(() => {
      swipeTimer.current = null;
      if (!canvas.isConnected) { swiping.current = false; return; }
      const current = latestView.current;
      // Something else moved the open item on while this one slid out (an
      // arrow key, a close, another device): put it back instead of sliding
      // a second picture in behind it.
      if (fromId && itemId() !== fromId) {
        swiping.current = false;
        settleViewer(canvas, swipeZoom.current, { x: 0, y: 0 }, false);
        return;
      }
      // Rendered now, so the next picture is in place before it slides in.
      flushSync(() => {
        if (current.active) moveViewer(direction);
      });
      const moved = Boolean(itemId() && itemId() !== fromId);
      requestAnimationFrame(() => {
        swiping.current = false;
        if (!canvas.isConnected) return;
        // Nowhere to go (the gallery shrank under the swipe): settle back.
        if (!moved) { settleViewer(canvas, 1, { x: 0, y: 0 }, false); return; }
        paint(canvas, 1, { x: direction * width * 0.3, y: 0 });
        void canvas.offsetWidth;
        settleViewer(canvas, 1, { x: 0, y: 0 });
      });
    }, 140);
  }

  /** A pinch is over: retain its scale and position within the zoom limits. */
  function endPinch(canvas: HTMLElement, gesture: Extract<TouchGesture, { mode: "pinch" }>) {
    const { zoom, pan } = gesture.current;
    if (zoom < MIN_ZOOM) settleViewer(canvas, MIN_ZOOM, { x: 0, y: 0 });
    else settleViewer(canvas, zoom, pan, false);
  }

  function endViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    lastTouchRef.current = Date.now();
    viewerCanvas(event).dataset.lastTouchAt = String(lastTouchRef.current);
    if (!gesture) return;
    const canvas = viewerCanvas(event);
    if (event.type === "touchcancel") {
      touchGestureRef.current = null;
      settleViewer(canvas, viewerZoom, viewerPan);
      return;
    }
    if (gesture.mode !== "done" && gesture.moved) {
      viewerDragEndRef.current = Date.now();
      lastTapRef.current = 0;
      tapPointRef.current = null;
    }
    // One finger of a pinch lifts: the pinch is over, and the finger left
    // behind does nothing until it lifts too, so nothing lurches.
    if (gesture.mode === "pinch") {
      endPinch(canvas, gesture);
      touchGestureRef.current = event.touches.length ? { mode: "done" } : null;
      return;
    }
    if (event.touches.length) return;
    touchGestureRef.current = null;
    if (gesture.mode === "done") return;
    // A backdrop tap closes before double-tap recognition can consume its click.
    // This also works where Safari omits a synthetic click after touch gestures.
    const endedTouch = event.changedTouches[0];
    if (viewerControl(event)) return;
    if (!gesture.moved && active && endedTouch) {
      const media = canvas.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
      if (media) {
        const rect = containedRect(media);
        if (endedTouch.clientX < rect.left || endedTouch.clientX > rect.right || endedTouch.clientY < rect.top || endedTouch.clientY > rect.bottom) {
          lastTapRef.current = 0;
          setActive(null);
          return;
        }
      }
    }
    if (!gesture.moved && active?.type === "video") return;
    const nowTap = Date.now();
    const lastPoint = tapPointRef.current;
    // Two taps must land near one another; separate taps across the image aren't zoom.
    const doubleTap = Boolean(endedTouch && lastPoint && nowTap - lastTapRef.current < 320 && Math.hypot(endedTouch.clientX - lastPoint.x, endedTouch.clientY - lastPoint.y) < 36);
    if (!gesture.moved && endedTouch) {
      lastTapRef.current = doubleTap ? 0 : nowTap;
      tapPointRef.current = doubleTap ? null : { x: endedTouch.clientX, y: endedTouch.clientY };
    }

    if (!gesture.moved && doubleTap && endedTouch) {
      event.preventDefault();
      const current = gesture.mode === 'pan' ? gesture.zoom : swipeZoom.current;
      const zoom = current > homeZoom() * 1.05 ? homeZoom() : Math.min(MAX_ZOOM, homeZoom() * 2.5);
      const geometry = measureViewer(canvas);
      const point = { x: endedTouch.clientX, y: endedTouch.clientY };
      const pan = geometry ? clampPan(geometry, zoom, anchorPan(geometry, zoom, current, viewerPan, point, point)) : { x: 0, y: 0 };
      settleViewer(canvas, zoom, pan);
      return;
    }

    if (gesture.mode === "swipe") {
      if (gesture.moved) {
        const { dx, dy } = gesture;
        const velocity = gesture.velocity.read();
        const width = canvas.clientWidth || window.innerWidth;
        // Far enough, or a quick flick the same way: a short fast swipe counts.
        if (gesture.axis === "x" && viewerNeighbors() && (Math.abs(dx) > width * 0.22 || (Math.abs(velocity.x) > 0.3 && Math.abs(dx) > 20 && Math.sign(velocity.x) === Math.sign(dx)))) {
          swipeTo(canvas, dx < 0 ? 1 : -1);
          return;
        }
        if (gesture.axis === "y" && active && (dy > 110 || (velocity.y > 0.45 && dy > 30))) {
          setActive(null);
          return;
        }
        settleViewer(canvas, swipeZoom.current, { x: 0, y: 0 });
        return;
      }
      settleViewer(canvas, swipeZoom.current, { x: 0, y: 0 }, false);
      return;
    }

    // A pan ends where the finger left it.
    settleViewer(canvas, gesture.zoom, gesture.current, false);
  }
  return { fitViewer, cycleViewerSize, stepViewer, viewerNativeZoom, resetViewer, openItem, applyAllSettings, applyPromptsOnly, applyLoras, moveViewer, submitPrompt, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch };
}
