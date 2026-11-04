import crypto from "node:crypto";
import fs from "node:fs";
import { verifiedBackup } from "./persistence/migration.ts";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { isVersion, referencedResult, resultInput } from "../shared/versions.ts";

/**
 * The migrate-runtime step that regroups versions by their recorded source (gallery/versions.ts):
 * a queued run whose parent run's result is its first reference gets that result as its
 * `parentItemId`, as Chat now records it. Runs with a parent but no such source (a Chat's earlier
 * turn, which grouped whole chats) are counted as `ungrouped`, and runs made from a result but
 * changed too much to be its versions (`isVersion`) as `derived`; both now stand alone. Plans by
 * default; `apply` copies the changed rows to a `.backups/version-sources-*` folder and then writes
 * them, with Studio stopped. A second run finds nothing to record.
 */
export function versionSources(dataDir, { apply = false } = {}) {
  const empty = { recorded: [], ungrouped: 0, derived: 0, applied: false, backup: "" };
  if (!fs.existsSync(databaseFile(dataDir))) return empty;
  const db = runtimeDatabase(dataDir);
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_queue'")
    .get();
  if (!table) return empty;
  const rows = db.prepare("SELECT id, record FROM studio_queue").all();
  const jobs = new Map(rows.map((row) => [row.id, JSON.parse(row.record)]));
  const recorded = [];
  let ungrouped = 0;
  let derived = 0;
  for (const job of jobs.values()) {
    const parent = job.parentJobId && jobs.get(job.parentJobId);
    if (!parent) continue;
    const source = job.parentItemId || referencedResult(job.input || {}, parent);
    if (!source) ungrouped += 1;
    else if (!isVersion(job, parent)) derived += 1;
    if (source && !job.parentItemId) recorded.push({ id: job.id, parentItemId: source });
  }
  const plan = { recorded, ungrouped, derived };
  if (!apply || !recorded.length) return { ...plan, applied: false, backup: "" };

  const bytes = Buffer.from(
    JSON.stringify(rows.filter((row) => recorded.some(({ id }) => id === row.id))),
  );
  const backup = verifiedBackup(
    dataDir,
    "version-sources",
    [
      {
        source: "studio_queue.json",
        hash: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes,
      },
    ],
    plan,
  );
  const update = db.prepare("UPDATE studio_queue SET record = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { id, parentItemId } of recorded)
      update.run(JSON.stringify({ ...jobs.get(id), parentItemId }), id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}

/**
 * What a run's gallery results keep of the result it was made from, so they stay its versions once
 * the run leaves the queue or its Chat is deleted: that result (`parentItemId`), the run it came
 * from when the run joined that run's Chat, and `derived` when it changed too much to be one of its
 * versions (`isVersion`, against the parent run or else the saved source).
 */
export function resultSource(job, parentItemId, { parent, source } = {}) {
  const from = parent || { input: source ? resultInput(source) : {} };
  return {
    parentItemId,
    ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
    ...(isVersion(job, from) ? {} : { derived: true }),
  };
}

/** The gallery key or item ID a run's first reference names (a gallery image, or a video's frame). */
const firstReference = (input) => {
  const id = String(input?.referenceAssets?.[0]?.assetId || "").replace(
    /:(?:last-frame|frame-\d+)$/,
    "",
  );
  return id.startsWith("gallery:") ? Buffer.from(id.slice(8), "base64url").toString("utf8") : id;
};

/**
 * The migrate-runtime step that gives each gallery result the source its run recorded
 * (`resultSource`). A run that recorded none but edited or animated one of its owner's results
 * (its first reference) gets that result, counted as `referenced`. Plans by default; `apply` copies
 * the changed rows to a `.backups/gallery-sources-*` folder and then writes them. Online-safe: the
 * running server then takes the written fields into its gallery (runtime-migrations.js). A second
 * run finds nothing to fill.
 */
export function gallerySources(dataDir, { apply = false } = {}) {
  const empty = { filled: [], referenced: 0, applied: false, backup: "" };
  if (!fs.existsSync(databaseFile(dataDir))) return empty;
  const db = runtimeDatabase(dataDir);
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  if (!tables.has("studio_queue") || !tables.has("studio_gallery")) return empty;
  const jobs = new Map(
    db
      .prepare("SELECT id, record FROM studio_queue")
      .all()
      .map((row) => [row.id, JSON.parse(row.record)]),
  );
  const rows = db
    .prepare("SELECT key, value FROM studio_gallery")
    .all()
    .map((row) => ({ key: row.key, value: row.value, item: JSON.parse(row.value) }));
  const owner = (record) => record?.ownerId || "";
  const items = new Map();
  for (const { key, item } of rows) items.set(key, item).set(String(item.id || key), item);
  const filled = [];
  let referenced = 0;
  for (const { key, item } of rows) {
    const job = item.jobId && !item.parentItemId ? jobs.get(item.jobId) : undefined;
    if (!job || owner(job) !== owner(item)) continue;
    let source = job.parentItemId ? items.get(job.parentItemId) : undefined;
    if (!job.parentItemId) {
      if (!["refine", "animate"].includes(job.operation)) continue;
      source = items.get(firstReference(job.input));
      if (!source || source === item || owner(source) !== owner(item)) continue;
      referenced += 1;
    }
    const parent = jobs.get(job.parentJobId);
    filled.push({
      key,
      ...resultSource(job, job.parentItemId || source.id, {
        parent: parent && owner(parent) === owner(job) ? parent : undefined,
        source: source && owner(source) === owner(item) ? source : undefined,
      }),
    });
  }
  const plan = { filled, referenced };
  if (!apply || !filled.length) return { ...plan, applied: false, backup: "" };

  const changed = new Map(filled.map(({ key, ...fields }) => [key, fields]));
  const bytes = Buffer.from(
    JSON.stringify(
      rows.filter((row) => changed.has(row.key)).map(({ key, value }) => ({ key, value })),
    ),
  );
  const backup = verifiedBackup(
    dataDir,
    "gallery-sources",
    [
      {
        source: "studio_gallery.json",
        hash: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes,
      },
    ],
    plan,
  );
  const update = db.prepare("UPDATE studio_gallery SET value = ? WHERE key = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { key, item } of rows)
      if (changed.has(key)) update.run(JSON.stringify({ ...item, ...changed.get(key) }), key);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}
