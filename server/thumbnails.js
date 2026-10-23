import crypto from "node:crypto";
import { mediaType } from "./media-paths.js";
import fs from "node:fs";
import path from "node:path";
import {
  comfyRecentlyUnreachable,
  comfyUrl,
  localOutputFile,
  noteComfyFetchError,
  noteComfyReachable,
} from "./comfy.js";
import { dataDir } from "./gallery-store.js";
import { renameWithRetryAsync } from "./json-store.js";
import { loadSharp } from "./sharp-loader.js";

// Small on-demand cache of downscaled previews for the gallery grid, so a LAN client
// only has to pull a full-resolution image when it actually opens the viewer.
const thumbnailDir = path.join(dataDir, ".thumbnails");
/*
 * The grid's thumbnail, and the viewer's display copy: a WebP of the whole
 * picture up to a size no screen needs more of at fit or 1:1, a fraction of
 * the original PNG's bytes. The viewer asks for the original only past it.
 */
export const RENDITIONS = {
  thumb: { longestEdge: 768, quality: 72 },
  display: { longestEdge: 2560, quality: 90 },
};
const { longestEdge, quality } = RENDITIONS.thumb;
const renditionOf = (size) => RENDITIONS[size] || RENDITIONS.thumb;
const pending = new Map();

/**
 * How many thumbnails are built at once. A screen of the gallery can ask for
 * a hundred at the same moment (stacks ask for several each), and every build
 * decodes the full image, often fetched from ComfyUI first: all at once that
 * is a memory spike here and a flood of /view requests there. Cached
 * thumbnails don't wait; only building does.
 */
export const BUILD_SLOTS = 4;
let building = 0;
const waiting = [];
export function buildStats() {
  return { building, waiting: waiting.length };
}
async function inSlot(work) {
  // A freed slot is handed straight to the next in line, still counted, so a
  // caller arriving in between can never take it too and make five.
  if (building < BUILD_SLOTS) building += 1;
  else await new Promise((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else building -= 1;
  }
}

/*
 * Which cached files each output has, read from the folder once and then kept
 * up to date here. Finding an output's thumbnail, or clearing out its older
 * ones after a build, then looks at that output's few files instead of
 * listing a cache of tens of thousands on every build.
 */
let cacheIndex = null;
const keyOfName = (name) =>
  name.endsWith(".webp") && name.includes("-") ? name.slice(0, name.indexOf("-")) : "";
function indexed() {
  if (cacheIndex) return cacheIndex;
  cacheIndex = new Map();
  let names = [];
  try {
    names = fs.readdirSync(thumbnailDir);
  } catch {
    /* No cache yet. */
  }
  for (const name of names) indexAdd(name);
  return cacheIndex;
}
function indexAdd(name) {
  const key = keyOfName(name);
  if (!key || !cacheIndex) return;
  if (!cacheIndex.has(key)) cacheIndex.set(key, new Set());
  cacheIndex.get(key).add(name);
}
function indexRemove(name) {
  const names = cacheIndex?.get(keyOfName(name));
  if (!names) return;
  names.delete(name);
  if (!names.size) cacheIndex.delete(keyOfName(name));
}

/*
 * The cache is capped (2 GB unless STUDIO_THUMBNAIL_CACHE_MB says otherwise).
 * When it grows past that, the thumbnails used longest ago go first, down to
 * 80%, so a sweep does not run again for the next few images. Anything served
 * in the last 15 minutes counts as in use (an open gallery page) and stays;
 * a removed thumbnail is simply made again when it is next asked for.
 */
export const cacheLimitBytes =
  Math.max(16, Number(process.env.STUDIO_THUMBNAIL_CACHE_MB) || 2048) * 1024 * 1024;
const inUseMs = 15 * 60 * 1000;
const sweepEveryMs = 10 * 60 * 1000;
// When each thumbnail was last served by this server. The file's access time
// (set now and then, see noteUsed) carries that over a restart.
const lastUsed = new Map();
const touchEveryMs = 60 * 60 * 1000;
let lastSweepAt = 0;
let sweeping = null;

function noteUsed(file) {
  const now = Date.now();
  const previous = lastUsed.get(file) || 0;
  lastUsed.set(file, now);
  if (now - previous < touchEveryMs) return;
  // Keep the modified time: it tells a newer thumbnail of the same image from an older one.
  fs.promises
    .stat(file)
    .then((stat) => fs.promises.utimes(file, new Date(now), stat.mtime))
    .catch(() => {});
}

/**
 * Trims the cache to `limitBytes` if it is over, oldest use first, never a
 * thumbnail used within `recentMs`. Resolves to what it removed.
 */
export async function sweepThumbnails({
  dir = thumbnailDir,
  limitBytes = cacheLimitBytes,
  now = Date.now(),
  recentMs = inUseMs,
} = {}) {
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return { removed: 0, freedBytes: 0, totalBytes: 0 };
  }
  const entries = [];
  let totalBytes = 0;
  for (const name of names) {
    if (!name.endsWith(".webp")) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(file);
      totalBytes += stat.size;
      entries.push({
        file,
        size: stat.size,
        usedAt: Math.max(stat.atimeMs, stat.mtimeMs, lastUsed.get(file) || 0),
      });
    } catch {
      // Removed meanwhile.
    }
  }
  if (totalBytes <= limitBytes) return { removed: 0, freedBytes: 0, totalBytes };
  const target = limitBytes * 0.8;
  let removed = 0;
  let freedBytes = 0;
  entries.sort((a, b) => a.usedAt - b.usedAt);
  for (const entry of entries) {
    if (totalBytes - freedBytes <= target || now - entry.usedAt < recentMs) break;
    try {
      await fs.promises.rm(entry.file, { force: true });
      lastUsed.delete(entry.file);
      if (dir === thumbnailDir) indexRemove(path.basename(entry.file));
      removed += 1;
      freedBytes += entry.size;
    } catch {
      // Open elsewhere (Windows): the next sweep tries again.
    }
  }
  return { removed, freedBytes, totalBytes: totalBytes - freedBytes };
}

