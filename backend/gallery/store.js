import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { replyTitle } from "../../shared/titles.ts";
import { recordBelongsToAccount } from "../account-ownership.js";
import { localOutputFile } from "../comfy/comfy.js";
import { currentDataDir } from "../data-dir.js";
import { createResultNumbers } from "../domain/result-numbers.ts";
import { generationRecord } from "../generation-record.js";
import { mediaFile, mediaParams, mediaPath, mediaUrls } from "../media-paths.js";
import { dreamState, galleryKey } from "../persistence/gallery-rows.ts";
import {
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { loadSharp } from "../sharp-loader.js";
import { galleryFiltersTest } from "./filters.js";
import { compareGalleryItems, compareGalleryKeys, setOrder } from "./order.js";
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

/*
 * The gallery is one `studio_gallery` row per item (persistence/gallery-rows.ts), read and written
 * in place: queries filter and order on the indexed columns derived from each row, and this module
 * adds what SQL can't see (files on disk, delete markers, result-set grouping, searches).
 */
let statements = { db: null, prepared: new Map() };
function statement(sql) {
  const db = runtimeDatabase(dataDir);
  if (statements.db !== db) statements = { db, prepared: new Map() };
  let prepared = statements.prepared.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    statements.prepared.set(sql, prepared);
  }
  return prepared;
}

