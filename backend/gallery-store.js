import {
  readRuntimeDocument,
  usesRuntimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { generationRecord } from "./generation-record.js";
import { hasGalleryFilters, matchesGalleryFilters } from "./gallery-filters.js";
import { mediaFile, mediaParams, mediaPath } from "./media-paths.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir, localOutputFile } from "./comfy.js";
import { defaultWorkerId } from "./workers.js";

import {
  readJsonFile,
  removeStaleTemporaries,
  writeJsonFile,
  writeJsonFileAsync,
} from "./json-store.js";
import { isInside } from "./paths.js";
import {
  compareGalleryItems,
  compareGalleryKeys,
  galleryOrderKey,
  galleryTime,
} from "./gallery-order.js";
import { currentDataDir } from "./data-dir.js";
import { recordBelongsToAccount } from "./account-ownership.js";
import { hasReferenceImage } from "./workflow-modes.js";
import { replyTitle } from "../shared/titles.ts";

export const dataDir = currentDataDir();
export const galleryPath = path.join(dataDir, "gallery.json");
const hiddenGalleryPath = path.join(dataDir, "gallery-hidden.json");
export const galleryLimit = Number(process.env.STUDIO_GALLERY_LIMIT || 50000);

let galleryRevision = Date.now();
// Bumped whenever the hide markers change, so a cached page list knows to rebuild.
let hiddenVersion = 0;

function loadGallery() {
  const database = usesRuntimeDatabase(dataDir);
  try {
    if (!database) removeStaleTemporaries(galleryPath);
    const staleAfter = 30 * 60 * 1000;
    return (database ? readRuntimeDocument(dataDir, "gallery") : readJsonFile(galleryPath)).map(
      (item) => {
        let next = item;
        if (
          !database &&
          next.status === "pending" &&
          Date.now() - Date.parse(next.createdAt || 0) > staleAfter
        ) {
          next = { ...next, status: "canceled" };
        }
        // Backfill thumbnailUrl for items saved before the thumbnail pipeline existed.
        if (
          next.type === "image" &&
          !next.thumbnailUrl &&
          typeof next.url === "string" &&
          next.url.startsWith("/comfy/view?")
        ) {
          next = { ...next, thumbnailUrl: next.url.replace("/comfy/view?", "/comfy/thumb?") };
        }
        return next;
      },
    );
  } catch (error) {
    if (database && error.code !== "ENOENT") throw error;
    return [];
  }
}

export let gallery = loadGallery();

/*
 * Markers for outputs that were deleted or cleared, so they never come back
 * out of ComfyUI's history. Their keys are output names, and a list of what
 * was deleted should not say what was deleted: each marker is stored as a
 * keyed digest (HMAC-SHA256 under data/.gallery-marker-key), which can be
 * checked against a name but never read back into one. Lists from before are
 * turned into digests the first time they are read.
 */
const markerKeyPath = path.join(dataDir, ".gallery-marker-key");
const markerPrefix = "h:";
let markerKey = null;
const markerCache = new Map();

function loadMarkerKey() {
  if (markerKey) return markerKey;
  try {
    const saved = Buffer.from(fs.readFileSync(markerKeyPath, "utf8").trim(), "base64url");
    if (saved.length === 32) return (markerKey = saved);
  } catch {
    // None yet.
  }
  markerKey = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(markerKeyPath, markerKey.toString("base64url"), { mode: 0o600 });
  return markerKey;
}

/** The stored form of a gallery key's marker. */
export function markerOf(key) {
  const text = String(key || "");
  if (!text) return "";
  let marker = markerCache.get(text);
  if (!marker) {
    marker = `${markerPrefix}${crypto.createHmac("sha256", loadMarkerKey()).update(text).digest("base64url")}`;
    if (markerCache.size > 200000) markerCache.clear();
    markerCache.set(text, marker);
  }
  return marker;
}

let hiddenGalleryIds = loadHiddenGalleryIds();

function loadHiddenGalleryIds() {
  const database = usesRuntimeDatabase(dataDir);
  let raw;
  try {
    raw = database
      ? readRuntimeDocument(dataDir, "gallery-hidden")
      : readJsonFile(hiddenGalleryPath);
  } catch (error) {
    if (database && error.code !== "ENOENT") throw error;
    return new Map();
  }
  const entries = Array.isArray(raw)
    ? raw.filter((key) => !String(key).startsWith("/comfy/view?")).map((key) => [key, Date.now()])
    : Object.entries(raw || {}).map(([key, value]) => [key, Number(value) || 0]);
  const plain = entries.filter(([key]) => !String(key).startsWith(markerPrefix));
  const markers = new Map(
    entries.map(([key, value]) => [
      String(key).startsWith(markerPrefix) ? key : markerOf(key),
      value,
    ]),
  );
  if (plain.length || Array.isArray(raw)) {
    try {
      // Twice, so the store's .bak copy of the readable list is replaced too.
      persistHiddenMarkers(Object.fromEntries(markers));
      persistHiddenMarkers(Object.fromEntries(markers));
    } catch {
      // Stays as it was until the next save.
    }
  }
  return markers;
}

export function galleryKey(item) {
  return item?.url || item?.id || item?.outputName || item?.filename || "";
}

export function galleryRevisionValue() {
  return galleryRevision;
}

export function sortGallery(items = gallery) {
  return [...items].sort(compareGalleryItems);
}

function bumpRevision() {
  galleryRevision = Math.max(galleryRevision + 1, Date.now());
  return galleryRevision;
}

/** Something the item diff cannot see changed (run grouping): the revision moves on. */
export function markGalleryReset() {
  return bumpRevision();
}

function withoutPreview({ preview, ...rest }) {
  return rest;
}

/** Whether any item was added, removed or replaced with different content. */
function galleryChanged(before, after) {
  const beforeMap = new Map(before.map((item) => [galleryKey(item), item]).filter(([key]) => key));
  const afterMap = new Map(after.map((item) => [galleryKey(item), item]).filter(([key]) => key));
  if (beforeMap.size !== afterMap.size) return true;
  for (const [key, item] of afterMap) {
    const previous = beforeMap.get(key);
    if (previous === item) continue;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) return true;
  }
  return false;
}