/** Starts a sweep unless one ran in the last few minutes. */
function maybeSweep() {
  const now = Date.now();
  if (sweeping || now - lastSweepAt < sweepEveryMs) return;
  lastSweepAt = now;
  sweeping = sweepThumbnails()
    .then(({ removed, freedBytes }) => {
      if (removed)
        console.log(
          `[Studio] Thumbnail cache: removed ${removed} older thumbnails (${Math.round(freedBytes / 1e6)} MB).`,
        );
    })
    .catch(() => {})
    .finally(() => {
      sweeping = null;
    });
}

// A cache that grew past the cap before there was one is trimmed soon after start.
setTimeout(maybeSweep, 60_000).unref?.();

// Folding the resize settings into the key means changing longestEdge/quality
// naturally starts a fresh cache generation instead of serving stale-sized files.
function cacheKey(filename, subfolder, type, size = "thumb") {
  const rendition = renditionOf(size);
  return crypto
    .createHash("sha1")
    .update(`${type}:${subfolder}:${filename}:${rendition.longestEdge}:${rendition.quality}`)
    .digest("hex");
}

function cachePath(key, sourceHash) {
  return path.join(thumbnailDir, `${key}-${sourceHash}.webp`);
}

/** The newest thumbnail already made for this output, whatever its source hash. */
function cachedThumbnail(key) {
  let found = null;
  for (const name of [...(indexed().get(key) || [])]) {
    const file = path.join(thumbnailDir, name);
    let time;
    // Gone from the folder behind this server's back (cleared by hand): forget it.
    try {
      time = fs.statSync(file).mtimeMs;
    } catch {
      indexRemove(name);
      continue;
    }
    if (!found || time > found.time) found = { file, time };
  }
  return found
    ? { file: found.file, etag: `"${path.basename(found.file, ".webp").slice(key.length + 1)}"` }
    : null;
}

