import { forcedPhone, NARROW_QUERY } from './device';

/** One visibility observer and a small decoder budget for every video tile. */
type Preview = { video: HTMLVideoElement; update: (load: boolean) => void; ratio: number; near: boolean; loaded: boolean };
const previews = new Map<HTMLVideoElement, Preview>();
let nearObserver: IntersectionObserver | undefined;
let visibleObserver: IntersectionObserver | undefined;
let suspended = 0;
// Phones and touch screens start with grid autoplay off.
const SMALL_QUERY = `${NARROW_QUERY}, (pointer: coarse)`;
let autoplay = typeof window === 'undefined' || !window.matchMedia(SMALL_QUERY).matches;
try {
  const saved = localStorage.getItem('heiss-grid-autoplay');
  if (saved !== null) autoplay = saved !== 'off';
} catch { /* Storage may be disabled. */ }
const autoplayListeners = new Set<() => void>();
export const gridAutoplayEnabled = () => autoplay;
export function subscribeGridAutoplay(listener: () => void) { autoplayListeners.add(listener); return () => { autoplayListeners.delete(listener); }; }
export function toggleGridAutoplay() {
  autoplay = !autoplay;
  try { localStorage.setItem('heiss-grid-autoplay', autoplay ? 'on' : 'off'); } catch { /* Keep the current session setting. */ }
  reconcile();
  autoplayListeners.forEach((listener) => listener());
}
const motion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const phone = typeof window !== 'undefined' ? window.matchMedia(SMALL_QUERY) : undefined;

// Read once: reconcile runs on every scroll step, and this only changes with a reload.
let forcedPhoneValue: boolean | undefined;
const phoneForced = () => (forcedPhoneValue ??= forcedPhone());

function reconcile() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  // A screenful of tiles plays at once on a computer; phones decode fewer, and Data Saver fewer still.
  const limit = connection?.saveData ? 2 : phone?.matches || phoneForced() ? 2 : 24;
  const candidates = [...previews.values()].filter((p) => p.near).sort((a, b) => b.ratio - a.ratio);
  const selected = new Set(!suspended && autoplay ? candidates.slice(0, limit) : []);
  for (const p of previews.values()) {
    const load = selected.has(p);
    if (load !== p.loaded) { p.loaded = load; p.update(load); }
    if (document.hidden || !load || !p.ratio || motion?.matches) p.video.pause();
    else if (p.video.getAttribute('src') && p.video.paused) void p.video.play().catch(() => { /* Autoplay denied: keep the first frame inline. */ });
  }
}

export function observeVideoPreview(video: HTMLVideoElement, update: Preview['update']) {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) { const p = previews.get(entry.target as HTMLVideoElement); if (p) p.near = entry.isIntersecting; }
      reconcile();
    }, { rootMargin: '160px' });
    visibleObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) { const p = previews.get(entry.target as HTMLVideoElement); if (p) p.ratio = entry.isIntersecting ? entry.intersectionRatio : 0; }
      reconcile();
    }, { threshold: [0, .1, .5, 1] });
    document.addEventListener('visibilitychange', reconcile);
    motion?.addEventListener('change', reconcile);
    phone?.addEventListener('change', reconcile);
  }
  previews.set(video, { video, update, ratio: 0, near: false, loaded: false });
  nearObserver.observe(video);
  visibleObserver!.observe(video);
  video.addEventListener('canplay', reconcile);
  // Safari/Chromium may only preload metadata until play() is requested.
  video.addEventListener('loadedmetadata', reconcile);
  return () => {
    video.pause();
    video.removeEventListener('canplay', reconcile);
    video.removeEventListener('loadedmetadata', reconcile);
    nearObserver?.unobserve(video);
    visibleObserver?.unobserve(video);
    previews.delete(video);
    if (!previews.size) {
      nearObserver?.disconnect(); visibleObserver?.disconnect();
      nearObserver = visibleObserver = undefined;
      document.removeEventListener('visibilitychange', reconcile);
      motion?.removeEventListener('change', reconcile);
      phone?.removeEventListener('change', reconcile);
    } else reconcile();
  };
}

/** React has committed the selected tile's source; request playback immediately. */
export function refreshVideoPreviews() { reconcile(); }

/** The selected viewer gets the decoder budget while it is open. */
export function suspendVideoPreviews() {
  suspended++; reconcile();
  return () => { suspended = Math.max(0, suspended - 1); reconcile(); };
}

export function videoPreviewUrl(source: string) {
  try {
    const url = new URL(source, window.location.origin);
    if (url.origin !== window.location.origin) return '';
    if (url.pathname === '/comfy/view') url.pathname = '/comfy/video-preview';
    else if (url.pathname === '/api/library/file') url.pathname = '/api/library/video-preview';
    else if (url.pathname.startsWith('/api/vault/media/')) url.pathname = url.pathname.replace('/media/', '/video-preview/');
    else if (/^\/api\/presets\/\d+\/media$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/media$/, '/video-preview');
    else return '';
    url.searchParams.delete('download'); url.searchParams.delete('clean');
    return `${url.pathname}${url.search}`;
  } catch { return ''; }
}