export function setGallery(items, options = {}) {
  const before = gallery;
  gallery = sortGallery(items).slice(0, galleryLimit);
  if (options.track !== false) {
    if (galleryChanged(before, gallery)) bumpRevision();
  }
  if (options.persist !== false) saveGallery();
}

export function isComfyOutputItem(item) {
  return Boolean(item?.url && String(item.url).startsWith("/comfy/view?"));
}

export function hideGalleryItems(items) {
  const hiddenAt = Date.now();
  let marked = false;
  for (const item of items) {
    const key = galleryKey(item);
    if (key) {
      hiddenGalleryIds.set(markerOf(key), hiddenAt);
      marked = true;
    }
  }
  if (marked) bumpRevision();
  saveHiddenGalleryIds();
}

export function isGalleryHidden(item) {
  const key = galleryKey(item);
  if (!key || !hiddenGalleryIds.size) return false;
  const marker = markerOf(key);
  if (!hiddenGalleryIds.has(marker)) return false;
  const hiddenAt = Number(hiddenGalleryIds.get(marker) || 0);
  const createdAt = Date.parse(item?.createdAt || "");
  if (hiddenAt && Number.isFinite(createdAt) && createdAt > hiddenAt) return false;
  return true;
}

/** A Dream result the person has not kept: it lives in Dream's own pool (domain/dream.ts), not the gallery. */
const inDreamPool = (item) => Boolean(item?.dream && item.dream.state !== "kept");

export function filterVisibleGallery(items) {
  return items.filter((item) => {
    if (isGalleryHidden(item) || inDreamPool(item)) return false;
    return isComfyOutputItem(item) ? hasExistingOutputFile(item) : true;
  });
}

/**
 * The visible list a page is cut from, kept between requests. Scrolling a
 * large gallery asks for page after page; filtering and sorting all of it for
 * each one made every page cost as much as the whole. The list is rebuilt when
 * anything it depends on changes: the gallery (its revision), hide markers,
 * the output folder, or a folder listing (a file added or deleted outside).
 */
let visibleCache = { key: "", lists: new Map() };

let visibleListBuilds = 0;
/** How often a page list was built from the whole gallery; the paging test counts it. */
export const visibleListBuildCount = () => visibleListBuilds;

function visibleItems({ type = "", includeFailed = true, filter = null } = {}) {
  refreshFolderListings();
  const trusted = comfyOutputDir ? outputFolderTrusted() : true;
  const key = `${galleryRevision}|${hiddenVersion}|${listingGeneration}|${comfyOutputDir}|${trusted}`;
  if (visibleCache.key !== key) visibleCache = { key, lists: new Map() };
  const listKey = `${type}|${includeFailed}`;
  let entry = visibleCache.lists.get(listKey);
  if (!entry) {
    // The gallery is kept sorted, so this sort only confirms the order (linear on sorted input).
    const items = sortGallery(filterVisibleGallery(gallery)).filter((item) => {
      if (type && item.type !== type) return false;
      if (!includeFailed && item.status === "error") return false;
      return item.status !== "canceled";
    });
    entry = { items, positions: null };
    visibleListBuilds += 1;
    visibleCache.lists.set(listKey, entry);
  }
  // A search filters the cached list; its positions are its own, so it is not kept.
  return filter ? { items: entry.items.filter(filter), positions: null } : entry;
}

/** Where the page after `cursor` starts: right after the cursor's own item while it is listed, else the first one past its time. */
function pageStart(entry, cursor) {
  if (!cursor) return 0;
  if (!entry.positions)
    entry.positions = new Map(entry.items.map((item, index) => [cursorFor(item), index]));
  const exact = entry.positions.get(String(cursor));
  if (exact !== undefined) return exact + 1;
  if (!String(cursor).startsWith("v2|")) {
    const [timeText, encodedId = ""] = String(cursor).split("|");
    const id = decodeURIComponent(encodedId);
    const legacy = entry.items.findIndex(
      (item) =>
        String(item.id || item.url || "") === id && galleryTime(item) === Number(timeText || 0),
    );
    if (legacy >= 0) return legacy + 1;
  }
  const found = entry.items.findIndex((item) => afterCursor(item, cursor));
  return found < 0 ? entry.items.length : found;
}

/* ---------------------------------------------------------------- Search */

const searchTexts = new WeakMap();

/** What a gallery search looks through: the title (domain/titles.ts), the prompts, the caption (domain/captions.ts), the model and LoRAs, and the file's name. */
function gallerySearchText(item) {
  if (!item || typeof item !== "object") return "";
  let text = searchTexts.get(item);
  if (text === undefined) {
    const settings = item.settings || {};
    const loras = Array.isArray(settings.loras)
      ? settings.loras.map((lora) => lora?.name || "")
      : [];
    text = [
      item.title,
      item.prompt,
      item.negative,
      item.caption?.text,
      ...(Array.isArray(item.caption?.tags) ? item.caption.tags : []),
      item.model,
      settings.modelName,
      settings.profileId,
      settings.workflow,
      item.outputName,
      ...loras,
    ]
      .filter((value) => typeof value === "string" && value)
      .join("\n")
      .toLowerCase();
    searchTexts.set(item, text);
  }
  return text;
}

/**
 * A gallery filter for a search: every word must appear somewhere, or the
 * image looks like the search (`near`, from domain/image-search.ts), and
 * `favorites` keeps starred images only. Runs still generating always pass,
 * so a search never hides the progress of what is being made right now.
 * Null when there is nothing to filter by.
 */
export function galleryFilter({
  q = "",
  near = null,
  favorites = false,
  lora = "",
  model = "",
  workflow = "",
  size = "",
  aspect = "",
} = {}) {
  const terms = String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  if (!terms.length && !favorites && !hasGalleryFilters({ lora, model, workflow, size, aspect }))
    return null;
  return (item) => {
    if (item.status === "pending") return true;
    if (favorites && !item.favorite) return false;
    if (!matchesGalleryFilters(item, { lora, model, workflow, size, aspect })) return false;
    if (!terms.length) return true;
    const text = gallerySearchText(item);
    return terms.every((term) => text.includes(term)) || Boolean(near?.(item));
  };
}