/** The original's bytes: from ComfyUI, or from disk while ComfyUI is not answering. */
async function sourceBytes(filename, subfolder, type) {
  const params = new URLSearchParams({ filename, subfolder, type });
  const local = async () => {
    const file = localOutputFile(filename, subfolder, type);
    return file ? fs.promises.readFile(file) : undefined;
  };
  // Studio media is only ever on this computer.
  if (type === mediaType) return (await local()) || null;
  // ComfyUI just failed to answer: skip the slow refused connection when the file is here.
  if (comfyRecentlyUnreachable()) {
    const bytes = await local();
    if (bytes) return bytes;
  }
  try {
    const response = await fetch(`${comfyUrl}/view?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    noteComfyReachable();
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch (error) {
    noteComfyFetchError(error);
    return local();
  }
}

/*
 * The local copy of an output is only used when it is the file ComfyUI means.
 * If the output folder Studio reads isn't ComfyUI's (another install, a
 * moved folder), a file of the same name there is some other picture, and a
 * thumbnail made from it shows the wrong image while the viewer, which asks
 * ComfyUI, shows the right one. So ComfyUI is asked for one byte of the file,
 * which comes back with the file's full size, and the local copy is trusted
 * only when the sizes match. Remembered per file version, so it is one tiny
 * request per new output. With ComfyUI not answering, the disk is all there is.
 */
const checkedLocal = new Map();

export async function trustedLocalOutput(filename, subfolder = "", type = "output") {
  const file = localOutputFile(filename, subfolder, type);
  if (!file) return null;
  // Studio media is the file itself; there is no ComfyUI copy to compare it with.
  if (type === mediaType) return file;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const version = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (checkedLocal.has(version)) return checkedLocal.get(version) ? file : null;
  if (comfyRecentlyUnreachable()) return file;
  let same;
  try {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${comfyUrl}/view?${params}`, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(5000),
    });
    noteComfyReachable();
    await response.body?.cancel().catch(() => {});
    const total =
      response.status === 206
        ? Number(String(response.headers.get("content-range") || "").split("/")[1])
        : response.ok
          ? Number(response.headers.get("content-length"))
          : NaN;
    // ComfyUI doesn't have it at all: the local file belongs to some other folder.
    if (response.status === 404) same = false;
    else same = !Number.isFinite(total) || total <= 0 || total === stat.size;
  } catch (error) {
    noteComfyFetchError(error);
    return file;
  }
  if (checkedLocal.size > 5000) checkedLocal.delete(checkedLocal.keys().next().value);
  checkedLocal.set(version, same);
  return same ? file : null;
}

/**
 * An output that is on this computer is identified by its size and modified
 * time, so a cached thumbnail is found with one stat instead of downloading
 * and hashing the full image on every request. A reused filename changes both.
 */
async function localSource(filename, subfolder, type) {
  const file = await trustedLocalOutput(filename, subfolder, type);
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    const sourceHash = crypto
      .createHash("sha256")
      .update(`local:${stat.size}:${stat.mtimeMs}`)
      .digest("hex");
    return { file, sourceHash };
  } catch {
    return null;
  }
}

async function build(filename, subfolder, type, size) {
  const key = cacheKey(filename, subfolder, type, size);
  const local = await localSource(filename, subfolder, type);
  if (local) {
    const file = cachePath(key, local.sourceHash);
    if (fs.existsSync(file)) return { file, etag: `\"${local.sourceHash}\"` };
    const made = await inSlot(async () => {
      if (fs.existsSync(file)) return { file, etag: `\"${local.sourceHash}\"` };
      // sharp reads the file itself, off the main thread, instead of it being
      // read here into a buffer first. Unreadable: try ComfyUI below.
      try {
        return await writeThumbnail(key, local.sourceHash, local.file, size);
      } catch {
        return null;
      }
    });
    if (made) return made;
  }
  // Not on this computer (a remote ComfyUI, or an input/temp file). ComfyUI
  // installations do not consistently provide a useful ETag, and a reused
  // filename could otherwise receive an unrelated old preview, so hash the bytes.
  return inSlot(async () => {
    const source = await sourceBytes(filename, subfolder, type);
    // ComfyUI is down and the file is not on this computer: an earlier thumbnail still beats nothing.
    if (source === undefined) return cachedThumbnail(key);
    if (!source) return null;
    const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
    const file = cachePath(key, sourceHash);
    if (fs.existsSync(file)) return { file, etag: `\"${sourceHash}\"` };
    return writeThumbnail(key, sourceHash, source, size);
  });
}

