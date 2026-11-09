import crypto from "node:crypto";
import { verifiedBackup } from "./migration.ts";
import {
  hasMigration,
  oldStatusRows,
  runtimeDatabase,
  statusWords,
  statusWordsMigration,
  withOfflineDatabase,
} from "./runtime.ts";

/**
 * The migrate-runtime step `status-words-v1`: gallery rows and the gallery items queue records
 * carry (`items`, `outputs`) say `failed`, `cancelled` and `cancelling` where older builds stored
 * `error`, `canceled` and `canceling` (runtime.ts statusWords), in `status` and `upscale.status`.
 *
 * Plans by default, counting each rewrite. `apply` copies every row it changes to a
 * `.backups/status-words-*` folder as `studio_gallery.json` and `studio_queue.json` (restorable
 * with --restore), then rewrites them and records the marker in one transaction. Run with Studio
 * stopped; a second run finds it done.
 */
type Item = Record<string, unknown> & { status?: unknown; upscale?: unknown };
type Counts = Record<string, number>;

const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const isRecord = (value: unknown): value is Item =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const current = (word: unknown) =>
  typeof word === "string" && Object.hasOwn(statusWords, word) ? statusWords[word] : undefined;

function currentItem(item: unknown, counts: Counts): unknown {
  if (!isRecord(item)) return item;
  const count = (word: string) => {
    const mapping = `${word} → ${statusWords[word]}`;
    counts[mapping] = (counts[mapping] || 0) + 1;
  };
  let next = item;
  const status = current(item.status);
  if (status) {
    count(item.status as string);
    next = { ...next, status };
  }
  const upscale = isRecord(item.upscale) ? current(item.upscale.status) : undefined;
  if (upscale) {
    count((item.upscale as Item).status as string);
    next = { ...next, upscale: { ...(item.upscale as Item), status: upscale } };
  }
  return next;
}

function currentRecord(record: Item, counts: Counts) {
  const next = { ...record };
  for (const list of ["items", "outputs"])
    if (Array.isArray(record[list]))
      next[list] = (record[list] as unknown[]).map((item) => currentItem(item, counts));
  return next;
}

function planStatusWords(dataDir: string) {
  const plan = {
    alreadyMigrated: false,
    words: {} as Counts,
    mappings: [] as { source: string; target: string; count: number; hash: string }[],
  };
  const changes = {
    gallery: [] as { key: string; value: string; next: string }[],
    queue: [] as { id: string; record: string; next: string }[],
  };
  withOfflineDatabase(dataDir, (db) => {
    plan.alreadyMigrated = hasMigration(db, statusWordsMigration);
    if (plan.alreadyMigrated) return;
    const old = oldStatusRows(db);
    for (const { key, value } of old.gallery)
      changes.gallery.push({
        key,
        value,
        next: JSON.stringify(currentItem(JSON.parse(value), plan.words)),
      });
    for (const { id, record } of old.queue)
      changes.queue.push({
        id,
        record,
        next: JSON.stringify(currentRecord(JSON.parse(record), plan.words)),
      });
  });
  const backups = [
    {
      source: "studio_gallery.json",
      target: "studio_gallery",
      rows: changes.gallery.map(({ key, value }) => ({ key, value })),
    },
    {
      source: "studio_queue.json",
      target: "studio_queue",
      rows: changes.queue.map(({ id, record }) => ({ id, record })),
    },
  ].filter(({ rows }) => rows.length);
  const copies = backups.map(({ rows }) => Buffer.from(JSON.stringify(rows)));
  plan.mappings = backups.map(({ source, target, rows }, index) => ({
    source,
    target,
    count: rows.length,
    hash: digest(copies[index]),
  }));
  return { plan, changes, copies };
}

export function migrateStatusWords(dataDir: string, { apply = false } = {}) {
  const { plan, changes, copies } = planStatusWords(dataDir);
  if (!apply || plan.alreadyMigrated || !plan.mappings.length)
    return { ...plan, applied: false, backup: "" };
  const backup = verifiedBackup(
    dataDir,
    "status-words",
    plan.mappings.map((mapping, index) => ({ ...mapping, bytes: copies[index] })),
    plan,
  );
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    const item = db.prepare("UPDATE studio_gallery SET value = ? WHERE key = ? AND value = ?");
    for (const { key, value, next } of changes.gallery)
      if (!item.run(next, key, value).changes)
        throw new Error(`Gallery item ${key} changed during the migration`);
    const job = db.prepare("UPDATE studio_queue SET record = ? WHERE id = ? AND record = ?");
    for (const { id, record, next } of changes.queue)
      if (!job.run(next, id, record).changes)
        throw new Error(`Queue record ${id} changed during the migration`);
    const left = oldStatusRows(db);
    if (left.gallery.length || left.queue.length)
      throw new Error("Old status words remain after the rewrite");
    db.prepare("INSERT INTO studio_migrations (name, applied_at) VALUES (?, ?)").run(
      statusWordsMigration,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}