/** Stars (or unstars) finished gallery items. Returns the items that changed. */
export function setGalleryFavorites(keys, favorite) {
  const wanted = new Set(keys.map(String).filter(Boolean));
  const upserts = [];
  gallery = gallery.map((item) => {
    if (!wanted.has(item.id) && !wanted.has(item.url) && !wanted.has(galleryKey(item))) return item;
    if (item.status !== "done" || Boolean(item.favorite) === Boolean(favorite)) return item;
    const { favorite: _favorite, ...rest } = item;
    const next = favorite ? { ...rest, favorite: true } : rest;
    upserts.push(next);
    return next;
  });
  if (upserts.length) {
    bumpRevision();
    saveGallery();
  }
  return upserts;
}

function cursorFor(item) {
  if (!item) return "";
  return `v2|${encodeURIComponent(JSON.stringify(galleryOrderKey(item)))}`;
}

function afterCursor(item, cursor = "") {
  if (!cursor) return true;
  if (String(cursor).startsWith("v2|")) {
    try {
      const key = JSON.parse(decodeURIComponent(String(cursor).slice(3)));
      return compareGalleryKeys(galleryOrderKey(item), key) > 0;
    } catch {
      return false;
    }
  }
  const [timeText, encodedId = ""] = String(cursor).split("|");
  const cursorTime = Number(timeText || 0);
  const cursorId = decodeURIComponent(encodedId);
  return (
    compareGalleryKeys(galleryOrderKey(item), {
      bucket: 0,
      time: cursorTime,
      id: cursorId,
      jobId: "",
      index: 0,
    }) > 0
  );
}

export function pageGallery({
  type = "",
  limit = 200,
  cursor = "",
  includeFailed = true,
  filter = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 200)));
  const entry = visibleItems({ type, includeFailed, filter });
  const all = entry.items;
  const start = pageStart(entry, cursor);
  const items = all.slice(start, start + safeLimit);
  const nextCursor = start + safeLimit < all.length ? cursorFor(items[items.length - 1]) : "";
  return {
    items,
    nextCursor,
    hasMore: Boolean(nextCursor),
    revision: galleryRevision,
    totalApprox: all.length,
  };
}

/** Imported image paths are derived from the provider ID, never supplied paths. */
export function importedImageFile(item) {
  const id = /^civitai:([1-9]\d*)$/.exec(String(item?.id || ""))?.[1];
  return id && item.url === `/api/presets/${id}/media`
    ? path.join(dataDir, "imported-images", `${id}.${item.type === "video" ? "mp4" : "png"}`)
    : "";
}

export function outputFileCandidates(item, baseDir = comfyOutputDir) {
  // Studio-owned media has exactly one place, whatever folder ComfyUI uses.
  const media = mediaParams(item?.url);
  if (media) {
    const file = mediaPath(media.filename, media.subfolder);
    return file ? [file] : [];
  }
  if (!baseDir) return [];
  const keys = [item?.url, item?.id, item?.outputName, item?.filename].filter(Boolean);
  const candidates = [];
  for (const key of keys) {
    let filename = "";
    let subfolder = "";
    if (String(key).startsWith("/comfy/view?")) {
      const params = new URLSearchParams(String(key).split("?")[1] || "");
      filename = params.get("filename") || "";
      subfolder = params.get("subfolder") || "";
    } else if (String(key).startsWith("http")) {
      try {
        const parsed = new URL(String(key));
        filename = parsed.searchParams.get("filename") || path.basename(parsed.pathname);
        subfolder = parsed.searchParams.get("subfolder") || "";
      } catch {
        filename = path.basename(String(key));
      }
    } else {
      filename = path.basename(String(key));
    }
    if (!filename || filename === "." || filename === "/") continue;
    const base = path.resolve(baseDir);
    const withSubfolder =
      subfolder && path.basename(base).toLowerCase() !== path.basename(subfolder).toLowerCase()
        ? path.resolve(base, subfolder, filename)
        : path.resolve(base, filename);
    candidates.push(withSubfolder);
  }
  return [...new Set(candidates)];
}

let galleryFilesDeleted = () => {};
/** Hears every gallery item whose files are deleted, so its derived data (search vectors) goes too. */
export function onGalleryFilesDeleted(listener) {
  galleryFilesDeleted = listener;
}

export function deleteGalleryFiles(items) {
  galleryFilesDeleted(items);
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  let deleted = 0;
  let skipped = 0;
  for (const item of items) {
    const imported = importedImageFile(item);
    if (imported) {
      try {
        if (fs.existsSync(imported)) {
          fs.unlinkSync(imported);
          deleted += 1;
        }
      } catch {
        skipped += 1;
      }
      continue;
    }
    const media = mediaParams(item.url);
    if (media) {
      const file = mediaFile(media.filename, media.subfolder);
      try {
        if (file) {
          fs.unlinkSync(file);
          deleted += 1;
        }
      } catch {
        skipped += 1;
      }
      continue;
    }
    if (!base) continue;
    for (const file of outputFileCandidates(item)) {
      const resolved = path.resolve(file);
      if (!isInside(base, resolved, { orSame: true })) {
        skipped += 1;
        continue;
      }
      try {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          fs.unlinkSync(resolved);
          deleted += 1;
        }
      } catch {
        skipped += 1;
      }
    }
  }
  return { deleted, skipped };
}

