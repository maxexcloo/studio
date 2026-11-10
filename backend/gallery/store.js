import {
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { galleryKey, readGalleryRows, writeGalleryRows } from "../persistence/gallery-rows.ts";
import { generationRecord } from "../generation-record.js";
import { hasGalleryFilters, matchesGalleryFilters } from "./filters.js";
import { mediaFile, mediaParams, mediaPath, mediaUrls } from "../media-paths.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadSharp } from "../sharp-loader.js";
import { localOutputFile } from "../comfy/comfy.js";
import { compareGalleryItems, compareGalleryKeys, galleryOrderKey, galleryTime } from "./order.js";
import { currentDataDir } from "../data-dir.js";
import { recordBelongsToAccount } from "../account-ownership.js";
import { replyTitle } from "../../shared/titles.ts";
import {
  generationSettings,
  outputsFrom,
  promptTitle,
  storedAssistantRecord,
  storedChatRecord,
  storedResultSet,
  storedWritingRecord,
} from "./records.js";

export const dataDir = currentDataDir();
export const galleryLimit = Number(process.env.STUDIO_GALLERY_LIMIT || 50000);

let galleryRevision = Date.now();
// Bumped whenever the hide markers change, so a cached page list knows to rebuild.
let hiddenVersion = 0;

/**
 * The gallery is one SQLite row per item. Each saved item by key as last written: items are
 * replaced, never changed in place, so a save writes only the keys whose item is a different object.
 */
let savedRows = new Map();

function loadGallery() {
  const items = readGalleryRows(runtimeDatabase(dataDir));
  savedRows = new Map(items.map((item) => [galleryKey(item), item]));
  return sortGallery(items).map((item) =>
    // Backfill thumbnailUrl for items saved before the thumbnail pipeline existed.
    item.type === "image" &&
    !item.thumbnailUrl &&
    typeof item.url === "string" &&
    item.url.startsWith("/comfy/view?")
      ? { ...item, thumbnailUrl: item.url.replace("/comfy/view?", "/comfy/thumb?") }
      : item,
  );
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
function markerOf(key) {
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
  let raw;
  try {
    raw = readRuntimeDocument(dataDir, "gallery-hidden");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
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
      persistHiddenMarkers(Object.fromEntries(markers));
    } catch {
      // Stays as it was until the next save.
    }
  }
  return markers;
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

function isComfyOutputItem(item) {
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

/** Whether an item's media is there: not hidden and its file present, in the gallery or Dream's pool. */
export function hasGalleryMedia(item) {
  if (isGalleryHidden(item)) return false;
  return isComfyOutputItem(item) ? hasExistingOutputFile(item) : true;
}

export function filterVisibleGallery(items) {
  return items.filter((item) => !inDreamPool(item) && hasGalleryMedia(item));
}

/**
 * The visible list a page is cut from, kept between requests. Scrolling a
 * large gallery asks for page after page; filtering and sorting all of it for
 * each one made every page cost as much as the whole. The list is rebuilt when
 * anything it depends on changes: the gallery (its revision), hide markers,
 * or a folder listing (a file added or deleted outside).
 */
let visibleCache = { key: "", lists: new Map() };

let visibleListBuilds = 0;
/** How often a page list was built from the whole gallery; the paging test counts it. */
export const visibleListBuildCount = () => visibleListBuilds;

/** The cached lists, emptied first when the gallery, hide markers or a folder listing changed. */
function visibleLists() {
  refreshFolderListings();
  const key = `${galleryRevision}|${hiddenVersion}|${listingGeneration}`;
  if (visibleCache.key !== key) visibleCache = { key, lists: new Map() };
  return visibleCache.lists;
}

function visibleItems({ type = "", includeFailed = true, uploads = false, filter = null } = {}) {
  const lists = visibleLists();
  const listKey = `${type}|${includeFailed}|${uploads}`;
  let entry = lists.get(listKey);
  if (!entry) {
    // The gallery is kept sorted, so this sort only confirms the order (linear on sorted input).
    const items = sortGallery(filterVisibleGallery(gallery)).filter((item) => {
      if (type && item.type !== type) return false;
      if (Boolean(item.uploaded) !== uploads) return false;
      if (!includeFailed && item.status === "failed") return false;
      return item.status !== "cancelled";
    });
    entry = { items, positions: null };
    visibleListBuilds += 1;
    lists.set(listKey, entry);
  }
  // A search filters the cached list; its positions are its own, so it is not kept.
  return filter ? { items: entry.items.filter(filter), positions: null } : entry;
}

// Items by job (in output order) and by id, rebuilt when the gallery is replaced: it changes only
// by replacement, never in place.
let lookup = { gallery: null, byJob: new Map(), byId: new Map() };
function galleryLookup() {
  if (lookup.gallery === gallery) return lookup;
  const byJob = new Map();
  const byId = new Map();
  for (const item of gallery) {
    if (item.id && !byId.has(item.id)) byId.set(item.id, item);
    if (!item.jobId) continue;
    if (byJob.has(item.jobId)) byJob.get(item.jobId).push(item);
    else byJob.set(item.jobId, [item]);
  }
  for (const items of byJob.values()) items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  lookup = { gallery, byJob, byId };
  return lookup;
}

/** A job's items in output order, hidden ones included. */
export const galleryJobItems = (jobId) => galleryLookup().byJob.get(jobId) || [];

/** The item with an id, hidden or not. */
export const galleryItem = (id) => galleryLookup().byId.get(id);

/** Every visible item (filterVisibleGallery), kept with the page lists until the gallery changes. */
export function visibleGallery() {
  const lists = visibleLists();
  if (!lists.has("visible"))
    lists.set("visible", { items: filterVisibleGallery(gallery), positions: null });
  return lists.get("visible").items;
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

/** What a gallery search looks through: the title (domain/titles.ts), the prompts (an upload's suggested one too), the caption (domain/captions.ts), the model and LoRAs, and the file's name. */
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
      item.suggestedPrompt,
      item.negative,
      item.caption?.text,
      ...(Array.isArray(item.caption?.tags) ? item.caption.tags : []),
      item.model,
      settings.modelName,
      settings.profileId,
      settings.workflow,
      item.outputName,
      item.filename,
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
  tag = "",
} = {}) {
  const terms = String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  if (
    !terms.length &&
    !favorites &&
    !hasGalleryFilters({ lora, model, workflow, size, aspect, tag })
  )
    return null;
  return (item) => {
    if (item.status === "pending") return true;
    if (favorites && !item.favorite) return false;
    if (!matchesGalleryFilters(item, { lora, model, workflow, size, aspect, tag })) return false;
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

/**
 * A page of the gallery; uploaded images (references.js) are listed only, and alone, with `uploads`.
 * `rank` (Find Similar) orders by its score instead, highest first, leaving out items it can't score;
 * its cursor is then the position.
 */
export function pageGallery({
  type = "",
  limit = 200,
  cursor = "",
  includeFailed = true,
  uploads = false,
  filter = null,
  rank = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 200)));
  const entry = visibleItems({ type, includeFailed, uploads, filter });
  if (rank) {
    const all = entry.items
      .map((item) => ({ item, score: rank(item) }))
      .filter(({ score }) => score !== undefined)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
    const start = Number(/^r\|(\d+)$/.exec(cursor)?.[1] || 0);
    const end = start + safeLimit;
    return {
      items: all.slice(start, end),
      nextCursor: end < all.length ? `r|${end}` : "",
      hasMore: end < all.length,
      revision: galleryRevision,
      totalApprox: all.length,
    };
  }
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

/** Where an item's file is on this computer: Studio media has exactly one place. */
export function outputFileCandidates(item) {
  const media = mediaParams(item?.url);
  const file = media ? mediaPath(media.filename, media.subfolder) : null;
  return file ? [file] : [];
}

let galleryFilesDeleted = () => {};
/** Hears every gallery item whose files are deleted, so its derived data (search vectors) goes too. */
export function onGalleryFilesDeleted(listener) {
  galleryFilesDeleted = listener;
}

export function deleteGalleryFiles(items) {
  galleryFilesDeleted(items);
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
      } catch (error) {
        console.warn(`[Studio] Could not delete a gallery file: ${error.message}`);
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
      } catch (error) {
        console.warn(`[Studio] Could not delete a gallery file: ${error.message}`);
        skipped += 1;
      }
    }
  }
  return { deleted, skipped };
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
  // Anything else is ComfyUI's to serve; Studio cannot see it.
  return true;
}