async function writeThumbnail(key, sourceHash, source, size = "thumb") {
  const file = cachePath(key, sourceHash);
  const sharp = await loadSharp();
  if (!sharp) return { original: true };
  const { longestEdge, quality } = renditionOf(size);
  // .rotate() turns a phone photo (a library image) upright by its EXIF
  // orientation, which WebP doesn't carry; outputs have none and are unchanged.
  const resized = await sharp(source)
    .rotate()
    .resize({ width: longestEdge, height: longestEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();

  await fs.promises.mkdir(thumbnailDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temp, resized);
    await renameWithRetryAsync(temp, file);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  const name = path.basename(file);
  // Best-effort: drop any earlier cached thumbnail for this resource under a stale ETag.
  for (const entry of [...(indexed().get(key) || [])]) {
    if (entry === name) continue;
    // Synchronous, so the stale file is gone by the time the new one is served.
    try {
      fs.rmSync(path.join(thumbnailDir, entry), { force: true });
      indexRemove(entry);
    } catch {
      /* in use (Windows); next build retries */
    }
  }
  indexAdd(name);
  lastUsed.set(file, Date.now());
  maybeSweep();
  return { file, etag: `\"${sourceHash}\"` };
}

// Concurrent requests for the same not-yet-cached image share one build instead of
// each downloading and resizing the source independently. Without sharp there is
// nothing to build: an earlier thumbnail, else `{ original: true }` (serve the full image).
// `size` is a rendition: "thumb" for the grid, "display" for the viewer.
export async function getThumbnail(filename, subfolder, type, size = "thumb") {
  const result = await findOrBuild(filename, subfolder, type, size);
  if (result?.file) noteUsed(result.file);
  return result;
}

/** Builds an output's thumbnail ahead of its first view (media-warmup.js); unlike a request, not a use. */
export function warmThumbnail(filename, subfolder = "", type = "output", size = "thumb") {
  return findOrBuild(filename, subfolder, type, size);
}

async function findOrBuild(filename, subfolder, type, size = "thumb") {
  if (!RENDITIONS[size]) size = "thumb";
  if (!(await loadSharp()))
    return cachedThumbnail(cacheKey(filename, subfolder, type, size)) || { original: true };
  const dedupeKey = `${size}:${type}:${subfolder}:${filename}`;
  if (pending.has(dedupeKey)) return pending.get(dedupeKey);
  const promise = build(filename, subfolder, type, size).finally(() => pending.delete(dedupeKey));
  pending.set(dedupeKey, promise);
  return promise;
}

/**
 * A thumbnail for any image file on this computer (an image added from
 * another folder), cached like an output's, by the file's path, size and
 * modified time. The caller checks the file is one it may serve.
 */
export async function getFileThumbnail(file) {
  const result = await findOrBuildFile(file);
  // Served now, so the cache cap keeps it like an output's thumbnail.
  if (result?.file) noteUsed(result.file);
  return result;
}

async function findOrBuildFile(file) {
  const resolved = path.resolve(file);
  const key = crypto
    .createHash("sha1")
    .update(`file:${resolved}:${longestEdge}:${quality}`)
    .digest("hex");
  if (!(await loadSharp())) return cachedThumbnail(key) || { original: true };
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    const stat = await fs.promises.stat(resolved);
    const sourceHash = crypto
      .createHash("sha256")
      .update(`local:${stat.size}:${stat.mtimeMs}`)
      .digest("hex");
    const cached = cachePath(key, sourceHash);
    if (fs.existsSync(cached)) return { file: cached, etag: `"${sourceHash}"` };
    return inSlot(() => writeThumbnail(key, sourceHash, resolved));
  })().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/** The filename, subfolder and type a /comfy/view or /comfy/thumb URL names, or null. */
export function viewParams(url = "") {
  const text = String(url || "");
  if (!/^\/comfy\/(view|thumb)\?/.test(text)) return null;
  const params = new URLSearchParams(text.slice(text.indexOf("?") + 1));
  const filename = params.get("filename") || "";
  return filename
    ? { filename, subfolder: params.get("subfolder") || "", type: params.get("type") || "output" }
    : null;
}

/**
 * Deletes every cached thumbnail of one output. Hiding an image must leave
 * nothing of it in the open, and a thumbnail is a small copy of it.
 * Returns how many files went.
 */
export function forgetThumbnail(filename, subfolder = "", type = "output") {
  if (!filename) return 0;
  // Every rendition: the viewer's display copy is as much a copy as the thumbnail.
  const keys = Object.keys(RENDITIONS).map((size) => cacheKey(filename, subfolder, type, size));
  let removed = 0;
  let names = [];
  try {
    names = fs.readdirSync(thumbnailDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!keys.some((key) => name.startsWith(`${key}-`))) continue;
    try {
      fs.rmSync(path.join(thumbnailDir, name), { force: true });
      indexRemove(name);
      removed += 1;
    } catch {
      // Held open for a moment (Windows); the caller can try again.
    }
  }
  return removed;
}

/**
 * Forgets the thumbnails of a gallery item: its original, its thumbnail URL
 * and its upscale. A thumbnail still being made for it is waited for first,
 * so it cannot land on disk just after.
 */
export async function forgetItemThumbnails(item) {
  let removed = 0;
  for (const url of [
    item?.url,
    item?.thumbnailUrl,
    item?.upscale?.url,
    item?.upscale?.thumbnailUrl,
  ]) {
    const params = viewParams(url);
    if (!params) continue;
    for (const size of Object.keys(RENDITIONS))
      await pending
        .get(`${size}:${params.type}:${params.subfolder}:${params.filename}`)
        ?.catch(() => null);
    removed += forgetThumbnail(params.filename, params.subfolder, params.type);
  }
  return removed;
}