function outputFileExistsIn(item, baseDir) {
  const base = path.resolve(baseDir);
  return outputFileCandidates(item, base).some((file) => {
    const resolved = path.resolve(file);
    if (!isInside(base, resolved, { orSame: true })) return false;
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * How many of the newest finished Comfy outputs actually sit in `baseDir`.
 * This is what tells a right output folder from a merely existing one.
 */
export function outputFolderMatch(baseDir = comfyOutputDir, items = gallery, sampleSize = 12) {
  if (!baseDir) return { checked: 0, found: 0 };
  const sample = sortGallery(
    items.filter((item) => item?.status === "done" && isComfyOutputItem(item)),
  ).slice(0, sampleSize);
  return {
    checked: sample.length,
    found: sample.filter((item) => outputFileExistsIn(item, baseDir)).length,
  };
}

// A wrong output folder must never read as an empty gallery. Missing files only
// hide cards once the folder has shown it holds at least one recent output.
let folderTrust = { dir: "", checkedAt: 0, trusted: true };
function outputFolderTrusted() {
  const now = Date.now();
  if (folderTrust.dir === comfyOutputDir && now - folderTrust.checkedAt < 15000)
    return folderTrust.trusted;
  let trusted = false;
  try {
    if (fs.statSync(comfyOutputDir).isDirectory()) {
      const { checked, found } = outputFolderMatch();
      trusted = checked === 0 || found > 0;
    }
  } catch {
    trusted = false;
  }
  folderTrust = { dir: comfyOutputDir, checkedAt: now, trusted };
  return trusted;
}

// Counts listing changes, so the cached page list notices a file added or deleted outside the app.
let listingGeneration = 0;

function sameNames(a, b) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const name of a) if (!b.has(name)) return false;
  return true;
}

/** Re-checks every folder a page depends on: a stat each, at most once a second. */
function refreshFolderListings() {
  for (const dir of [...folderListings.keys()]) folderListing(dir);
}

// Every gallery page checks every output still exists, so a stat per item
// would mean thousands of blocking calls per request. Each folder's listing is
// read once instead, and read again when the folder's modified time changes
// (a file was added or deleted, e.g. in Finder or Explorer).
const folderListings = new Map();
const listingRecheckMs = 1000;
const listingMaxAgeMs = 60_000;
const caseInsensitiveFs = process.platform === "darwin" || process.platform === "win32";
const listedName = (name) => (caseInsensitiveFs ? name.toLowerCase() : name);

function folderListing(dir) {
  const now = Date.now();
  const cached = folderListings.get(dir);
  if (cached && now - cached.statAt < listingRecheckMs) return cached.names;
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    stat = null;
  }
  if (!stat?.isDirectory()) {
    if (cached?.names) listingGeneration += 1;
    folderListings.set(dir, { statAt: now, readAt: now, mtimeMs: -1, names: null });
    return null;
  }
  // A listing read within 2 s of the folder's last change may predate a write in
  // the same mtime tick (FAT/exFAT round to 2 s), so it is only reused after that.
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.readAt - stat.mtimeMs > 2000 &&
    now - cached.readAt < listingMaxAgeMs
  ) {
    cached.statAt = now;
    return cached.names;
  }
  let names = null;
  try {
    names = new Set(fs.readdirSync(dir).map(listedName));
  } catch {
    names = null;
  }
  if (!cached || !sameNames(cached.names, names)) listingGeneration += 1;
  if (folderListings.size > 500) folderListings.clear();
  folderListings.set(dir, { statAt: now, readAt: now, mtimeMs: stat.mtimeMs, names });
  return names;
}

// Where an item's output could be, worked out once per item object (items are
// replaced, never mutated) and output folder.
const itemOutputPaths = new WeakMap();

function outputPathsFor(item, base) {
  const cached = itemOutputPaths.get(item);
  if (cached?.base === base) return cached.paths;
  const paths = outputFileCandidates(item, base)
    .map((file) => path.resolve(file))
    .filter((file) => isInside(base, file, { orSame: true }))
    .map((file) => ({ file, dir: path.dirname(file), name: listedName(path.basename(file)) }));
  itemOutputPaths.set(item, { base, paths });
  return paths;
}

// Outputs this server just recorded as finished. A folder listing can lag
// behind a new file (it is re-read at most once a second, and a network or
// synced folder's own listing can trail by more), and a page or the reference
// picker built in that window left the new image out. These are checked on
// the file itself for a while instead.
const freshOutputs = new Map();
const freshOutputMs = 10 * 60 * 1000;
function markFreshOutputs(items) {
  const now = Date.now();
  for (const item of items) {
    const key = galleryKey(item);
    if (key) freshOutputs.set(key, now);
  }
  if (freshOutputs.size > 500)
    for (const [key, at] of freshOutputs) if (now - at > freshOutputMs) freshOutputs.delete(key);
}

export function hasExistingOutputFile(item) {
  const media = mediaParams(item?.url);
  if (media) {
    const file = mediaPath(media.filename, media.subfolder);
    if (!file) return false;
    if (folderListing(path.dirname(file))?.has(listedName(path.basename(file)))) return true;
    const freshAt = freshOutputs.get(galleryKey(item));
    return Boolean(freshAt && Date.now() - freshAt < freshOutputMs && fs.existsSync(file));
  }
  if (!comfyOutputDir || !outputFolderTrusted()) return true;
  const base = path.resolve(comfyOutputDir);
  const paths = outputPathsFor(item, base);
  if (paths.some(({ dir, name }) => Boolean(folderListing(dir)?.has(name)))) return true;
  const freshAt = freshOutputs.get(galleryKey(item));
  return Boolean(
    freshAt &&
    Date.now() - freshAt < freshOutputMs &&
    paths.some(({ file }) => fs.existsSync(file)),
  );
}

/**
 * Saving. A large gallery is tens of megabytes of JSON, so changes are
 * gathered for a moment and written compact and in the background (see
 * writeJsonFileAsync): the server keeps answering while it saves. The file is
 * still replaced whole, with the previous copy kept as .bak, and a save that
 * is due when the server stops is written before it exits.
 */
const saveDelayMs = Math.max(0, Number(process.env.STUDIO_GALLERY_SAVE_MS ?? 1000));
let saveTimer = null;
let dirty = false;
let writing = null;
// Which save is newest, so a slow background write never replaces a newer one.
let writeSequence = 0;
let committedSequence = 0;
// Counts changes, so a strict flush waits for its own changes rather than for
// the gallery to go quiet: changes made while a save is under way are not failures.
let changeCount = 0;
let savedChangeCount = 0;
let saveFailure = null;

function persistableGallery() {
  const items = [];
  for (const item of gallery) {
    items.push(item.preview ? withoutPreview(item) : item);
    if (items.length >= galleryLimit) break;
  }
  return items;
}

