import React, { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Media } from './components';
import type { GalleryItem } from './types';
import { generationGridCount, webglMosaicAllowed } from './generationEffect';
import { upscaleDisplayThumbnail, upscaleDisplayUrl } from './useUpscale';
import { SafeImg } from './SafeImg';
import { mediaUrl } from './mediaUrl';
import { needsOriginal, viewerMediaSize, viewerSources } from './viewerMedia';

export function generationIdentity(item: GalleryItem) {
  return !item.run && item.jobId && Number.isInteger(item.index)
    ? `${item.privateVault ? 'vault' : 'gallery'}:${item.jobId}:${item.index}`
    : item.id;
}

/** Keep this surface mounted when a pending record becomes a finished output. */
type InpaintPreview = { box: { x: number; y: number; width: number; height: number }; image: { width: number; height: number }; referenceId: string };

/** An inpaint run's crop and the picture it sits in, when the run recorded both (server/gallery-store.js). */
function inpaintPreviewOf(item: GalleryItem): InpaintPreview | null {
  const value = (item.settings as Record<string, unknown> | undefined)?.inpaint as Partial<InpaintPreview> | undefined;
  if (!value?.box || !value.image?.width || !value.image?.height || !value.referenceId) return null;
  return value as InpaintPreview;
}

/**
 * `stage` is the viewer: a finished image there shows its thumbnail at once,
 * in the rectangle the picture will fill, and fades to the display copy, or
 * to the original once `scale` (screen pixels per original pixel) needs it.
 */
export function GenerationMedia({ item, muted = false, fit = 'cover', stage = false, scale = 1, children }: React.PropsWithChildren<{ item: GalleryItem; muted?: boolean; fit?: 'cover' | 'contain'; stage?: boolean; scale?: number }>) {
  return <GenerationMediaInstance key={generationIdentity(item)} item={item} muted={muted} fit={fit} stage={stage} scale={scale}>{children}</GenerationMediaInstance>;
}

function GenerationMediaInstance({ item, muted, fit, stage, scale, children }: React.PropsWithChildren<{ item: GalleryItem; muted: boolean; fit: 'cover' | 'contain'; stage: boolean; scale: number }>) {
  const mode = useContext(GenerationPreviewMode);
  const reducedMotion = useReducedMotion();
  const beganPending = useRef(item.status === 'pending');
  const lastPending = useRef(item);
  const [resolved, setResolved] = useState(false);
  const [loadedSource, setLoadedSource] = useState('');
  const [useFullImage, setUseFullImage] = useState(false);
  // The finished file would not load (moved, deleted, ComfyUI unreachable): hand it to Media's fallback.
  const [failedSource, setFailedSource] = useState('');
  const pending = item.status === 'pending';
  const advanced = mode === 'advanced' && !reducedMotion;
  useEffect(() => {
    if (pending || resolved || !advanced || item.status !== 'done') lastPending.current = item;
  }, [item, pending, resolved, advanced]);
  // An inpaint run previews in place: over its original, only where the painted crop is being made.
  const inpaint = inpaintPreviewOf(item);
  const resolving = item.status === 'done' && item.type === 'image' && beganPending.current && advanced && !resolved && !inpaint;
  const displayUrl = upscaleDisplayUrl(item);
  const displayThumbnail = upscaleDisplayThumbnail(item);
  useEffect(() => setUseFullImage(false), [displayUrl, displayThumbnail]);
  const isThumbnail = muted && Boolean(displayThumbnail) && !useFullImage;
  // Unique to this item, so a reused file name never brings back an older picture (mediaUrl.ts).
  const source = mediaUrl(isThumbnail ? displayThumbnail! : displayUrl, item);
  const previewItem = pending ? item : lastPending.current;
  const size = item.type === 'image' ? viewerMediaSize(item) : null;
  const staged = stage && item.status === 'done' && item.type === 'image' && !resolving && !inpaint && Boolean(source) && failedSource !== source;
  return (
    // The picture's own size, so the viewer knows the rectangle it fills before any pixels arrive (viewerGesture.ts).
    <div className={`generation-surface${pending ? ' is-pending' : ''}${resolving ? ' is-resolving' : ''}`} data-media-width={size?.width} data-media-height={size?.height}>
      {staged ? (
        <StagedImage item={item} scale={scale} reducedMotion={Boolean(reducedMotion)} onFailed={() => { setFailedSource(source); setResolved(true); }} />
      ) : item.status === 'done' && item.type === 'image' && source && failedSource !== source ? (
        <img src={source} alt={muted ? "" : item.prompt ? `Generated from: ${item.prompt.slice(0, 160)}` : "Generated image"} draggable={false} className="generation-result" decoding="async"
          onLoad={() => setLoadedSource(source)}
          onError={() => {
            if (isThumbnail) { setUseFullImage(true); return; }
            setFailedSource(source);
            setResolved(true);
          }} />
      ) : !pending ? <Media item={item.type === "video" && item.upscaleActive && item.upscale?.url ? { ...item, url: displayUrl, thumbnailUrl: displayThumbnail } : item} muted={muted} /> : null}
      {pending && inpaint ? (
        <div className="generation-inpaint" aria-hidden="true">
          <SafeImg className="generation-inpaint-base" src={`/api/reference-assets/${encodeURIComponent(inpaint.referenceId)}/media`} draggable={false} />
          <div className="generation-inpaint-box" style={{
            left: `${(inpaint.box.x / inpaint.image.width) * 100}%`,
            top: `${(inpaint.box.y / inpaint.image.height) * 100}%`,
            width: `${(inpaint.box.width / inpaint.image.width) * 100}%`,
            height: `${(inpaint.box.height / inpaint.image.height) * 100}%`
          }}>
            <GenerationPreview preview={previewItem.preview} fit="cover" aspectRatio={inpaint.box.width / inpaint.box.height} />
          </div>
        </div>
      ) : pending || resolving ? <GenerationPreview preview={previewItem.preview} fit={fit} aspectRatio={(item.width || 1) / (item.height || 1)}
        finalSource={resolving && loadedSource === source ? source : undefined}
        onResolved={() => setResolved(true)} /> : null}
      {pending ? children : null}
    </div>
  );
}