function transaction(write) {
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    write();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Bumped on every change clients should see, live progress included.
let galleryRevision = Date.now();
// Bumped when saved items or delete markers change, so a kept search count knows to recount.
let dataVersion = 0;

export function galleryRevisionValue() {
  return galleryRevision;
}

/** Counts saved changes (items and delete markers), not live progress: for results kept until it moves. */
export const galleryChangeCount = () => dataVersion;

function bumpRevision() {
  galleryRevision = Math.max(galleryRevision + 1, Date.now());
  return galleryRevision;
}

// Bumped by changes that can move items into, out of or across a list. Idle work's enrichment
// (titles, captions, suggestions, reviews, face checks) leaves it be: a kept list picks those up
// when it next expires.
let listVersion = 0;
const enrichment = new Set([
  "caption",
  "identity",
  "nextSteps",
  "review",
  "suggestedPrompt",
  "title",
]);

function changed({ enriched = false } = {}) {
  dataVersion += 1;
  if (!enriched) listVersion += 1;
  bumpRevision();
}

/*
 * Patches shown but not saved, by gallery key: progress and previews arrive several times a second
 * per job. The next save of the item writes them, as it is read with them; a preview never is.
 */
const live = new Map();

function withLive(item) {
  const extra = live.get(galleryKey(item));
  return extra ? { ...item, ...extra } : item;
}

const parse = (row) => withLive(JSON.parse(row.value));

/* ----------------------------------------------------------------- Queries */

const order = "bucket, created_ms DESC, job_id DESC, item_index, item_id DESC";
const list = (values) => JSON.stringify([...values].map(String));

/**
 * The SQL for a gallery query: each field narrows the rows. `ownerId` is exact ("" is the
 * single-user owner); `status`, `notStatus` and `dreamState` take one or several; `liked` keeps the
 * owner's starred items and kept Dream results; `conversationIds` match the chats that asked for
 * items; `ids` match items' ids and `notIds` leave them out, `named` their id, URL or gallery key
 * and `idPrefix` the start of their id; `since` keeps items made from then on (ms) and every
 * pending one, `before` those made by then; `prompt` matches the prompt exactly and `titled` keeps
 * items with a title.
 */
function where(query = {}) {
  const terms = [];
  const params = [];
  const add = (sql, ...values) => {
    terms.push(sql);
    params.push(...values);
  };
  if (query.ownerId !== undefined) add("owner_id = ?", String(query.ownerId));
  if (query.uploaded !== undefined) add("uploaded = ?", query.uploaded ? 1 : 0);
  if (query.dreamPool !== undefined) add("dream_pool = ?", query.dreamPool ? 1 : 0);
  if (query.type) add("type = ?", query.type);
  if (query.jobId !== undefined) add("job_id = ?", String(query.jobId));
  if (query.jobIds) add("job_id IN (SELECT value FROM json_each(?))", list(query.jobIds));
  if (query.setId) add("set_id = ?", query.setId);
  if (query.favorite) add("favorite = 1");
  if (query.status !== undefined)
    add("status IN (SELECT value FROM json_each(?))", list([query.status].flat()));
  if (query.notStatus !== undefined)
    add("status NOT IN (SELECT value FROM json_each(?))", list([query.notStatus].flat()));
  if (query.dreamState !== undefined) {
    const states = [query.dreamState].flat();
    add(`${dreamState} IN (${states.map(() => "?").join(", ")})`, ...states);
  }
  // Starred rows read only the owner's order index, kept ones the Dream index.
  if (query.liked)
    add(
      `rowid IN (SELECT rowid FROM studio_gallery INDEXED BY studio_gallery_owner_order WHERE owner_id = ? AND favorite = 1 UNION ALL SELECT rowid FROM studio_gallery WHERE ${dreamState} = 'kept' AND owner_id = ?)`,
      String(query.ownerId),
      String(query.ownerId),
    );
  if (query.conversationIds)
    add(
      "json_extract(value, '$.chat.conversationId') IN (SELECT value FROM json_each(?))",
      list(query.conversationIds),
    );
  // Words found in the row's own JSON (lowercased by SQLite, ASCII only): a cheap first pass a
  // search's filter confirms. Pending rows always pass, as searches never hide work in progress.
  if (query.contains?.length)
    add(
      `(status = 'pending' OR (${query.contains.map(() => "instr(lower(value), ?) > 0").join(" AND ")}))`,
      ...query.contains,
    );
  if (query.prompt !== undefined) add("json_extract(value, '$.prompt') = ?", query.prompt);
  if (query.titled) add("json_extract(value, '$.title') IS NOT NULL");
  if (query.since) add("(status = 'pending' OR created_ms >= ?)", Number(query.since));
  // Naming both buckets lets the order index seek the time range rather than compute each row's.
  if (query.before !== undefined) add("bucket IN (0, 1) AND created_ms <= ?", Number(query.before));
  if (query.idPrefix)
    add("item_id >= ? AND item_id < ?", query.idPrefix, `${query.idPrefix}\uffff`);
  if (query.ids) add("item_id IN (SELECT value FROM json_each(?))", list(query.ids));
  if (query.notIds?.length)
    add("item_id NOT IN (SELECT value FROM json_each(?))", list(query.notIds));
  if (query.named)
    add(
      "(item_id IN (SELECT value FROM json_each(?)) OR key IN (SELECT value FROM json_each(?)))",
      list(query.named),
      list(query.named),
    );
  return { sql: terms.length ? `WHERE ${terms.join(" AND ")}` : "", params };
}

/**
 * Every item the query matches, in gallery order unless `ordered` is false (sorting a whole
 * gallery costs more than reading it). A query for unfinished states reads the status index: its
 * statistics say each status is common, as most items are done. A query for Dream states reads
 * the Dream index. `sample` picks that many matches at random before any record is parsed.
 */
export function galleryItems(query = {}, { ordered = true } = {}) {
  if (query.sample !== undefined) {
    const { sample, ...rest } = query;
    const { sql, params } = where(rest);
    return statement(
      `SELECT value FROM studio_gallery WHERE rowid IN (SELECT rowid FROM studio_gallery ${sql} ORDER BY random() LIMIT ?)`,
    )
      .all(...params, sample)
      .map(parse);
  }
  const { sql, params } = where(query);
  const unfinished = query.status !== undefined && ![query.status].flat().includes("done");
  const index =
    query.dreamState !== undefined
      ? "INDEXED BY studio_gallery_dream"
      : unfinished
        ? "INDEXED BY studio_gallery_status"
        : "";
  return statement(
    `SELECT value FROM studio_gallery ${index} ${sql} ${ordered ? `ORDER BY ${order}` : ""}`,
  )
    .all(...params)
    .map(parse);
}

const keyColumns = "key, value, bucket, created_ms, job_id, item_index, item_id";
const rowKey = (row) => ({
  bucket: row.bucket,
  time: row.created_ms,
  jobId: row.job_id,
  index: row.item_index,
  id: row.item_id,
});

/**
 * The query's rows in gallery order after the order key `after`, read a batch at a time, so a walk
 * of the whole gallery never holds all of it.
 */
function* galleryRows(query = {}, after = null) {
  const base = where(query);
  const select = (conditions, params, limit) =>
    statement(
      `SELECT ${keyColumns} FROM studio_gallery WHERE ${[base.sql.replace(/^WHERE /, ""), ...conditions].filter(Boolean).join(" AND ") || "1"} ORDER BY ${order} LIMIT ?`,
    ).all(...base.params, ...params, limit);
  let from = after;
  for (;;) {
    const rows = [];
    for (const branch of from ? afterKey(from) : [{ sql: [], params: [] }]) {
      rows.push(...select(branch.sql, branch.params, 200 - rows.length));
      if (rows.length === 200) break;
    }
    yield* rows;
    if (rows.length < 200) return;
    from = rowKey(rows.at(-1));
  }
}

/**
 * The query's items, read a batch at a time: in gallery order within the gallery, then Dream's
 * pool, then uploads. The order index leads with those, so each batch seeks; across them every
 * batch would sort the whole table.
 */
export function* eachGalleryItem(query = {}) {
  for (const uploaded of query.uploaded === undefined ? [false, true] : [query.uploaded])
    for (const dreamPool of query.dreamPool === undefined ? [false, true] : [query.dreamPool])
      for (const row of galleryRows({ ...query, uploaded, dreamPool })) yield parse(row);
}

export function countGalleryItems(query = {}) {
  const { sql, params } = where(query);
  return statement(`SELECT count(*) AS count FROM studio_gallery ${sql}`).get(...params).count;
}

export function hasGalleryItems(query = {}) {
  const { sql, params } = where(query);
  return Boolean(statement(`SELECT 1 FROM studio_gallery ${sql} LIMIT 1`).get(...params));
}

/** The first item in gallery order the query matches. */
export function findGalleryItem(query) {
  const { sql, params } = where(query);
  const row = statement(`SELECT value FROM studio_gallery ${sql} ORDER BY ${order} LIMIT 1`).get(
    ...params,
  );
  return row ? parse(row) : undefined;
}

/** The item with an id, hidden or not; with `ownerId`, only that owner's. */
export const galleryItem = (id, ownerId) =>
  findGalleryItem({ ids: [String(id ?? "")], ...(ownerId !== undefined && { ownerId }) });

/** A job's items in output order, hidden ones included; with `ownerId`, only that owner's. */
export const galleryJobItems = (jobId, ownerId) =>
  galleryItems({ jobId, ...(ownerId !== undefined && { ownerId }) }).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );

