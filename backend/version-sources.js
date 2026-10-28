import crypto from "node:crypto";
import fs from "node:fs";
import { verifiedBackup } from "./persistence/migration.ts";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { isVersion, referencedResult } from "../shared/versions.ts";

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