/**
 * The viewer's picture. Every layer is the same object-fit: contain box over
 * the same picture, so each draws in the same rectangle: the last layer that
 * loaded stays underneath while the next fades in over it, never resizing.
 */
function StagedImage({ item, scale, reducedMotion, onFailed }: { item: GalleryItem; scale: number; reducedMotion: boolean; onFailed: () => void }) {
  const sources = viewerSources(item);
  const [failed, setFailed] = useState<string[]>([]);
  // Once the original is asked for it stays, so zooming back out never steps down a copy.
  const [wantOriginal, setWantOriginal] = useState(false);
  const deep = needsOriginal(item, scale);
  useEffect(() => { if (deep) setWantOriginal(true); }, [deep]);
  const target = wantOriginal || failed.includes(sources.display) ? sources.original : sources.display;
  const [loaded, setLoaded] = useState('');
  const [under, setUnder] = useState(sources.placeholder);
  useEffect(() => {
    if (!loaded || loaded === under) return;
    // Hands over once the fade is done; the layer beneath goes then, not before.
    const timer = window.setTimeout(() => setUnder(loaded), reducedMotion ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [loaded, under, reducedMotion]);
  const alt = item.prompt ? `Generated from: ${item.prompt.slice(0, 160)}` : 'Generated image';
  return (
    <>
      <img key={target} src={target} alt={alt} draggable={false} className={`generation-result${loaded === target ? '' : ' is-loading'}`} decoding="async"
        onLoad={() => setLoaded(target)}
        onError={() => {
          if (target === sources.original) onFailed();
          else setFailed((list) => [...list, target]);
        }} />
      {under && under !== target && !failed.includes(under) ? (
        <img src={under} alt="" aria-hidden="true" draggable={false} className="generation-placeholder" decoding="async"
          onError={() => setFailed((list) => [...list, under])} />
      ) : null}
    </>
  );
}

export const GenerationPreviewMode = createContext<'advanced' | 'simple'>('advanced');
const Mosaic = lazy(() => import('./GenerationMosaic'));

let cachedWebglMosaic: boolean | undefined;
// When several runs finish together, each later one reveals quickly instead of making everyone wait.
let recentReveals: number[] = [];
const crowdWindowMs = 1500;

class EffectBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** A single latest-frame buffer; incoming previews never create an animation queue. */
export function GenerationPreview({ preview, fit = 'cover', aspectRatio = 1, finalSource, onResolved }: { preview?: string; fit?: 'cover' | 'contain'; aspectRatio?: number; finalSource?: string; onResolved?: () => void }) {
  const mode = useContext(GenerationPreviewMode);
  const reducedMotion = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const complete = useRef(onResolved);
  useEffect(() => { complete.current = onResolved; }, [onResolved]);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [pixelFailed, setPixelFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const advanced = mode === 'advanced' && !reducedMotion;
  const webglMosaic = useMemo(() => advanced && (cachedWebglMosaic ??= webglMosaicAllowed()), [advanced]);
  const [fast, setFast] = useState(false);
  useEffect(() => {
    if (!finalSource) return;
    const now = Date.now();
    recentReveals = recentReveals.filter((at) => now - at < crowdWindowMs);
    if (recentReveals.length) setFast(true);
    recentReveals.push(now);
  }, [finalSource]);
  const mosaic = webglMosaic && !fast;
  const reveal2d = advanced && (!webglMosaic || fast) && Boolean(finalSource);
  // Whole device pixels, so the frame and its cells never straddle a pixel.
  const dpr = window.devicePixelRatio || 1;
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  const frameWidth = snap(fit === 'contain' ? Math.min(size.width, size.height * aspectRatio) : size.width);
  const frameHeight = snap(fit === 'contain' ? frameWidth / aspectRatio : size.height);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (host.current) observer.observe(host.current);
    if (host.current) resize.observe(host.current);
    const update = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); resize.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  useEffect(() => {
    // Leave the last step frame untouched throughout the native shader reveal.
    if (!advanced || reveal2d || !visible || !foreground || !preview || !frameWidth || !frameHeight) return;
    let stale = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const paint = (loaded: HTMLImageElement) => {
      if (stale || !canvas.current) return;
      const target = canvas.current;
      const context = target.getContext('2d');
      if (!context) { setPixelFailed(true); return; }
      setPixelFailed(false);
      // img-fx pixels-organic: base 6 + cellSize(.22) * 74, reference 320 CSS px.
      // Match its physical square-cell grid, including rounding on each axis.
      target.width = generationGridCount(frameWidth);
      target.height = generationGridCount(frameHeight);
      const imageRatio = loaded.naturalWidth / loaded.naturalHeight;
      const frameRatio = frameWidth / frameHeight;
      const sw = imageRatio > frameRatio ? loaded.naturalHeight * frameRatio : loaded.naturalWidth;
      const sh = imageRatio > frameRatio ? loaded.naturalHeight : loaded.naturalWidth / frameRatio;
      context.drawImage(loaded, (loaded.naturalWidth - sw) / 2, (loaded.naturalHeight - sh) / 2, sw, sh, 0, 0, target.width, target.height);
    };
    image.onload = () => paint(image);
    image.onerror = () => { if (!stale) setPixelFailed(true); };
    image.src = preview;
    return () => { stale = true; image.onload = null; image.onerror = null; };
  }, [advanced, reveal2d, preview, frameWidth, frameHeight, visible, foreground]);

  useEffect(() => {
    // The WebGL-free reveal: the finished image sharpens out of the preview's
    // cell grid by doubling the resolution each step, then hands over.
    if (!reveal2d || !finalSource || !visible || !foreground || !frameWidth || !frameHeight) return;
    let stale = false;
    let timer = 0;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (stale) return;
      if (!target || !context) { complete.current?.(); return; }
      const fullWidth = Math.max(1, Math.round(frameWidth * dpr));
      const fullHeight = Math.max(1, Math.round(frameHeight * dpr));
      const imageRatio = image.naturalWidth / image.naturalHeight;
      const frameRatio = frameWidth / frameHeight;
      const sw = imageRatio > frameRatio ? image.naturalHeight * frameRatio : image.naturalWidth;
      const sh = imageRatio > frameRatio ? image.naturalHeight : image.naturalWidth / frameRatio;
      let width = generationGridCount(frameWidth);
      let height = generationGridCount(frameHeight);
      const step = () => {
        if (stale) return;
        target.width = Math.min(width, fullWidth);
        target.height = Math.min(height, fullHeight);
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, target.width, target.height);
        if (width >= fullWidth && height >= fullHeight) { timer = window.setTimeout(() => complete.current?.(), fast ? 90 : 260); return; }
        width *= 2;
        height *= 2;
        timer = window.setTimeout(step, fast ? 70 : 190);
      };
      step();
    };
    image.onerror = () => { if (!stale) complete.current?.(); };
    image.src = finalSource;
    return () => { stale = true; clearTimeout(timer); image.onload = null; image.onerror = null; };
  }, [reveal2d, finalSource, frameWidth, frameHeight, dpr, visible, foreground, fast]);

  useEffect(() => {
    if (!finalSource || !visible || !foreground) return;
    // A failed WebGL context or lazy chunk must not trap a finished image.
    const timeout = setTimeout(() => complete.current?.(), 8000);
    return () => clearTimeout(timeout);
  }, [finalSource, visible, foreground]);

  return (
    <div ref={host} className="generation-visual" aria-hidden="true">
      <div className="generation-frame" style={{ width: frameWidth, height: frameHeight }}>
      {!advanced || pixelFailed ? <SafeImg className="generate-preview" src={preview} draggable={false} /> : null}
      {advanced ? <canvas ref={canvas} className="generation-pixels" /> : null}
      {advanced && mosaic && visible && foreground ? (
        <EffectBoundary>
          <Suspense fallback={null}>
            <Mosaic finalSource={finalSource} hasPreview={!!preview} onResolved={() => complete.current?.()} />
          </Suspense>
        </EffectBoundary>
      ) : null}
      </div>
    </div>
  );
}