/* ------------------------------------------------------------------ Writes */

/**
 * Saves items whole, by gallery key, replacing any saved under the same key. `enriched` says the
 * change only added idle work's enrichment, which kept lists needn't rebuild for.
 */
export function putGalleryItems(items, { enriched = false } = {}) {
  if (!items.length) return;
  const upsert = statement(
    "INSERT INTO studio_gallery (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  transaction(() => {
    for (const item of items) {
      const key = galleryKey(item);
      if (!key) continue;
      const { preview, ...saved } = item;
      upsert.run(key, JSON.stringify(saved));
      if (preview && item.status === "pending") live.set(key, { preview });
      else live.delete(key);
    }
  });
  changed({ enriched });
}

/** Deletes items' records only: no files and no delete markers (removeGalleryItems does those). */
export function forgetGalleryItems(items) {
  const keys = items.map(galleryKey).filter(Boolean);
  if (!keys.length) return;
  statement("DELETE FROM studio_gallery WHERE key IN (SELECT value FROM json_each(?))").run(
    list(keys),
  );
  for (const key of keys) live.delete(key);
  changed();
}

/** Each account's result numbers (domain/result-numbers.ts), shown on its gallery items. */
export const resultNumbers = createResultNumbers({
  db: runtimeDatabase(dataDir),
  existing: (ownerId) => galleryItems({ ownerId }),
});

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