/**
 * Saving. Changes are gathered for a moment, and a save that is due when the
 * server stops is written before it exits. A save writes only the rows that changed.
 */
const saveDelayMs = Math.max(0, Number(process.env.STUDIO_GALLERY_SAVE_MS ?? 1000));
let saveTimer = null;
let dirty = false;
let writing = null;
// Counts changes, so a strict flush waits for its own changes rather than for
// the gallery to go quiet: changes made while a save is under way are not failures.
let changeCount = 0;
let savedChangeCount = 0;
let saveFailure = null;

/** Upserts the items that changed since the last save and deletes the ones gone. */
function writeChangedRows() {
  const current = new Map();
  for (const item of gallery) {
    const key = galleryKey(item);
    if (key && !current.has(key)) current.set(key, item);
    if (current.size >= galleryLimit) break;
  }
  const changed = [];
  for (const [key, item] of current)
    if (savedRows.get(key) !== item) changed.push(item.preview ? withoutPreview(item) : item);
  const removed = [...savedRows.keys()].filter((key) => !current.has(key));
  if (changed.length || removed.length)
    writeGalleryRows(runtimeDatabase(dataDir), changed, removed);
  savedRows = current;
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
  const changes = changeCount;
  writing = Promise.resolve()
    .then(() => {
      writeChangedRows();
      savedChangeCount = Math.max(savedChangeCount, changes);
      saveFailure = null;
    })
    .catch((error) => {
      // Try again shortly; the transaction left the saved rows whole.
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
  writeRuntimeDocument(dataDir, "gallery-hidden", value);
}

/** Writes the gallery at once, blocking: for when the process is about to exit. */
function writeGalleryNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const changes = changeCount;
  try {
    writeChangedRows();
  } catch (error) {
    saveFailure = error;
    throw error;
  }
  dirty = false;
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

/** Deletes these gallery items at once: their files, delete markers and records, in one save. */
export function removeGalleryItems(items) {
  const files = deleteGalleryFiles(items);
  if (!items.length) return files;
  hideGalleryItems(items);
  const gone = new Set(items);
  setGallery(gallery.filter((item) => !gone.has(item)));
  return files;
}

/** Viewer deletion for several of one owner's items. */
export function deleteOwnedGalleryItems(ownerId, ids) {
  const wanted = new Set(ids);
  const account = ownerId ? { userId: ownerId } : undefined;
  const removed = gallery.filter(
    (item) => wanted.has(item.id) && recordBelongsToAccount(item, account),
  );
  const files = removeGalleryItems(removed);
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
        ...(storedResultSet(saved.resultSet)
          ? { resultSet: storedResultSet(saved.resultSet) }
          : {}),
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

/** `queue` is the queue's records (domain/store.ts): a tile's job runs while its record is unfinished. */
export function cleanupGalleryState(queue) {
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
    // An upscale whose job is no longer unfinished (or was never recorded) is not running anymore.
    if (
      item.upscale?.status === "running" &&
      !queue.unfinished(item.ownerId || "", item.upscale.jobId)
    ) {
      item = { ...item, upscale: { ...item.upscale, status: "cancelled", progress: null } };
      changed = true;
    }
    if (item.status === "pending") {
      // A job still unfinished after a restart waits for recovery; a tile without one never arrives.
      if (item.jobId && !queue.unfinished(item.ownerId || "", item.jobId)) {
        item = { ...item, status: "failed", filename: "Generation interrupted" };
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

/** A saved output's own size, read from its file (sharp for an image, ffmpeg otherwise); null when unreadable. */
export async function outputFileSize(file, type) {
  if (type === "image") {
    const sharp = await loadSharp();
    return sharp
      ? sharp(file)
          .metadata()
          .catch(() => null)
      : null;
  }
  const { probeVideo } = await import("../video-previews.js");
  return probeVideo(file);
}

/** An Extend that could not be joined onto its video: the run fails rather than saving it apart. */
const extendFailure = (reason) =>
  Object.assign(new Error(`Studio couldn’t add this extension to its video: ${reason}`), {
    extendFailed: true,
  });

export async function replaceGalleryJob(id, outputs, body, jobs, status = "done") {
  const title = promptTitle(body.prompt);
  const job = jobs.get(id) || {};
  const durationMs = job.startedAt ? Date.now() - job.startedAt : 0;
  // The server-owned owner travels from the pending tiles to the finished outputs.
  const ownerId = body.ownerId || job.ownerId || "";
  const ownJob = (item) => item.jobId === id && (item.ownerId || "") === ownerId;
  const existing = gallery.filter(ownJob);
  const completed = await Promise.all(
    outputs.map(async (output, index) => {
      let item = output;
      // The saved file's own size: a graph can draw at its reference's size rather than the one asked for.
      let size = null;
      if (typeof item.url === "string" && item.url.startsWith("/comfy/view?")) {
        const params = new URLSearchParams(item.url.slice(item.url.indexOf("?") + 1));
        const subfolder = params.get("subfolder") || "";
        let file = localOutputFile(
          params.get("filename") || "",
          subfolder,
          params.get("type") || "output",
        );
        if (file && item.type === "image") size = await outputFileSize(file, item.type);
        else if (file) {
          const { joinClips } = await import("../video-previews.js");
          // An Extend (a run started from a video's frame) is saved joined onto that video, so each
          // one makes it longer; it never saves as a clip of its own. Only the first reference is
          // what the run was made from (shared/versions.ts). The extension's own file stays, so a
          // retried save or a provider's recorded output still finds it.
          const { frameSourceFile } = await import("../references.js");
          const from =
            status === "done" && frameSourceFile(body.referenceAssets?.[0]?.assetId, ownerId);
          if (from && from.at !== 0) {
            if (!from.file)
              throw extendFailure("the video it continues is no longer in the gallery");
            const name = `${path.parse(file).name}-joined.mp4`;
            const joined = mediaPath(name, subfolder);
            try {
              if (!fs.existsSync(joined)) await joinClips(from.file, file, joined, from.at);
            } catch (error) {
              await fs.promises.rm(joined, { force: true });
              throw extendFailure(error.message);
            }
            item = { ...item, ...mediaUrls(name, subfolder), filename: name };
            file = joined;
          }
          size = await outputFileSize(file, item.type);
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
        // The prompt a provider's moderation refused before the assistant rewrote it as `prompt`.
        ...(body.refusedPrompt ? { refusedPrompt: body.refusedPrompt } : {}),
        filename: title || item.filename,
        createdAt: existing[index]?.createdAt || new Date().toISOString(),
        durationMs,
        // How long ComfyUI itself took, without waiting in its queue.
        ...(job.timing ? { timing: job.timing } : {}),
        // An inpaint result is the whole original picture, whatever size the crop sampled at.
        width: Number(size?.width || body.inpaint?.image?.width || body.width || 0),
        height: Number(size?.height || body.inpaint?.image?.height || body.height || 0),
        model: body.model || "",
        settings: generationSettings(body),
        ...(body.assistant ? { assistant: body.assistant } : {}),
        ...(storedWritingRecord(body.writing)
          ? { writing: storedWritingRecord(body.writing) }
          : {}),
        // A title the writing stage gave with the prompt; domain/titles.ts writes the rest.
        ...(replyTitle(body.writing?.title) ? { title: replyTitle(body.writing.title) } : {}),
        ...(body.chat ? { chat: body.chat } : {}),
        ...(storedResultSet(body.resultSet) ? { resultSet: storedResultSet(body.resultSet) } : {}),
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

/**
 * Takes each result's source fields from its saved row into the loaded items, after a migration
 * step wrote them while Studio runs (version-sources.js `gallerySources`), so the next save keeps
 * them. A run's settlement records them together, so a row without a source may not have saved the
 * item's yet and leaves it as it is.
 */
export const reloadGallerySources = () =>
  reloadGalleryFields(["parentItemId", "parentJobId", "derived"], (row) => row.parentItemId);

/** Takes each result's size from its saved row, after gallery-sizes.js `gallerySizes` wrote it. */
export const reloadGallerySizes = () =>
  reloadGalleryFields(["width", "height"], (row) => Number(row.width) > 0);

/** Takes `fields` from each saved row that is `settled` into the loaded item, then saves. */
function reloadGalleryFields(fields, settled) {
  const saved = new Map(
    readGalleryRows(runtimeDatabase(dataDir)).map((row) => [galleryKey(row), row]),
  );
  let changed = false;
  gallery = gallery.map((item) => {
    const row = saved.get(galleryKey(item));
    if (!row || !settled(row) || fields.every((key) => row[key] === item[key])) return item;
    changed = true;
    const next = { ...item };
    for (const key of fields) {
      if (key in row) next[key] = row[key];
      else delete next[key];
    }
    return next;
  });
  if (!changed) return;
  bumpRevision();
  saveGallery();
}