export function saveGallery() {
  changeCount += 1;
  dirty = true;
  if (saveTimer || writing) return;
  saveTimer = setTimeout(() => {
    flushGallery().catch(() => {});
  }, saveDelayMs);
  saveTimer.unref?.();
}

/** Writes pending changes now, in the background. Resolves once they are on disk. */
export async function flushGallery() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (writing) {
    await writing.catch(() => {});
    return dirty ? flushGallery() : undefined;
  }
  if (!dirty) return undefined;
  dirty = false;
  const sequence = (writeSequence += 1);
  const changes = changeCount;
  writing = (
    usesRuntimeDatabase(dataDir)
      ? Promise.resolve().then(() => {
          writeRuntimeDocument(dataDir, "gallery", persistableGallery());
          return true;
        })
      : writeJsonFileAsync(galleryPath, persistableGallery(), {
          shouldCommit: () => sequence > committedSequence,
        })
  )
    .then((replaced) => {
      if (replaced) committedSequence = sequence;
      // Not replaced means a newer save, holding these changes too, already landed.
      savedChangeCount = Math.max(savedChangeCount, changes);
      saveFailure = null;
    })
    .catch((error) => {
      // Try again shortly; the old file (and its backup) are still whole.
      dirty = true;
      saveFailure = error;
      console.warn(`[Studio] Could not save the gallery: ${error.message}`);
    })
    .finally(() => {
      writing = null;
      if (dirty && !saveTimer) {
        saveTimer = setTimeout(
          () => {
            flushGallery().catch(() => {});
          },
          Math.max(saveDelayMs, 1000),
        );
        saveTimer.unref?.();
      }
    });
  return writing;
}

/** A workload may release its lease only when all gallery changes are durable. */
export async function flushGalleryStrict() {
  const changes = changeCount;
  while (savedChangeCount < changes) {
    await flushGallery();
    if (savedChangeCount < changes && saveFailure)
      throw new Error(
        `The gallery could not be saved (${saveFailure.message}). Outputs remain reserved.`,
        { cause: saveFailure },
      );
  }
}

function persistHiddenMarkers(value) {
  if (usesRuntimeDatabase(dataDir)) writeRuntimeDocument(dataDir, "gallery-hidden", value);
  else writeJsonFile(hiddenGalleryPath, value);
}

/** Writes the gallery at once, blocking: for when the process is about to exit. */
function writeGalleryNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const sequence = (writeSequence += 1);
  const changes = changeCount;
  try {
    if (usesRuntimeDatabase(dataDir))
      writeRuntimeDocument(dataDir, "gallery", persistableGallery());
    else writeJsonFile(galleryPath, persistableGallery(), { compact: true });
  } catch (error) {
    saveFailure = error;
    throw error;
  }
  dirty = false;
  committedSequence = sequence;
  savedChangeCount = changes;
  saveFailure = null;
}

export function flushPendingGallery() {
  if (!dirty && !writing) return;
  try {
    writeGalleryNow();
  } catch (error) {
    console.warn(`[Studio] Could not save the gallery before stopping: ${error.message}`);
  }
}

/** Viewer deletion for several of one owner's items: files, delete markers and records. */
export function deleteOwnedGalleryItems(ownerId, ids) {
  const wanted = new Set(ids);
  const account = ownerId ? { userId: ownerId } : undefined;
  const removed = gallery.filter(
    (item) => wanted.has(item.id) && recordBelongsToAccount(item, account),
  );
  const files = deleteGalleryFiles(removed);
  hideGalleryItems(removed);
  const gone = new Set(removed);
  setGallery(gallery.filter((item) => !gone.has(item)));
  if (removed.length) saveGallery();
  return { removed: removed.map((item) => item.id), files };
}

/** Items added or put back, newest first like everything else. */
export function addGalleryItems(items) {
  // A name ComfyUI reused may carry a delete marker from an older image; this one is wanted.
  let cleared = false;
  for (const item of items)
    cleared = hiddenGalleryIds.delete(markerOf(galleryKey(item))) || cleared;
  if (cleared) saveHiddenGalleryIds();
  // Just written, so a folder listing that has not caught up yet must not hide them.
  markFreshOutputs(items);
  setGallery(dedupeGallery([...items, ...gallery]));
}

function saveHiddenGalleryIds() {
  hiddenVersion += 1;
  fs.mkdirSync(dataDir, { recursive: true });
  const entries = [...hiddenGalleryIds.entries()].slice(-galleryLimit * 2);
  persistHiddenMarkers(Object.fromEntries(entries));
}

export function promptTitle(text = "") {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > 68 ? `${oneLine.slice(0, 65)}...` : oneLine || "Untitled prompt";
}

export function outputsFrom(history) {
  const urls = [];
  for (const output of Object.values(history.outputs || {})) {
    const imageItems = Array.isArray(output?.images)
      ? output.images.map((item) => [item, "image"])
      : [];
    const videoItems = Array.isArray(output?.videos)
      ? output.videos.map((item) => [item, "video"])
      : [];
    for (const [item, collectionType] of [...imageItems, ...videoItems]) {
      const filename = typeof item?.filename === "string" ? item.filename : "";
      if (!filename) continue;
      const params = new URLSearchParams({
        filename,
        subfolder: item.subfolder || "",
        type: item.type || "output",
      });
      const isVideo = collectionType === "video" || /\.(mp4|webm|mov|mkv)$/i.test(filename);
      urls.push({
        url: `/comfy/view?${params}`,
        thumbnailUrl: isVideo ? undefined : `/comfy/thumb?${params}`,
        filename,
        type: isVideo ? "video" : "image",
      });
    }
  }
  return urls;
}

/**
 * What a ComfyUI API graph made: its prompts, size, model and LoRAs, as far as
 * the common nodes tell. The graph comes from ComfyUI's history or from the
 * "prompt" text chunk ComfyUI writes into every PNG it saves.
 */