function persistHiddenMarkers(value) {
  writeRuntimeDocument(dataDir, "gallery-hidden", value);
}

function saveHiddenGalleryIds() {
  changed();
  fs.mkdirSync(dataDir, { recursive: true });
  persistHiddenMarkers(Object.fromEntries(hiddenGalleryIds));
}

/** Clears delete markers on these items' names: a name ComfyUI reused is a new picture. */
function clearHiddenMarkers(items) {
  let cleared = false;
  for (const item of items)
    cleared = hiddenGalleryIds.delete(markerOf(galleryKey(item))) || cleared;
  if (cleared) saveHiddenGalleryIds();
}

export function hideGalleryItems(items) {
  if (!items.length) return;
  const hiddenAt = Date.now();
  for (const item of items) {
    const key = galleryKey(item);
    if (key) hiddenGalleryIds.set(markerOf(key), hiddenAt);
  }
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

function isComfyOutputItem(item) {
  return Boolean(item?.url && String(item.url).startsWith("/comfy/view?"));
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

/** The visible items (filterVisibleGallery) the query matches, in gallery order. */
export const visibleGallery = (query = {}, options = {}) =>
  filterVisibleGallery(galleryItems({ ...query, dreamPool: false }, options));

/* ---------------------------------------------------------------- Search */

/** What a gallery search looks through: the title (domain/titles.ts), its MCP result set's title, its own title there and its character, the prompts (an upload's suggested one too), an import's source title, the caption (domain/captions.ts), the model and LoRAs, and the file's name. */
function gallerySearchText(item) {
  if (!item || typeof item !== "object") return "";
  const settings = item.settings || {};
  const loras = Array.isArray(settings.loras) ? settings.loras.map((lora) => lora?.name || "") : [];
  return [
    item.title,
    item.resultSet?.title,
    item.resultSet?.variation,
    item.resultSet?.character?.name,
    item.prompt,
    item.suggestedPrompt,
    item.source?.title,
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
}

/**
 * A gallery filter for a search: every word must appear somewhere, or the
 * image looks like the search (`near`, from domain/image-search.ts), and
 * `favorites` keeps starred images only. Runs still generating always pass,
 * so a search never hides the progress of what is being made right now.
 * Null when there is nothing to filter by.
 */
const searchTerms = (q) =>
  String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);

/**
 * A search's words the gallery's JSON holds as typed, for a first pass in SQL (`contains`): none
 * unless every word is plain ASCII that JSON writes unescaped.
 */
export function searchWords(q) {
  const terms = searchTerms(q);
  return terms.every((term) => /^[\x20-\x7e]+$/.test(term) && !/["\\]/.test(term)) ? terms : [];
}

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
  const terms = searchTerms(q);
  const filtered = galleryFiltersTest({ lora, model, workflow, size, aspect, tag });
  if (!terms.length && !favorites && !filtered) return null;
  return (item) => {
    if (item.status === "pending") return true;
    if (favorites && !item.favorite) return false;
    if (filtered && !filtered(item)) return false;
    if (!terms.length) return true;
    const text = gallerySearchText(item);
    return terms.every((term) => text.includes(term)) || Boolean(near?.(item));
  };
}

/** Stars (or unstars) finished gallery items by id, URL or key. Returns the items that changed. */
export function setGalleryFavorites(keys, favorite) {
  const wanted = keys.map(String).filter(Boolean);
  if (!wanted.length) return [];
  const upserts = galleryItems({ named: wanted })
    .filter((item) => item.status === "done" && Boolean(item.favorite) !== Boolean(favorite))
    .map(({ favorite: _favorite, ...rest }) => (favorite ? { ...rest, favorite: true } : rest));
  putGalleryItems(upserts);
  return upserts;
}

/* ---------------------------------------------------------------- Paging */

/** A cursor: the order key of the row a page ended at; mid-set, the set and its last item shown. */
const cursorFor = (key, set) =>
  `v2|${encodeURIComponent(JSON.stringify(set ? { ...key, ...set } : key))}`;

function readCursor(cursor) {
  if (!String(cursor).startsWith("v2|")) return null;
  try {
    const {
      set = "",
      after = "",
      ...key
    } = JSON.parse(decodeURIComponent(String(cursor).slice(3)));
    return { key, set: String(set), after: String(after) };
  } catch {
    return null;
  }
}

/**
 * The rows after `key` in gallery order, as conditions to read in turn: the rest of the key's own
 * bucket and time, the rest of its bucket, then later buckets. Each is a range the order index
 * seeks to, so a deep page costs no more than the first.
 */
function afterKey(key) {
  const bucket = Number(key.bucket) || 0;
  const time = key.time ?? null;
  const descending = (column, value) =>
    value === null
      ? { after: "0", same: `${column} IS NULL`, values: [] }
      : { after: `(${column} < ? OR ${column} IS NULL)`, same: `${column} = ?`, values: [value] };
  // Within the key's time: after its job, index and id, built from the last column out.
  let tie = "0";
  let tieParams = [];
  for (const column of [
    descending("item_id", key.id ?? null),
    { after: "item_index > ?", same: "item_index = ?", values: [Number(key.index) || 0] },
    descending("job_id", key.jobId ?? null),
  ]) {
    tie = `(${column.after} OR (${column.same} AND ${tie}))`;
    tieParams = [...column.values, ...column.values, ...tieParams];
  }
  return [
    {
      sql: ["bucket = ?", time === null ? "created_ms IS NULL" : "created_ms = ?", tie],
      params: [bucket, ...(time === null ? [] : [time]), ...tieParams],
    },
    ...(time === null
      ? []
      : [
          { sql: ["bucket = ?", "created_ms < ?"], params: [bucket, time] },
          { sql: ["bucket = ?", "created_ms IS NULL"], params: [bucket] },
        ]),
    { sql: ["bucket > ?"], params: [bucket] },
  ];
}

const visibleItem = (item) => !inDreamPool(item) && hasGalleryMedia(item);

/** A result set's visible items the query matches, in gallery order. */
function setItems(query, id) {
  // By the set's index: without statistics SQLite prefers the order index, walking the whole
  // gallery for every set.
  const { sql, params } = where({ ...query, setId: id });
  return statement(`SELECT value FROM studio_gallery INDEXED BY studio_gallery_set ${sql}`)
    .all(...params)
    .map(parse)
    .filter(visibleItem)
    .sort(compareGalleryItems);
}

/**
 * The visible items of a query after `start` (an order key), in gallery order with each MCP result
 * set's results together where its newest result sorts: each step is `{ key, set, items }`, the
 * order key of the row it stands at, its set and what shows there. Sets group before `filter`, so a
 * search keeps a set where the whole set would stand; `skipSet` names one already shown.
 */
function* galleryUnits(query, filter, start = null, skipSet = "") {
  const sets = new Map();
  for (const row of galleryRows(query, start)) {
    const item = parse(row);
    if (!visibleItem(item)) continue;
    const set = item.resultSet?.id;
    if (set) {
      if (set === skipSet) continue;
      if (!sets.has(set)) {
        const members = setItems(query, set);
        sets.set(set, {
          anchor: members[0] && galleryKey(members[0]),
          items: (filter ? members.filter(filter) : members).sort(setOrder),
        });
      }
      const found = sets.get(set);
      if (found.anchor === row.key && found.items.length)
        yield { key: rowKey(row), set, items: found.items };
    } else if (!filter || filter(item)) yield { key: rowKey(row), set: "", items: [item] };
  }
}

// Filtered and ranked lists (searches, comparisons, Find Similar) as their items' keys, so paging
// through one walks the gallery once. Each is kept until an item moves into, out of or across it,
// or a minute passes (picking up enrichment, such as a new caption a search would find).
const lists = new Map();
const keptLists = 5;
const listLifeMs = 60_000;

/** The list `filter` (and `rank`) make of the query: `{ entries: [{ key, unit }], positions }`. */
function keptList(query, filter, filterKey, rank) {
  const name = filterKey && JSON.stringify([query, filterKey, Boolean(rank)]);
  const kept = name && lists.get(name);
  if (kept && kept.version === listVersion && Date.now() - kept.at <= listLifeMs) return kept;
  let entries = [];
  for (const unit of galleryUnits(query, filter))
    for (const item of unit.items)
      entries.push({ key: galleryKey(item), unit: unit.key, ...(rank && { score: rank(item) }) });
  if (rank)
    entries = entries
      .filter((entry) => entry.score !== undefined)
      .sort((a, b) => b.score - a.score);
  const list = {
    version: listVersion,
    at: Date.now(),
    entries,
    positions: new Map(entries.map((entry, index) => [entry.key, index])),
  };
  if (name) {
    lists.delete(name);
    if (lists.size >= keptLists) lists.delete(lists.keys().next().value);
    lists.set(name, list);
  }
  return list;
}

/** A page cut from a kept list; its cursor names its last item and where it stood. */
function listPage(list, cursor, limit, ranked) {
  let start = 0;
  if (ranked) start = Number(/^r\|(\d+)$/.exec(cursor)?.[1] || 0);
  else if (cursor) {
    const [, key = "", unit = "null"] = String(cursor).split("|").map(decodeURIComponent);
    const at = list.positions.get(key);
    if (at !== undefined) start = at + 1;
    else {
      // Its item has left the list: carry on after where it stood.
      const after = (() => {
        try {
          return JSON.parse(unit);
        } catch {
          return null;
        }
      })();
      const found = after
        ? list.entries.findIndex((entry) => compareGalleryKeys(entry.unit, after) > 0)
        : -1;
      start = found < 0 ? list.entries.length : found;
    }
  }
  const slice = list.entries.slice(start, start + limit);
  const byKey = new Map(
    galleryItems({ named: slice.map((entry) => entry.key) }).map((item) => [
      galleryKey(item),
      item,
    ]),
  );
  const items = slice.flatMap((entry) => (byKey.has(entry.key) ? [byKey.get(entry.key)] : []));
  const end = start + slice.length;
  const last = slice.at(-1);
  const nextCursor =
    end >= list.entries.length
      ? ""
      : ranked
        ? `r|${end}`
        : `k|${encodeURIComponent(last.key)}|${encodeURIComponent(JSON.stringify(last.unit))}`;
  return { items, nextCursor };
}

/**
 * A page of the gallery; uploaded images (references.js) are listed only, and alone, with `uploads`.
 * `query` narrows it in SQL (galleryItems' fields) and `filter` tests each item in JS, with
 * `filterKey` naming everything `filter` depends on so its list is kept between pages. `rank`
 * (Find Similar) orders by its score instead, highest first, leaving out items it can't score.
 */
export function pageGallery({
  type = "",
  limit = 200,
  cursor = "",
  includeFailed = true,
  uploads = false,
  query = {},
  filter = null,
  filterKey = "",
  rank = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 200)));
  const sql = {
    ...query,
    uploaded: uploads,
    dreamPool: false,
    ...(type && { type }),
    notStatus: [query.notStatus ?? [], "cancelled", ...(includeFailed ? [] : ["failed"])].flat(),
  };
  if (filter || rank) {
    const list = keptList(sql, filter, filterKey, rank);
    const page = listPage(list, cursor, safeLimit, Boolean(rank));
    return {
      ...page,
      hasMore: Boolean(page.nextCursor),
      revision: galleryRevision,
      totalApprox: list.entries.length,
    };
  }
  const from = cursor ? readCursor(cursor) : null;
  const items = [];
  let nextCursor = "";
  let previous = null;
  // The rest of a set the last page stopped inside, even if a newer result has moved the set.
  const rest = from?.set
    ? (() => {
        const members = setItems(sql, from.set).sort(setOrder);
        const at = members.findIndex((item) => galleryKey(item) === from.after);
        return at < 0 ? [] : members.slice(at + 1);
      })()
    : [];
  const units = (function* () {
    if (rest.length) yield { key: from.key, set: from.set, items: rest };
    yield* galleryUnits(sql, null, from?.key, from?.set);
  })();
  for (const unit of units) {
    if (items.length === safeLimit) {
      nextCursor = cursorFor(previous);
      break;
    }
    const taken = unit.items.slice(0, safeLimit - items.length);
    items.push(...taken);
    if (taken.length < unit.items.length) {
      nextCursor = cursorFor(unit.key, { set: unit.set, after: galleryKey(taken.at(-1)) });
      break;
    }
    previous = unit.key;
  }
  return {
    items,
    nextCursor,
    hasMore: Boolean(nextCursor),
    revision: galleryRevision,
    totalApprox: countGalleryItems(sql),
  };
}

/* ------------------------------------------------------------------ Files */

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

// Every gallery page checks its outputs still exist, so a stat per item would
// mean hundreds of blocking calls per request. Each folder's listing is read
// once instead, and read again when the folder's modified time changes (a file
// was added or deleted, e.g. in Finder or Explorer).
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
  if (!item || typeof item !== "object") return true;
  const media = mediaParams(item.url);
  // Anything but a media URL is ComfyUI's to serve; Studio cannot see it.
  if (!media) return true;
  const file = mediaPath(media.filename, media.subfolder);
  if (!file) return false;
  if (folderListing(path.dirname(file))?.has(listedName(path.basename(file)))) return true;
  const freshAt = freshOutputs.get(galleryKey(item));
  return Boolean(freshAt && Date.now() - freshAt < freshOutputMs && fs.existsSync(file));
}

