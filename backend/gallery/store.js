import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";

import sharp from "sharp";

import { replyTitle } from "../../shared/titles.ts";
import { recordBelongsToAccount } from "../account-ownership.js";
import { localOutputFile } from "../comfy/comfy.js";
import { logWarning } from "../crash-log.js";
import { dataDir } from "../data-dir.js";
import { createResultNumbers } from "../domain/result-numbers.ts";
import { generationRecord } from "../generation-record.js";
import { mediaFile, mediaParams, mediaPath, mediaUrls } from "../media-paths.js";
import {
  chatConversation,
  chatTurn,
  dreamArm,
  dreamPair,
  dreamProject,
  dreamState,
  galleryKey,
  listedChatSet,
  galleryOrder as order,
  summaryFields,
} from "../persistence/gallery-rows.ts";
import {
  readRuntimeDocument,
  runtimeDatabase,
  runtimeTransaction,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { galleryFiltersTest } from "./filters.js";
import { compareGalleryKeys } from "./order.js";
import {
  generationSettings,
  outputsFrom,
  promptTitle,
  storedAssistantRecord,
  storedChatRecord,
  storedResultSet,
  storedWritingRecord,
} from "./records.js";

/*
 * The gallery is one `studio_gallery` row per item (persistence/gallery-rows.ts), read and written
 * in place: queries filter and order on the indexed columns derived from each row, and this module
 * adds what SQL can't see (files on disk, delete markers, searches).
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
// when it next expires. An account's lists wait only for its own changes and those of no known
// owner (delete markers).
let listVersion = 0;
let everyoneChanged = 0;
const ownerChanged = new Map();
const listVersionFor = (query) =>
  typeof query.ownerId === "string"
    ? Math.max(everyoneChanged, ownerChanged.get(query.ownerId) ?? 0)
    : listVersion;
const enrichment = new Set([
  "caption",
  "identity",
  "motionIdeas",
  "nextSteps",
  "review",
  "suggestedPrompt",
  "title",
]);

function changed({ enriched = false, items } = {}) {
  dataVersion += 1;
  if (!enriched) {
    listVersion += 1;
    if (items) for (const item of items) ownerChanged.set(item.ownerId ?? "", listVersion);
    else everyoneChanged = listVersion;
  }
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

const list = (values) => JSON.stringify([...values].map(String));
const libraryReviewCutoff = () => Date.now() - 30 * 24 * 60 * 60 * 1000;
const unreviewedMedia = "coalesce(json_extract(value, '$.libraryReviewedAt'), 0) <= ?";

/**
 * The SQL for a gallery query: each field narrows the rows. `ownerId` is exact ("" is the
 * single-user owner); `unlisted` keeps (or leaves out) what the gallery doesn't list: disliked items
 * and Dream's pool; `rating` is "liked" or "disliked"; `status`, `notStatus` and `dreamState` take
 * one or several; `dreamArm` keeps Dream results whose arm starts with one of its prefixes,
 * `notDreamArm` leaves out one arm, `notDream` every Dream result, and `dreamPair` keeps (or leaves out) comparison sides; `liked` keeps
 * the owner's liked items and kept Dream results; `conversationIds` match the chats that asked for
 * items and `turnId` one turn of a chat; `ids` match items' ids, `named` their id, URL or gallery key
 * and `idPrefix` the start of their id; `since` keeps items made from then on (ms) and every
 * pending one, `before` those made by then; `limit` (galleryItems) reads only that many; `prompt` matches the prompt exactly and `titled` keeps
 * items with a title. `characterId` keeps results Face Check compared with that character and
 * `drifted` those it found off-character (domain/face-check.ts).
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
  if (query.unlisted !== undefined) add("unlisted = ?", query.unlisted ? 1 : 0);
  if (query.includeDisliked && query.unlisted !== false) {
    const disliked = `rating = 'disliked' AND (json_type(value, '$.dream') IS NOT 'object' OR ${dreamState} = 'kept')`;
    add(query.unlisted ? disliked : `(unlisted = 0 OR (${disliked}))`);
  }
  if (query.type) add("type = ?", query.type);
  if (query.jobId !== undefined) add("job_id = ?", String(query.jobId));
  if (query.jobIds) add("job_id IN (SELECT value FROM json_each(?))", list(query.jobIds));
  if (query.ownGeneration) {
    const profiles = query.promptedProfiles;
    add(
      `EXISTS (SELECT 1 FROM studio_queue AS job WHERE job.id = studio_gallery.job_id AND job.owner_id = studio_gallery.owner_id${profiles ? " AND job.prompted AND job.profile_id IN (SELECT value FROM json_each(?))" : ""})`,
      ...(profiles ? [list(profiles)] : []),
    );
  }
  if (query.setId) add("set_id = ?", query.setId);
  if (query.rating) add("rating = ?", query.rating);
  if (query.unrated) add("rating IS NULL");
  if (query.unreviewed) add(unreviewedMedia, libraryReviewCutoff());
  if (query.status !== undefined)
    add("status IN (SELECT value FROM json_each(?))", list([query.status].flat()));
  if (query.notStatus !== undefined)
    add("status NOT IN (SELECT value FROM json_each(?))", list([query.notStatus].flat()));
  if (query.dreamState !== undefined) {
    const states = [query.dreamState].flat();
    add(`${dreamState} IN (${states.map(() => "?").join(", ")})`, ...states);
  }
  if (query.dreamDraft !== undefined)
    add("json_extract(value, '$.dream.draft') = ?", query.dreamDraft);
  if (query.dreamPassReason)
    add("json_extract(value, '$.dream.passReason') = ?", query.dreamPassReason);
  if (query.dreamDecidedSince)
    add("json_extract(value, '$.dream.decidedAt') >= ?", query.dreamDecidedSince);
  if (query.dreamProject !== undefined) add(`${dreamProject} = ?`, query.dreamProject);
  if (query.dreamArm !== undefined) {
    const prefixes = [query.dreamArm].flat();
    add(
      `(${prefixes.map(() => `substr(${dreamArm}, 1, length(?)) = ?`).join(" OR ")})`,
      ...prefixes.flatMap((prefix) => [prefix, prefix]),
    );
  }
  if (query.notDreamArm !== undefined) add(`${dreamArm} IS NOT ?`, query.notDreamArm);
  if (query.notDream) add("json_type(value, '$.dream') IS NOT 'object'");
  if (query.dreamPair !== undefined) add(`${dreamPair} IS ${query.dreamPair ? "NOT " : ""}NULL`);
  // Liked and kept rows are each read through their own index.
  if (query.liked)
    add(
      `rowid IN (SELECT rowid FROM studio_gallery INDEXED BY studio_gallery_owner_rating WHERE owner_id = ? AND rating = 'liked' UNION ALL SELECT rowid FROM studio_gallery WHERE ${dreamState} = 'kept' AND owner_id = ?)`,
      String(query.ownerId),
      String(query.ownerId),
    );
  if (query.conversationIds)
    add(`${chatConversation} IN (SELECT value FROM json_each(?))`, list(query.conversationIds));
  if (query.turnId) add(`${chatTurn} = ?`, String(query.turnId));
  // Words found in the row's own JSON (lowercased by SQLite, ASCII only): a cheap first pass a
  // search's filter confirms. Pending rows always pass, as searches never hide work in progress,
  // as do those keyed in `orKeys` (images that look like the search).
  if (query.contains?.length)
    add(
      `(status = 'pending' OR (${query.contains.map(() => "instr(lower(value), ?) > 0").join(" AND ")})${query.orKeys ? " OR key IN (SELECT value FROM json_each(?))" : ""})`,
      ...query.contains,
      ...(query.orKeys ? [list(query.orKeys)] : []),
    );
  if (query.prompt !== undefined) add("json_extract(value, '$.prompt') = ?", query.prompt);
  if (query.titled) add("json_extract(value, '$.title') IS NOT NULL");
  if (query.characterId)
    add("json_extract(value, '$.identity.characterId') = ?", String(query.characterId));
  if (query.drifted) add("json_extract(value, '$.identity.drifted') = 1");
  if (query.since) {
    const pending =
      (query.status === undefined || [query.status].flat().includes("pending")) &&
      ![query.notStatus].flat().includes("pending");
    // Two seeks, as an OR across columns would walk the whole gallery for a few recent items.
    add(
      pending
        ? "rowid IN (SELECT rowid FROM studio_gallery INDEXED BY studio_gallery_status WHERE status = 'pending' UNION SELECT rowid FROM studio_gallery INDEXED BY studio_gallery_created WHERE created_ms >= ?)"
        : "created_ms >= ?",
      Number(query.since),
    );
  }
  if (query.before !== undefined) add("created_ms <= ?", Number(query.before));
  if (query.idPrefix)
    add("item_id >= ? AND item_id < ?", query.idPrefix, `${query.idPrefix}\uffff`);
  if (query.ids) add("item_id IN (SELECT value FROM json_each(?))", list(query.ids));
  if (query.named)
    add(
      "(item_id IN (SELECT value FROM json_each(?)) OR key IN (SELECT value FROM json_each(?)))",
      list(query.named),
      list(query.named),
    );
  return { sql: terms.length ? `WHERE ${terms.join(" AND ")}` : "", params };
}

/**
 * The index a query reads: for unfinished states the status index, as its statistics say each
 * status is common (most items are done), and for Dream states the Dream index.
 */
function indexFor(query) {
  if (query.dreamProject !== undefined) return "INDEXED BY studio_gallery_dream_project";
  if (query.dreamState !== undefined) return "INDEXED BY studio_gallery_dream";
  if (query.ownGeneration && query.rating && !query.ids)
    return "INDEXED BY studio_gallery_owner_rating";
  const unfinished = query.status !== undefined && ![query.status].flat().includes("done");
  return unfinished ? "INDEXED BY studio_gallery_status" : "";
}

/**
 * Every item the query matches, in gallery order unless `ordered` is false (sorting a whole
 * gallery costs more than reading it), read through `indexFor`'s index. `sample` picks that many
 * matches at random before any record is parsed.
 */
export function galleryItems(query = {}, { ordered = true } = {}) {
  if (query.sample !== undefined) {
    const { sample, ...rest } = query;
    const { sql, params } = where(rest);
    return statement(
      `SELECT value FROM studio_gallery WHERE rowid IN (SELECT rowid FROM studio_gallery ${indexFor(query)} ${sql} ORDER BY random() LIMIT ?)`,
    )
      .all(...params, sample)
      .map(parse);
  }
  const { sql, params } = where(query);
  const limit = query.limit === undefined ? [] : [query.limit];
  return statement(
    `SELECT value FROM studio_gallery ${indexFor(query)} ${sql} ${ordered ? `ORDER BY ${order}` : ""} ${limit.length ? "LIMIT ?" : ""}`,
  )
    .all(...params, ...limit)
    .map(parse);
}

/** A chat's finished visible results grouped by recorded set ID. Text comes from each latest row. */
export function galleryChatSets(ownerId, type, { conversationId, turnId }) {
  return statement(
    `SELECT set_id AS id, count(*) AS count, max(gallery_ms) AS at,
       json_extract(value, '$.resultSet.title') AS title,
       json_extract(value, '$.resultSet.context.series') AS series,
       coalesce(nullif(json_extract(value, '$.resultSet.context.notes'), ''),
         json_extract(value, '$.resultSet.caption')) AS notes
     FROM studio_gallery INDEXED BY studio_gallery_chat
     WHERE owner_id = ? AND type = ? AND ${chatConversation} = ?
       ${turnId ? `AND ${chatTurn} = ?` : ""}
       AND ${listedChatSet}
     GROUP BY set_id ORDER BY at DESC, id`,
  ).all(ownerId, type, conversationId, ...(turnId ? [turnId] : []));
}

/** Read Dream's badge inputs without loading whole gallery records or sorting them. */
export function unseenDreamReadiness(ownerId) {
  const query = { ownerId, dreamState: "unseen" };
  const { sql, params } = where(query);
  return statement(
    `SELECT key, item_id AS id, type, status, json_extract(value, '$.dream') AS dream,
         json_extract(value, '$.resultSet') AS resultSet
       FROM studio_gallery ${indexFor(query)} ${sql}`,
  )
    .all(...params)
    .map(({ key, id, type, status, dream, resultSet }) => ({
      id,
      type,
      status: live.get(key)?.status ?? status,
      dream: JSON.parse(dream),
      resultSet: resultSet ? JSON.parse(resultSet) : undefined,
    }));
}

const positionColumns = "key, gallery_ms, job_id, item_index, item_id";
const keyColumns = `${positionColumns}, value`;
const rowKey = (row) => ({
  time: row.gallery_ms,
  jobId: row.job_id,
  index: row.item_index,
  id: row.item_id,
});

/**
 * The query's rows in gallery order after the order key `after`, read a batch at a time, so a walk
 * of the whole gallery never holds all of it.
 */
function* galleryRows(query = {}, after = null, columns = keyColumns) {
  // Seek each partition through its index, then interleave the results by position.
  if (query.includeDisliked && query.unlisted === undefined) {
    const listed = galleryRows({ ...query, unlisted: false }, after, columns);
    const disliked = galleryRows({ ...query, unlisted: true }, after, columns);
    yield* interleaved([listed, disliked]);
    return;
  }
  const base = where(query);
  const select = (conditions, params, limit) =>
    statement(
      `SELECT ${columns} FROM studio_gallery WHERE ${[base.sql.replace(/^WHERE /, ""), ...conditions].filter(Boolean).join(" AND ") || "1"} ORDER BY ${order} LIMIT ?`,
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

/** Walks in gallery order merged into one, each read as it goes. */
function* interleaved(walks) {
  const heads = walks.map((walk) => ({ walk, next: walk.next() }));
  for (;;) {
    let first;
    for (const head of heads)
      if (
        !head.next.done &&
        (!first || compareGalleryKeys(rowKey(head.next.value), rowKey(first.next.value)) < 0)
      )
        first = head;
    if (!first) return;
    yield first.next.value;
    first.next = first.walk.next();
  }
}

/**
 * The query's items in gallery order, read a batch at a time; with `unlistedFirst`, all that the
 * gallery doesn't list comes first. The order index leads with uploads and listing, so each of
 * those partitions seeks on its own and the walk merges them. With `after` (a gallery key), only
 * those after its record, or all of them once it is gone.
 */
export function* eachGalleryItem(query = {}, after) {
  const from =
    after &&
    statement(`SELECT ${positionColumns}, unlisted FROM studio_gallery WHERE key = ?`).get(after);
  const walk = (unlisted, start) =>
    interleaved(
      (query.uploaded === undefined ? [false, true] : [query.uploaded]).map((uploaded) =>
        galleryRows({ ...query, uploaded, unlisted }, start),
      ),
    );
  const partitions = query.unlisted === undefined ? [false, true] : [query.unlisted];
  if (!query.unlistedFirst) {
    const start = from ? rowKey(from) : null;
    for (const row of interleaved(partitions.map((unlisted) => walk(unlisted, start))))
      yield parse(row);
    return;
  }
  for (const unlisted of partitions.toReversed()) {
    const resumes = from && Boolean(from.unlisted) === unlisted;
    // A walk resuming among listed records has passed every unlisted one.
    if (from && !resumes && unlisted) continue;
    for (const row of walk(unlisted, resumes ? rowKey(from) : null)) yield parse(row);
  }
}

/**
 * The `summaryFields` of each item the query matches that the gallery lists (filterVisibleGallery),
 * read from the summary index alone. A row's key stands in for its URL: it is the URL where the
 * item has one.
 */
export function gallerySummaryRows(query = {}) {
  const { sql, params } = where({ ...query, unlisted: false });
  const columns = Object.entries(summaryFields).map(([name, value]) => `${value} AS ${name}`);
  return statement(
    `SELECT key, ${columns.join(", ")} FROM studio_gallery INDEXED BY studio_gallery_summary ${sql}`,
  )
    .all(...params)
    .filter((row) => hasGalleryMedia({ url: row.key, createdAt: row.createdAt }))
    .map((row) => ({
      ...row,
      loras: JSON.parse(row.loras ?? "null"),
      tags: JSON.parse(row.tags ?? "null"),
    }));
}

export function countGalleryItems(query = {}) {
  const { sql, params } = where(query);
  return statement(`SELECT count(*) AS count FROM studio_gallery ${indexFor(query)} ${sql}`).get(
    ...params,
  ).count;
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
  runtimeTransaction(dataDir, () => {
    for (const item of items) {
      const key = galleryKey(item);
      if (!key) continue;
      const { preview, ...saved } = item;
      upsert.run(key, JSON.stringify(saved));
      if (preview && item.status === "pending") live.set(key, { preview });
      else live.delete(key);
    }
  });
  changed({ enriched, items });
}

/** Deletes items' records only: no files and no delete markers (removeGalleryItems does those). */
export function forgetGalleryItems(items) {
  const keys = items.map(galleryKey).filter(Boolean);
  if (!keys.length) return;
  statement("DELETE FROM studio_gallery WHERE key IN (SELECT value FROM json_each(?))").run(
    list(keys),
  );
  for (const key of keys) live.delete(key);
  changed({ items });
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
 * checked against a name but never read back into one.
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
  return new Map(Object.entries(readRuntimeDocument(dataDir, "gallery-hidden") ?? {}));
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

/**
 * An item the gallery doesn't list: one the person disliked, or a Dream result they have not kept,
 * which lives in Dream's own pool (domain/dream.ts).
 */
const isUnlisted = (item) =>
  item?.rating === "disliked" || Boolean(item?.dream && item.dream.state !== "kept");

/** Whether an item's media is there: not deleted and its file present, listed or not. */
export function hasGalleryMedia(item) {
  if (isGalleryHidden(item)) return false;
  return isComfyOutputItem(item) ? hasExistingOutputFile(item) : true;
}

/** The items the gallery lists, with `disliked` those in its Disliked view too. */
export function filterVisibleGallery(items, { disliked = false } = {}) {
  return items.filter(
    (item) =>
      (!isUnlisted(item) || (disliked && item.rating === "disliked")) && hasGalleryMedia(item),
  );
}

/** An owned Dream result available as the exact source of a new run or suggestion. */
export function unseenDreamItem(ownerId, itemId, jobId) {
  const item = findGalleryItem({
    ownerId,
    jobId,
    ids: [itemId],
    dreamState: "unseen",
    status: "done",
  });
  return item?.url && hasGalleryMedia(item) ? item : undefined;
}

/** Reads Dream's visible seed candidates in bounded batches and checks their media asynchronously. */
export async function visibleGenerationItems(query) {
  const visible = async (item) => {
    if (isUnlisted(item) || isGalleryHidden(item)) return false;
    const media = isComfyOutputItem(item) && mediaParams(item.url);
    if (!media) return true;
    const file = mediaPath(media.filename, media.subfolder);
    return Boolean(
      file &&
      (await fs.promises.stat(file).then(
        (info) => info.isFile(),
        () => false,
      )),
    );
  };
  const result = [];
  const add = async (items) => {
    const keep = await Promise.all(items.map(visible));
    for (const [i, item] of items.entries()) if (keep[i]) result.push(item);
  };
  if (query.sample !== undefined || query.limit !== undefined || query.ids) {
    await add(galleryItems(query));
  } else {
    const batch = [];
    for (const row of galleryRows(query)) {
      batch.push(parse(row));
      if (batch.length !== 200) continue;
      await add(batch);
      batch.length = 0;
      await yieldTurn();
    }
    await add(batch);
  }
  return result;
}

/** The visible items (filterVisibleGallery, so `disliked` too) the query matches, in gallery order. */
export const visibleGallery = (query = {}, options = {}) =>
  filterVisibleGallery(
    galleryItems(
      options.disliked ? { ...query, includeDisliked: true } : { ...query, unlisted: false },
      options,
    ),
    options,
  );

/**
 * The finished and failed runs made from `since` (ms) that the gallery lists,
 * with only the fields profile health counts, a page of `size` at a time: each page reads only
 * the runs index, and the caller may give other work a turn between pages.
 */
export function* galleryRuns(since, size = 200) {
  for (let after = [since, ""]; ;) {
    const rows = statement(
      `SELECT key, status, rating, created_ms,
         json_extract(value, '$.settings.profileId') AS profileId,
         json_extract(value, '$.timing.runMs') AS runMs
       FROM studio_gallery INDEXED BY studio_gallery_runs
       WHERE (created_ms, key) > (?, ?) AND unlisted = 0 AND status IN ('done', 'failed')
       ORDER BY created_ms, key LIMIT ?`,
    ).all(...after, size);
    yield rows
      .map((row) => ({ ...row, createdAt: new Date(row.created_ms).toISOString() }))
      .filter((row) => !isGalleryHidden({ url: row.key, createdAt: row.createdAt }))
      .map((row) => ({
        status: row.status,
        rating: row.rating,
        createdAt: row.createdAt,
        settings: { profileId: row.profileId },
        timing: { runMs: row.runMs },
      }));
    if (rows.length < size) return;
    after = [rows.at(-1).created_ms, rows.at(-1).key];
  }
}

/* ---------------------------------------------------------------- Search */

/** What a gallery search looks through: the title (domain/titles.ts), its MCP result set's title, its own title there, its character and the names its chat gave it, the prompts (an upload's suggested one too), an import's source title, the caption (domain/captions.ts), the model and LoRAs, and the file's name. */
function gallerySearchText(item) {
  if (!item || typeof item !== "object") return "";
  const settings = item.settings || {};
  const loras = Array.isArray(settings.loras) ? settings.loras.map((lora) => lora?.name || "") : [];
  return [
    item.title,
    item.resultSet?.title,
    item.resultSet?.variation,
    item.resultSet?.caption,
    item.resultSet?.character?.name,
    item.resultSet?.context?.character?.name,
    item.resultSet?.context?.outfit?.name,
    item.resultSet?.context?.scene?.name,
    item.resultSet?.context?.series,
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
 * Runs still generating pass the search and unfinished settings, but must match origin,
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
  lora = "",
  model = "",
  workflow = "",
  size = "",
  aspect = "",
  tag = "",
  origin = "",
} = {}) {
  const terms = searchTerms(q);
  const filtered = galleryFiltersTest({ lora, model, workflow, size, aspect, tag, origin });
  if (!terms.length && !filtered) return null;
  return (item) => {
    if (filtered && !filtered(item)) return false;
    if (item.status === "pending") return true;
    if (!terms.length) return true;
    const text = gallerySearchText(item);
    return terms.every((term) => text.includes(term)) || Boolean(near?.(item));
  };
}

/**
 * Rates finished gallery items by id, URL or key: "liked", "disliked" or null to clear. Returns the
 * items that changed, each with the rating it had as `was`.
 */
export function setGalleryRatings(keys, rating, ownerId) {
  const wanted = keys.map(String).filter(Boolean);
  if (!wanted.length) return [];
  const changed = galleryItems({ named: wanted, ownerId }).filter(
    (item) => item.status === "done" && (item.rating || null) !== rating,
  );
  putGalleryItems(
    changed.map(({ rating: _rating, ...rest }) => (rating ? { ...rest, rating } : rest)),
  );
  return changed.map((item) => ({
    ...item,
    rating: rating || undefined,
    was: item.rating || null,
  }));
}

const reviewable = `status = 'done' AND unlisted = 0 AND uploaded = 0
  AND type IN ('image', 'video') AND rating IS NULL AND json_extract(value, '$.url') <> ''`;

/** A seeded order across the whole library. The cursor survives ratings removing earlier rows. */
export function pageLibraryReview(ownerId, seed, cursor, limit, media) {
  const entries = statement(
    `SELECT key, json_extract(value, '$.createdAt') AS createdAt
      FROM studio_gallery WHERE owner_id = ? AND ${reviewable}
      ${media ? "AND type = ?" : ""}
      AND ${unreviewedMedia}`,
  )
    .all(ownerId, ...(media ? [media] : []), libraryReviewCutoff())
    .filter(({ key, createdAt }) => hasGalleryMedia({ url: key, createdAt }))
    .map(({ key }) => ({
      key,
      rank: crypto.createHash("sha256").update(seed).update("\0").update(key).digest("hex"),
    }))
    .filter(({ rank }) => rank > cursor);
  const page = entries
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .slice(0, limit);
  const records = galleryItems({ ownerId, named: page.map(({ key }) => key) });
  const byKey = new Map(records.map((item) => [galleryKey(item), item]));
  return {
    items: page.map(({ key }) => byKey.get(key)),
    nextCursor: entries.length > limit ? page.at(-1).rank : "",
    remaining: entries.length,
  };
}

/** Accept records a review without changing the rating. Undo returns the item to Review. */
export function setLibraryReviewed(ownerId, id, reviewed) {
  const result = findGalleryItem({ ownerId, ids: [id], status: "done", includeDisliked: true });
  if (!result || !["image", "video"].includes(result.type) || !hasGalleryMedia(result))
    return false;
  const { libraryReviewedAt, ...item } = result;
  if (reviewed === libraryReviewedAt > libraryReviewCutoff()) return true;
  putGalleryItems([reviewed ? { ...item, libraryReviewedAt: Date.now() } : item]);
  return true;
}

/* ---------------------------------------------------------------- Paging */

const cursorFor = (key) => `v3|${encodeURIComponent(JSON.stringify(key))}`;

function readCursor(cursor) {
  if (!String(cursor).startsWith("v3|")) return null;
  try {
    return JSON.parse(decodeURIComponent(String(cursor).slice(3)));
  } catch {
    return null;
  }
}

/**
 * The rows after `key` in gallery order: the rest of the key's time, older rows, then undated ones.
 * Each is a range the order index seeks to.
 */
function afterKey(key) {
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
      sql: [time === null ? "gallery_ms IS NULL" : "gallery_ms = ?", tie],
      params: [...(time === null ? [] : [time]), ...tieParams],
    },
    ...(time === null
      ? []
      : [
          { sql: ["gallery_ms < ?"], params: [time] },
          { sql: ["gallery_ms IS NULL"], params: [] },
        ]),
  ];
}

function* visibleRows(query, filter, start) {
  for (const row of galleryRows(query, start)) {
    const item = parse(row);
    if (hasGalleryMedia(item) && (!filter || filter(item))) yield { row, item };
  }
}

/** A plain sort only needs each candidate's position, rating and visibility. */
function* sortableRows(query) {
  const columns = `${positionColumns}, rating, status, json_extract(value, '$.createdAt') AS createdAt`;
  for (const row of galleryRows(query, null, columns)) {
    const item = { url: row.key, createdAt: row.createdAt, rating: row.rating, status: row.status };
    if (hasGalleryMedia(item)) yield { row, item };
  }
}

// Filtered and ranked lists (searches, comparisons, Find Similar) as their items' keys, so paging
// through one walks the gallery once. Each is kept until an item moves into, out of or across it,
// or a minute passes (picking up enrichment, such as a new caption a search would find).
const lists = new Map();
const keptLists = 5;
const listLifeMs = 60_000;

/** The list `filter` (and `rank`) make of the query, with an order key for each item. */
function keptList(query, filter, filterKey, rank, sort) {
  const name = filterKey && JSON.stringify([query, filterKey, Boolean(rank), sort]);
  const kept = name && lists.get(name);
  const version = listVersionFor(query);
  if (kept && kept.version === version && Date.now() - kept.at <= listLifeMs) return kept;
  let entries = [];
  const candidates = filter || rank ? visibleRows(query, filter) : sortableRows(query);
  for (const { row, item } of candidates) {
    const position = rowKey(row);
    if (sort === "liked" || sort === "disliked") position[sort] = item.rating === sort;
    entries.push({
      key: row.key,
      position,
      failed: item.status === "failed",
      ...(rank && { score: rank(item) }),
    });
  }
  if (rank)
    entries = entries
      .filter((entry) => entry.score !== undefined)
      .sort((a, b) => b.score - a.score);
  else if (sort !== "newest")
    entries.sort((a, b) => compareGalleryKeys(a.position, b.position, sort));
  const list = {
    version,
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

function listedItems(entries) {
  if (!entries.length) return [];
  const byKey = new Map(
    statement("SELECT key, value FROM studio_gallery WHERE key IN (SELECT value FROM json_each(?))")
      .all(list(entries.map((entry) => entry.key)))
      .map((row) => [row.key, parse(row)]),
  );
  return entries.flatMap((entry) => (byKey.has(entry.key) ? [byKey.get(entry.key)] : []));
}

const listCursorFor = ({ key, position }) =>
  `k|${encodeURIComponent(key)}|${encodeURIComponent(JSON.stringify(position))}`;

/** A page cut from a kept list, on either side of its cursor. */
function listPage(list, cursor, limit, ranked, sort, backwards, window) {
  let start = 0;
  if (ranked) start = Number(/^r\|(\d+)$/.exec(cursor)?.[1] || 0);
  else if (cursor) {
    try {
      const [, key = "", position = "null"] = String(cursor).split("|").map(decodeURIComponent);
      const at = list.positions.get(key);
      if (at !== undefined) start = backwards ? at : at + 1;
      else {
        // Its item has left the list: carry on from where it stood.
        const seek = JSON.parse(position);
        const found = seek
          ? list.entries.findIndex((entry) => compareGalleryKeys(entry.position, seek, sort) > 0)
          : -1;
        start = found < 0 ? list.entries.length : found;
      }
    } catch {
      start = list.entries.length;
    }
  }
  const end = backwards ? start : Math.min(start + limit, list.entries.length);
  if (backwards) start = Math.max(0, end - limit);
  const slice = list.entries.slice(start, end);
  const last = slice.at(-1);
  const nextCursor =
    !last || end >= list.entries.length ? "" : ranked ? `r|${end}` : listCursorFor(last);
  return {
    items: listedItems(slice),
    nextCursor,
    ...(window && {
      previousCursor: start > 0 && slice.length ? listCursorFor(slice[0]) : "",
    }),
  };
}

/** The visible days and the seek position before each begins, without loading media records. */
function galleryTimeline(list, dates) {
  const timeZone = dates.resolvedOptions().timeZone;
  if (list.timeline?.timeZone === timeZone) return list.timeline.days;
  const days = [];
  for (const [index, { position }] of list.entries.entries()) {
    const day = position.time === null ? "" : dates.format(position.time);
    const last = days.at(-1);
    if (last?.day === day) last.count += 1;
    else days.push({ day, count: 1, cursor: index ? listCursorFor(list.entries[index - 1]) : "" });
  }
  list.timeline = { timeZone, days };
  return days;
}

/**
 * A page of the gallery; uploaded images (references.js) are listed only, and alone, with `uploads`.
 * `query` narrows it in SQL (galleryItems' fields) and `filter` tests each item in JS, with
 * `filterKey` naming everything `filter` depends on so its list is kept between pages. `rank`
 * (Find Similar) orders by its score instead, highest first, leaving out items it can't score.
 * `selection` reads all or only failed members of the same list in one request. `dates` indexes
 * a date-ordered list's days, and `window` pages in either direction from one of its cursors.
 */
export function pageGallery({
  type = "",
  limit = 200,
  cursor = "",
  includeFailed = true,
  includeDisliked = false,
  uploads = false,
  query = {},
  filter = null,
  filterKey = "",
  rank = null,
  sort = "newest",
  selection,
  dates = null,
  window = false,
  beforeCursor = "",
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 200));
  const sql = {
    ...query,
    uploaded: uploads,
    ...((includeDisliked || (sort === "disliked" && !rank)) && !query.rating
      ? { includeDisliked: true }
      : { unlisted: query.rating === "disliked" }),
    ...(type && { type }),
    notStatus: [query.notStatus ?? [], "cancelled", ...(includeFailed ? [] : ["failed"])].flat(),
  };
  const list =
    filter || rank || sort !== "newest" || dates || window
      ? keptList(sql, filter, filterKey, rank, sort)
      : null;
  if (dates) return { days: galleryTimeline(list, dates) };
  if (selection) {
    const failed = selection === "failed";
    const items = list
      ? listedItems(failed ? list.entries.filter((entry) => entry.failed) : list.entries)
      : failed
        ? galleryItems({ ...sql, status: "failed" }).filter(hasGalleryMedia)
        : Array.from(visibleRows(sql), ({ item }) => item);
    return {
      items,
      nextCursor: "",
      hasMore: false,
      revision: galleryRevision,
      totalApprox: items.length,
    };
  }
  if (list) {
    const page = listPage(
      list,
      beforeCursor || cursor,
      safeLimit,
      Boolean(rank),
      sort,
      Boolean(beforeCursor),
      window,
    );
    return {
      ...page,
      hasMore: Boolean(page.nextCursor),
      revision: galleryRevision,
      totalApprox: list.entries.length,
    };
  }
  const items = [];
  let nextCursor = "";
  let previous = null;
  for (const { row, item } of visibleRows(sql, null, readCursor(cursor))) {
    if (items.length === safeLimit) {
      nextCursor = cursorFor(rowKey(previous));
      break;
    }
    items.push(item);
    previous = row;
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
        logWarning(`Could not delete a gallery file: ${error.message}`);
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
        logWarning(`Could not delete a gallery file: ${error.message}`);
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
export function cleanupGalleryState(queue, query = {}) {
  const { sql, params } = where(query);
  const scope = sql ? `${sql} AND` : "WHERE";
  const open =
    query.jobId !== undefined
      ? statement(
          `SELECT value FROM studio_gallery INDEXED BY studio_gallery_job
           ${scope} (status = 'pending' OR upscale_status = 'running')`,
        ).all(...params)
      : statement(
          `SELECT value FROM studio_gallery INDEXED BY studio_gallery_status ${scope} status = 'pending'
           UNION ALL SELECT value FROM studio_gallery INDEXED BY studio_gallery_upscale
           ${scope} upscale_status = 'running' AND status IS NOT 'pending'`,
        ).all(...params, ...params);
  if (!open.length) return;
  const jobs = new Map();
  const jobState = (ownerId, jobId) => {
    const key = JSON.stringify([ownerId, jobId]);
    let state = jobs.get(key);
    if (!state) {
      state = { unfinished: queue.unfinished(ownerId, jobId) };
      jobs.set(key, state);
    }
    return state;
  };
  const updated = [];
  const removed = [];
  for (const row of open) {
    const before = parse(row);
    const ownerId = before.ownerId || "";
    let item = before;
    // An upscale whose job is no longer unfinished (or was never recorded) is not running anymore.
    if (item.upscale?.status === "running" && !jobState(ownerId, item.upscale.jobId).unfinished)
      item = { ...item, upscale: { ...item.upscale, status: "cancelled", progress: null } };
    if (item.status === "pending" && item.jobId) {
      const state = jobState(ownerId, item.jobId);
      // A job still unfinished after a restart waits for recovery; a tile without one never arrives.
      if (!state.unfinished)
        item = { ...item, status: "failed", filename: "Generation interrupted" };
      else {
        state.hasResults ??= hasGalleryItems({ ownerId, jobId: item.jobId, status: "done" });
        if (state.hasResults) {
          removed.push(item);
          continue;
        }
      }
    }
    if (item !== before) updated.push(item);
  }
  forgetGalleryItems(removed);
  putGalleryItems(updated);
}

/** A saved output's own size, read from its file (sharp for an image, ffmpeg otherwise); null when unreadable. */
export async function outputFileSize(file, type) {
  if (type === "image")
    return sharp(file)
      .metadata()
      .catch(() => null);
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
      const { seed, ...saved } = output;
      let item = saved;
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
        ...(body.galleryAt ? { galleryAt: body.galleryAt } : {}),
        durationMs,
        // How long ComfyUI itself took, without waiting in its queue.
        ...(job.timing ? { timing: job.timing } : {}),
        // An inpaint result is the whole original picture, whatever size the crop sampled at.
        width: Number(size?.width || body.inpaint?.image?.width || body.width || 0),
        height: Number(size?.height || body.inpaint?.image?.height || body.height || 0),
        model: body.model || "",
        settings: generationSettings(seed == null ? body : { ...body, seed }),
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