export function describeComfyGraph(graph = {}) {
  const textNodes = Object.values(graph || {}).filter(
    (node) => node?.class_type === "CLIPTextEncode",
  );
  const prompt = textNodes[0]?.inputs?.text || "";
  const negative = textNodes[1]?.inputs?.text || "";
  const latentNode = Object.values(graph || {}).find(
    (node) =>
      /Latent/i.test(node?.class_type || "") && (node?.inputs?.width || node?.inputs?.height),
  );
  const latent = latentNode?.inputs || {};
  const modelLoader = Object.values(graph || {}).find(
    (node) => node?.inputs?.unet_name || node?.inputs?.ckpt_name,
  );
  const model = modelLoader?.inputs?.unet_name || modelLoader?.inputs?.ckpt_name || "";
  return {
    prompt: typeof prompt === "string" ? prompt : "",
    negative: typeof negative === "string" ? negative : "",
    width: Number(latent.width || 0),
    height: Number(latent.height || 0),
    model: typeof model === "string" ? model : "",
  };
}

/** A stored `assistant` record (assistant-routes.js assistantRecord), kept to its known fields, or null. */
/** The chat that asked for a run: its conversation id, as LibreChat names it (X-Studio-Conversation-Id). */
export function storedChatRecord(value) {
  const id =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.conversationId === "string"
      ? value.conversationId.trim()
      : "";
  return id && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id) ? { conversationId: id } : null;
}

/**
 * How the queue's writing stage wrote a result's prompt (prompt-stage.js): its kind, text model
 * and thinking; null for anything else.
 */
export function storedWritingRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!["animate", "request", "dream"].includes(value.kind)) return null;
  const model = typeof value.model === "string" ? value.model.trim().slice(0, 200) : "";
  const thinking = typeof value.thinking === "string" ? value.thinking.trim().slice(0, 20_000) : "";
  return { kind: value.kind, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

function storedAssistantRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.preset !== "string" ||
    !/^[a-z-]{1,40}$/.test(value.preset)
  )
    return null;
  const model = typeof value.model === "string" ? value.model.slice(0, 200) : "";
  const loras = Array.isArray(value.lorasSuggested)
    ? value.lorasSuggested.filter((name) => typeof name === "string" && name).slice(0, 8)
    : [];
  return {
    preset: value.preset,
    ...(model ? { model } : {}),
    source: value.source === "chat" ? "chat" : "ui",
    ...(loras.length ? { lorasSuggested: loras } : {}),
  };
}

export function recordsFromComfyHistory(history) {
  const records = [];
  for (const [promptId, item] of Object.entries(history || {})) {
    const graph = item?.prompt?.[2] || {};
    const saved = generationRecord(item?.prompt?.[3]);
    const textNodes = Object.values(graph).filter((node) => node?.class_type === "CLIPTextEncode");
    const prompt = textNodes[0]?.inputs?.text || "";
    const negative = textNodes[1]?.inputs?.text || "";
    const latentNode = Object.values(graph).find(
      (node) =>
        /Latent/i.test(node?.class_type || "") && (node?.inputs?.width || node?.inputs?.height),
    );
    const latent = latentNode?.inputs || {};
    const modelLoader = Object.values(graph).find(
      (node) => node?.inputs?.unet_name || node?.inputs?.ckpt_name,
    );
    const model = modelLoader?.inputs?.unet_name || modelLoader?.inputs?.ckpt_name || "";
    const loras = Object.values(graph)
      .flatMap((node) => {
        if (node?.class_type === "LoraLoader" && node?.inputs?.lora_name) {
          return [
            {
              name: node.inputs.lora_name,
              enabled: true,
              strength: Number(node.inputs.strength_model ?? node.inputs.strength_clip ?? 0.7),
            },
          ];
        }
        if (node?.class_type !== "Power Lora Loader (rgthree)") return [];
        return Object.entries(node.inputs || {})
          .filter(([key, value]) => /^lora_\d+$/i.test(key) && value?.on && value?.lora)
          .map(([, value]) => ({
            name: value.lora,
            enabled: true,
            strength: Number(value.strength ?? 0.7),
          }));
      })
      .slice(0, 8);
    const rawCreatedAt = Number(item?.prompt?.[3]?.create_time || Date.now());
    const createdAtMs =
      rawCreatedAt > 0 && rawCreatedAt < 1e12 ? rawCreatedAt * 1000 : rawCreatedAt;
    // Smart upscale's copy belongs to its picture; recovered on its own it would be a second tile.
    const own = Object.fromEntries(
      Object.entries(item?.outputs || {}).filter(([id]) => !graph[id]?._meta?.studioUpscale),
    );
    for (const output of outputsFrom({ outputs: own })) {
      const record = {
        ...output,
        id: output.url,
        jobId: saved.jobId || promptId,
        status: "done",
        prompt: saved.prompt || prompt,
        negative: saved.negative || negative,
        filename: promptTitle(saved.prompt || prompt) || output.filename,
        outputName: output.filename,
        createdAt: saved.createdAt || new Date(createdAtMs).toISOString(),
        width: Number(saved.width || latent.width || 0),
        height: Number(saved.height || latent.height || 0),
        model: saved.model || model,
        settings: saved.settings || (loras.length ? { loras } : {}),
        // How the prompt was written (the prompt assistant, in Studio or chat) survives a rebuild from history.
        ...(storedAssistantRecord(saved.assistant)
          ? { assistant: storedAssistantRecord(saved.assistant) }
          : {}),
        ...(storedChatRecord(saved.chat) ? { chat: storedChatRecord(saved.chat) } : {}),
        ...(storedWritingRecord(saved.writing)
          ? { writing: storedWritingRecord(saved.writing) }
          : {}),
        // A rebuilt Dream result goes back to Dream's pool rather than into the gallery.
        ...(saved.dream && typeof saved.dream === "object"
          ? {
              dream: {
                state: "unseen",
                prompt: String(saved.dream.prompt || ""),
                why: String(saved.dream.why || ""),
                at: String(saved.dream.at || ""),
              },
            }
          : {}),
        ...(typeof saved.ownerId === "string" && saved.ownerId ? { ownerId: saved.ownerId } : {}),
      };
      if (hasExistingOutputFile(record)) records.push(record);
    }
  }
  return records;
}

