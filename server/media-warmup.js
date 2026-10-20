import { mediaType } from './media-paths.js';
import { gallery, galleryRevisionValue, isGalleryHidden } from './gallery-store.js';
import { buildStats, cacheLimitBytes, viewParams, warmThumbnail } from './thumbnails.js';
import { encoderIdle, getComfyVideoPoster, getComfyVideoPreview, maxCacheBytes } from './video-previews.js';

/*
 * Builds the gallery's thumbnails, video posters and grid previews ahead of
 * their first view, so opening a large (imported) gallery shows cached tiles
 * instead of waiting on hundreds of builds. Newest first, one at a time, only
 * while no request is building, and resting as long as each build took, so it
 * never takes more than half a core from the studio. It stops short of
 * filling either cache, which would only sweep its own work away again.
 */
const videoPattern = /\.(mp4|webm|mov|mkv|m4v)$/i;
const imagePattern = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i;
const thumbnailBudget = Math.floor(cacheLimitBytes / 2 / (64 * 1024));
// The viewer's display copies are larger: only the newest get one ahead of time.
const displayBudget = Math.floor(cacheLimitBytes / 4 / (1024 * 1024));
const posterBudget = Math.floor(maxCacheBytes / 4 / (32 * 1024));
const previewBudget = Math.floor(maxCacheBytes / 4 / (512 * 1024));
const settled = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());
let warming = null;
let warmedRevision = 0;
let shownRevision = -1;
let shown = new Set();

/** The Studio media files an item shows: its original and its upscale. */
function itemMedia(item) {
  if (item?.status !== 'done' || item.privateVault || item.hidden || isGalleryHidden(item)) return [];
  return [item.url, item.upscale?.url].map(viewParams)
    .filter((params) => params?.type === mediaType && (videoPattern.test(params.filename) || imagePattern.test(params.filename)))
    .map((params) => ({ ...params, video: videoPattern.test(params.filename) }));
}

/** Whether a file is still in the gallery: one hidden or deleted meanwhile is never built. */
function stillShown({ filename, subfolder, type }) {
  if (shownRevision !== galleryRevisionValue()) {
    shownRevision = galleryRevisionValue();
    shown = new Set(gallery.flatMap((item) => itemMedia(item).map((media) => `${media.type}:${media.subfolder}:${media.filename}`)));
  }
  return shown.has(`${type}:${subfolder}:${filename}`);
}

const idle = () => buildStats().building === 0 && buildStats().waiting === 0 && encoderIdle();

/** Runs one build when the studio is otherwise quiet, then rests for as long as it took. */
async function quietly(key, media, build) {
  if (settled.has(key)) return;
  while (!idle()) await sleep(250);
  if (!stillShown(media)) return;
  const started = performance.now();
  try { await build(); } catch { /* Unreadable or gone: its first view reports it. */ }
  settled.add(key);
  const took = performance.now() - started;
  // An existing file is found in a millisecond or two; only real work rests.
  if (took > 5) await sleep(took);
}

/** One pass over the gallery as it is now. Resolves to how many files it looked at. */
export async function warmGallery({ items = gallery } = {}) {
  let images = 0;
  let displays = 0;
  let videos = 0;
  const previews = [];
  for (const item of [...items]) {
    for (const media of itemMedia(item)) {
      const { filename, subfolder, type } = media;
      const key = `${type}:${subfolder}:${filename}`;
      if (media.video) {
        if (videos >= posterBudget) continue;
        videos += 1;
        await quietly(`poster:${key}`, media, () => getComfyVideoPoster(filename, subfolder, type));
        if (videos <= previewBudget) previews.push(media);
      } else if (images < thumbnailBudget) {
        images += 1;
        await quietly(`thumb:${key}`, media, () => warmThumbnail(filename, subfolder, type));
        if (displays < displayBudget) {
          displays += 1;
          await quietly(`display:${key}`, media, () => warmThumbnail(filename, subfolder, type, 'display'));
        }
      }
    }
  }
  // Posters first for every video: a grid shows those before any preview plays.
  for (const media of previews) {
    const { filename, subfolder, type } = media;
    await quietly(`preview:${type}:${subfolder}:${filename}`, media, () => getComfyVideoPreview(filename, subfolder, type));
  }
  return images + videos;
}

/** Starts a pass unless one is running; a change while it runs gets its own pass after. */
export function warmGalleryNow() {
  if (warming) return warming;
  warmedRevision = galleryRevisionValue();
  warming = warmGallery()
    .catch((error) => console.warn(`[Studio] Media warm-up stopped: ${error.message}`))
    .finally(() => { warming = null; });
  return warming;
}

/**
 * Warms the gallery shortly after start and again whenever it changes
 * (imports, recovered runs, finished upscales). Items already done are
 * skipped by name, so a pass after a change only builds what is new.
 */
export function startMediaWarmup({ delayMs = 10_000, everyMs = 15_000 } = {}) {
  setTimeout(warmGalleryNow, delayMs).unref?.();
  setInterval(() => { if (galleryRevisionValue() !== warmedRevision) void warmGalleryNow(); }, everyMs).unref?.();
}

/**
 * A finished run's outputs, the moment they are delivered and before any
 * browser asks: a request that arrives meanwhile joins the same build.
 */
export function warmNewOutputs(outputs = []) {
  for (const output of outputs) {
    const params = viewParams(output?.url);
    if (!params) continue;
    const { filename, subfolder, type } = params;
    const build = videoPattern.test(filename) ? getComfyVideoPoster(filename, subfolder, type)
      : imagePattern.test(filename) ? warmThumbnail(filename, subfolder, type).then(() => warmThumbnail(filename, subfolder, type, 'display')) : null;
    build?.catch(() => {});
  }
}