/* ------------------------------------------------------- Adding and removing */

/** Deletes these gallery items at once: their files, delete markers and records. */
export function removeGalleryItems(items) {
  const files = deleteGalleryFiles(items);
  if (!items.length) return files;
  hideGalleryItems(items);
  forgetGalleryItems(items);
  return files;
}

/** Viewer deletion for several of one owner's items. */
export function deleteOwnedGalleryItems(ownerId, ids) {
  const account = ownerId ? { userId: ownerId } : undefined;
  const removed = galleryItems({ ids }).filter((item) => recordBelongsToAccount(item, account));
  const files = removeGalleryItems(removed);
  return { removed: removed.map((item) => item.id), files };
}

/** Items added or put back; one with the URL or id of a saved item replaces it. */
export function addGalleryItems(items) {
  // A name ComfyUI reused may carry a delete marker from an older image; this one is wanted.
  clearHiddenMarkers(items);
  // Just written, so a folder listing that has not caught up yet must not hide them.
  markFreshOutputs(items);
  putGalleryItems(dedupeGallery(items));
}

export function recordsFromComfyHistory(worker, history) {
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
    for (const output of outputsFrom(worker, { outputs: own })) {
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

function dedupeGallery(items) {
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
  // Called on every gallery page: most of the time there is nothing pending and no upscale running.
  const open = statement(
    `SELECT value FROM studio_gallery INDEXED BY studio_gallery_status WHERE status = 'pending'
     UNION ALL SELECT value FROM studio_gallery INDEXED BY studio_gallery_upscale
     WHERE upscale_status = 'running' AND status IS NOT 'pending'`,
  )
    .all()
    .map(parse);
  if (!open.length) return;
  const finished = (jobId) => hasGalleryItems({ jobId, status: "done" });
  const updated = [];
  const removed = [];
  for (const before of open) {
    let item = before;
    // An upscale whose job is no longer unfinished (or was never recorded) is not running anymore.
    if (
      item.upscale?.status === "running" &&
      !queue.unfinished(item.ownerId || "", item.upscale.jobId)
    )
      item = { ...item, upscale: { ...item.upscale, status: "cancelled", progress: null } };
    if (item.status === "pending") {
      // A job still unfinished after a restart waits for recovery; a tile without one never arrives.
      if (item.jobId && !queue.unfinished(item.ownerId || "", item.jobId))
        item = { ...item, status: "failed", filename: "Generation interrupted" };
      else if (item.jobId && finished(item.jobId)) {
        removed.push(item);
        continue;
      }
    }
    if (item !== before) updated.push(item);
  }
  forgetGalleryItems(removed);
  putGalleryItems(updated);
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
  Object.assign(new Error(`Studio couldn't add this extension to its video: ${reason}`), {
    extendFailed: true,
  });

export async function replaceGalleryJob(id, outputs, body, jobs, status = "done") {
  const title = promptTitle(body.prompt);
  const job = jobs.get(id) || {};
  const durationMs = job.startedAt ? Date.now() - job.startedAt : 0;
  // The server-owned owner travels from the pending tiles to the finished outputs.
  const ownerId = body.ownerId || job.ownerId || "";
  const existing = galleryJobItems(id, ownerId);
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
  // ComfyUI numbers a new file one past the highest existing one, so deleting
  // the newest image hands its name to the next. A delete marker on that name
  // is for the old picture: without this, a run started before the delete
  // (so "created" earlier than it) vanished the moment it finished.
  if (status === "done") {
    markFreshOutputs(completed);
    clearHiddenMarkers(completed);
  }
  const kept = new Set(completed.map(galleryKey));
  forgetGalleryItems(existing.filter((item) => !kept.has(galleryKey(item))));
  putGalleryItems(dedupeGallery(completed));
  return completed;
}

/** The items `id` names: a job's, or the one item with that id or URL. */
const jobOrItem = (id) =>
  statement(
    `SELECT value FROM studio_gallery WHERE job_id = ? OR item_id = ? OR key = ? ORDER BY ${order}`,
  )
    .all(id, id, id)
    .map(parse);

/**
 * Patches a job's items (or the one item with that id or URL). With `persist: false` the patch is
 * only shown until the item's next save: for progress, which arrives several times a second.
 */
export function updateGalleryJob(id, patch, options = {}) {
  const items = jobOrItem(id);
  if (!items.length) return false;
  // Compare the patched fields only: a preview is a large base64 string.
  const fields = Object.keys(patch).map((key) => [key, JSON.stringify(patch[key])]);
  const updated = items
    .filter((item) => !fields.every(([key, encoded]) => JSON.stringify(item[key]) === encoded))
    .map((item) => ({ ...item, ...patch }));
  if (!updated.length) return true;
  if (options.persist !== false)
    putGalleryItems(updated, { enriched: Object.keys(patch).every((key) => enrichment.has(key)) });
  else {
    for (const item of updated) {
      const key = galleryKey(item);
      live.set(key, { ...live.get(key), ...patch });
    }
    bumpRevision();
  }
  return true;
}

/** Shows a running job's previews on its tiles, by output index; never saved. */
export function updateGalleryJobPreviews(id, previews = []) {
  if (!Array.isArray(previews) || !previews.length) return false;
  let shown = false;
  galleryJobItems(id).forEach((item, position) => {
    const preview = previews[Number.isInteger(item.index) ? item.index : position];
    if (!preview || item.preview === preview) return;
    const key = galleryKey(item);
    live.set(key, { ...live.get(key), preview });
    shown = true;
  });
  if (shown) bumpRevision();
  return shown;
}