export function makePendingItems(id, body) {
  const count = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
  const title = promptTitle(body.prompt);
  const createdAt = body.createdAt || new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    jobId: id,
    index,
    url: "",
    filename: body.kind === "image" && count > 1 ? `${title} ${index + 1}` : title,
    type: body.kind === "video" ? "video" : "image",
    status: "pending",
    prompt: body.prompt || "",
    negative: body.negative || "",
    createdAt,
    // An inpaint result is the whole original picture, whatever size the crop sampled at.
    width: Number(body.inpaint?.image?.width || body.width || 0),
    height: Number(body.inpaint?.image?.height || body.height || 0),
    model: body.model || "",
    // Legacy single-reference keys, only on records that still carry one (useMediaAction.ts reads them).
    ...(body.startImageId
      ? {
          referenceImage: body.startImageId,
          referenceImageName: body.startImageName || "",
          startImageId: body.startImageId,
        }
      : {}),
    settings: generationSettings(body),
    // Written by the prompt assistant: its preset, model and chosen LoRAs (assistant-routes.js assistantRecord).
    ...(body.assistant ? { assistant: body.assistant } : {}),
    // The prompt the queue's writing stage wrote keeps its thinking, under the prompt in Details.
    ...(storedWritingRecord(body.writing) ? { writing: storedWritingRecord(body.writing) } : {}),
    ...(body.chat ? { chat: body.chat } : {}),
    ...(body.dream ? { dream: body.dream } : {}),
    ...(typeof body.ownerId === "string" && body.ownerId ? { ownerId: body.ownerId } : {}),
  }));
}

export function dedupeGallery(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.id;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanupGalleryState(jobs) {
  // Called on every gallery page: most of the time there is nothing pending
  // and no upscale running, and one pass says so without building anything.
  if (!gallery.some((item) => item.status === "pending" || item.upscale?.status === "running"))
    return;
  const runKey = (item) =>
    `${item.jobId || ""}|${item.prompt || ""}|${item.model || ""}|${item.width || ""}|${item.height || ""}`;
  const doneJobs = new Set();
  const doneKeys = new Set();
  for (const item of gallery) {
    if (item.status !== "done") continue;
    if (item.jobId) doneJobs.add(item.jobId);
    doneKeys.add(runKey(item));
  }
  const next = [];
  let changed = false;
  for (let item of gallery) {
    // Replaced, never changed in place: other readers compare items by identity.
    // An upscale whose job this server never ran (it restarted mid-upscale) is not running anymore.
    if (item.upscale?.status === "running" && !jobs.has(item.upscale.jobId)) {
      item = { ...item, upscale: { ...item.upscale, status: "canceled", progress: null } };
      changed = true;
    }
    if (item.status === "pending") {
      if (item.jobId && !jobs.has(item.jobId)) {
        item = { ...item, status: "error", filename: "Generation interrupted" };
        changed = true;
      } else if (item.jobId && (doneJobs.has(item.jobId) || doneKeys.has(runKey(item)))) {
        changed = true;
        continue;
      }
    }
    next.push(item);
  }
  if (!changed) return;
  gallery = next;
  bumpRevision();
  saveGallery();
}

export function generationSettings(body) {
  const providerModel = String(body.modelName || body.model || "");
  const grok = providerModel.startsWith("grok-imagine-");
  const settings = {
    comfyBackend: body.comfyBackend || defaultWorkerId(),
    workflow: body.workflow || "",
    profileId: body.profileId || "",
    // The backend a combined profile ran on, so Exact Repeat and Recreate run it there again.
    ...(body.profileBackend ? { profileBackend: String(body.profileBackend) } : {}),
    // The profile's name when it ran, for Details once the profile is renamed or removed.
    ...(body.profileName ? { profileName: String(body.profileName).slice(0, 200) } : {}),
    ...(body.variationCount ? { variationCount: Number(body.variationCount) } : {}),
    ...(body.duration ? { duration: Number(body.duration) } : {}),
    ...(body.resolution ? { resolution: String(body.resolution) } : {}),
    ...(!grok
      ? {
          steps: Number(body.steps || 0),
          // A distilled profile takes no CFG (backend/validation.js), so none is recorded for it.
          ...(body.cfg !== undefined && body.cfg !== null ? { cfg: Number(body.cfg || 0) } : {}),
          sampler: body.sampler || "",
          scheduler: body.scheduler || "",
        }
      : {}),
    seed: body.seed || "Random",
    ...(body.seedRandom ? { seedRandom: true } : {}),
    // An imported workflow's model is the workflow; this is the file it loaded.
    ...(body.modelName && String(body.model || "").startsWith("custom:")
      ? { modelName: String(body.modelName) }
      : {}),
    textEncoder: body.textEncoder || "",
    ...(Array.isArray(body.encoders) && body.encoders.length > 1
      ? { textEncoders: body.encoders.map(String) }
      : {}),
    vae: body.vae || "",
    clipType: body.clipType || "",
    weightDtype: body.weightDtype || "",
    referenceImageName: body.startImageName || "",
    autoResizeInputs: body.autoResizeInputs !== false,
    ...(body.requestedSize
      ? { width: body.requestedSize.width, height: body.requestedSize.height }
      : {}),
    referenceAssets: Array.isArray(body.referenceAssets)
      ? body.referenceAssets.map(({ slot, assetId, source, name }) => ({
          slot,
          assetId,
          source,
          name,
        }))
      : [],
    // A first reference that only guided: kept, so a retry runs it the same way (Edit is the default).
    ...(body.referenceRole === "reference" &&
    Array.isArray(body.referenceAssets) &&
    body.referenceAssets.length
      ? { referenceRole: "reference" }
      : {}),
    promptPolicy: body.promptPolicy || null,
  };
  const loras = Array.isArray(body.loras)
    ? body.loras
        .filter((item) => item?.enabled !== false && item?.name)
        .slice(0, 8)
        .map((item) => ({
          name: String(item.name || ""),
          enabled: true,
          strength: Number(item.strength ?? 0.7),
          ...(item.triggers === false ? { triggers: false } : {}),
        }))
    : [];
  if (loras.length) settings.loras = loras;
  if (body.kind === "image") {
    settings.count = Number(body.count || 1);
    if (hasReferenceImage(body) && !providerModel.endsWith(".rad"))
      settings.denoise = Number(body.denoise || 0);
    // Where the painted part sat in the reference; the mask itself is never kept.
    if (body.inpaint?.box) {
      settings.inpaint = {
        box: body.inpaint.box,
        strength: body.inpaint.strength,
        feather: body.inpaint.feather,
      };
      if (body.inpaint.image?.width)
        settings.inpaint.image = {
          width: body.inpaint.image.width,
          height: body.inpaint.image.height,
        };
      // The reference's id lets the live preview draw over the original.
      if (body.inpaint.referenceId) settings.inpaint.referenceId = body.inpaint.referenceId;
    }
  }
  if (body.kind === "video" && !body.duration) {
    settings.frames = Number(body.frames || 0);
    settings.fps = Number(body.fps || 0);
  }
  return settings;
}

export async function replaceGalleryJob(id, outputs, body, jobs, status = "done") {
  const title = promptTitle(body.prompt);
  const job = jobs.get(id) || {};
  const durationMs = job.startedAt ? Date.now() - job.startedAt : 0;
  // The server-owned owner travels from the pending tiles to the finished outputs.
  const ownerId = body.ownerId || job.ownerId || "";
  const ownJob = (item) => item.jobId === id && (item.ownerId || "") === ownerId;
  const existing = gallery.filter(ownJob);
  const completed = await Promise.all(
    outputs.map(async (item, index) => {
      let videoSize = null;
      if (
        item.type === "video" &&
        typeof item.url === "string" &&
        item.url.startsWith("/comfy/view?")
      ) {
        const params = new URLSearchParams(item.url.slice(item.url.indexOf("?") + 1));
        const file = localOutputFile(
          params.get("filename") || "",
          params.get("subfolder") || "",
          params.get("type") || "output",
        );
        if (file) {
          const { probeVideo } = await import("./video-previews.js");
          videoSize = await probeVideo(file);
        }
      }
      return {
        ...item,
        id: item.url,
        jobId: id,
        ...(ownerId ? { ownerId } : {}),
        status,
        prompt: body.prompt || "",
        negative: body.negative || "",
        filename: title || item.filename,
        createdAt: existing[index]?.createdAt || new Date().toISOString(),
        durationMs,
        // How long ComfyUI itself took, without waiting in its queue.
        ...(job.timing ? { timing: job.timing } : {}),
        // An inpaint result is the whole original picture, whatever size the crop sampled at.
        width: Number(videoSize?.width || body.inpaint?.image?.width || body.width || 0),
        height: Number(videoSize?.height || body.inpaint?.image?.height || body.height || 0),
        model: body.model || "",
        ...(body.startImageId
          ? {
              referenceImage: body.startImageId,
              referenceImageName: body.startImageName || "",
              startImageId: body.startImageId,
            }
          : {}),
        settings: generationSettings(body),
        ...(body.assistant ? { assistant: body.assistant } : {}),
        ...(storedWritingRecord(body.writing)
          ? { writing: storedWritingRecord(body.writing) }
          : {}),
        // A title the writing stage gave with the prompt; domain/titles.ts writes the rest.
        ...(replyTitle(body.writing?.title) ? { title: replyTitle(body.writing.title) } : {}),
        ...(body.chat ? { chat: body.chat } : {}),
        ...(body.dream ? { dream: body.dream } : {}),
        outputName: item.filename,
        promptId: job.promptId || "",
        index,
      };
    }),
  );
  let nextIndex = 0;
  const replaced = [];
  gallery.forEach((item) => {
    if (!ownJob(item)) {
      replaced.push(item);
      return;
    }
    if (completed[nextIndex]) replaced.push(completed[nextIndex++]);
  });
  while (completed[nextIndex]) replaced.unshift(completed[nextIndex++]);
  // ComfyUI numbers a new file one past the highest existing one, so deleting
  // the newest image hands its name to the next. A delete marker on that name
  // is for the old picture: without this, a run started before the delete
  // (so "created" earlier than it) vanished the moment it finished.
  if (status === "done") {
    markFreshOutputs(completed);
    let cleared = false;
    for (const item of completed)
      cleared = hiddenGalleryIds.delete(markerOf(galleryKey(item))) || cleared;
    if (cleared) saveHiddenGalleryIds();
  }
  setGallery(dedupeGallery(replaced).slice(0, galleryLimit));
  return completed;
}

// Progress and previews arrive several times a second per job, so these patch
// only the job's own items and log just those, instead of diffing the gallery.
export function updateGalleryJob(id, patch, options = {}) {
  let changed = false;
  const upserts = [];
  // Compare the patched fields only: a preview is a large base64 string and
  // the item around it may hold another one, so stringifying both is costly at
  // the rate progress and previews arrive (worse with two runs at once).
  const fields = Object.keys(patch).map((key) => [key, JSON.stringify(patch[key])]);
  gallery = gallery.map((item) => {
    if (item.jobId === id || item.id === id || item.url === id) {
      changed = true;
      if (fields.every(([key, encoded]) => JSON.stringify(item[key]) === encoded)) return item;
      const next = { ...item, ...patch };
      upserts.push(next);
      return next;
    }
    return item;
  });
  if (changed) {
    if (upserts.length) bumpRevision();
    if (options.persist !== false) saveGallery();
  }
  return changed;
}

export function updateGalleryJobPreviews(id, previews = []) {
  if (!Array.isArray(previews) || !previews.length) return false;
  const upserts = [];
  let fallbackIndex = 0;
  gallery = gallery.map((item) => {
    if (item.jobId !== id) return item;
    const index = Number.isInteger(item.index) ? item.index : fallbackIndex;
    fallbackIndex += 1;
    const preview = previews[index];
    if (!preview || item.preview === preview) return item;
    const next = { ...item, preview };
    upserts.push(next);
    return next;
  });
  if (upserts.length) bumpRevision();
  return upserts.length > 0;
}
