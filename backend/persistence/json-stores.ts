import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifiedBackup } from "./migration.ts";
import {
  hasMigration,
  jsonStoreFiles,
  jsonStoreSource,
  jsonStoresMigration,
  runtimeDatabase,
  withOfflineDatabase,
} from "./runtime.ts";

/**
 * The migrate-runtime step `json-stores-v1`: moves the JSON stores Studio kept beside its database
 * into it (runtime.ts jsonStoreSource). Documents become `studio_documents` rows under their name
 * (`library/updates.json` as `library-updates`), each account's prompt histories and LoRA stacks
 * `<name>:<key>` rows (runtime.ts ownerDocumentName), import records `studio_library_imports` rows
 * and ingested runs `studio_ingested_jobs` rows. A `.bak` copy carries the store only when its file
 * is missing, as json-store.js reads it; beside its file it has an empty target.
 *
 * Plans by default. `apply` copies every source to a `.backups/json-stores-*` folder (restorable
 * with --restore), commits the rows, their round trip and the marker in one transaction, then
 * removes the sources. Run with Studio stopped; a second run finds it done.
 */
type Mapping = { source: string; target: string; count: number; hash: string };
type Table = "studio_documents" | "studio_library_imports" | "studio_ingested_jobs";

const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function targetOf(source: string): { table: Table; key: string } {
  const [, document, owner = "", ownerStore, importId] = jsonStoreSource.exec(source) || [];
  if (document)
    return {
      table: "studio_documents",
      key: document === "library/updates" ? "library-updates" : document,
    };
  if (ownerStore) return { table: "studio_documents", key: `${ownerStore}:${owner}` };
  if (importId) return { table: "studio_library_imports", key: importId };
  return { table: "studio_ingested_jobs", key: "" };
}

/** Ingested runs as rows: job id and when it was taken in. */
const ingestedRows = (value: { jobs?: Record<string, unknown> }) =>
  Object.entries(value.jobs || {}).map(([id, at]) => [id, Math.trunc(Number(at)) || 0] as const);

export function planJsonStores(dataDir: string) {
  const plan = { alreadyMigrated: false, mappings: [] as Mapping[], conflicts: [] as string[] };
  const held = new Set<string>();
  withOfflineDatabase(dataDir, (db) => {
    plan.alreadyMigrated = hasMigration(db, jsonStoresMigration);
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    if (tables.has("studio_documents"))
      for (const row of db.prepare("SELECT name FROM studio_documents").all() as { name: string }[])
        held.add(`studio_documents/${row.name}`);
    if (tables.has("studio_library_imports"))
      for (const row of db.prepare("SELECT id FROM studio_library_imports").all() as {
        id: string;
      }[])
        held.add(`studio_library_imports/${row.id}`);
    if (
      tables.has("studio_ingested_jobs") &&
      db.prepare("SELECT 1 FROM studio_ingested_jobs").get()
    )
      held.add("studio_ingested_jobs/");
  });
  if (plan.alreadyMigrated) return plan;
  const files = jsonStoreFiles(dataDir);
  for (const source of files) {
    const bytes = fs.readFileSync(path.join(dataDir, source));
    const main = source.replace(/\.bak$/, "");
    if (source !== main && files.includes(main)) {
      plan.mappings.push({ source, target: "", count: 0, hash: digest(bytes) });
      continue;
    }
    const { table, key } = targetOf(main);
    let count = 1;
    try {
      const value = JSON.parse(bytes.toString());
      if (table === "studio_library_imports" && !isRecord(value))
        throw new Error("Expected an import record");
      if (table === "studio_ingested_jobs") {
        if (!isRecord(value) || (value.jobs !== undefined && !isRecord(value.jobs)))
          throw new Error("Expected ingested runs");
        count = ingestedRows(value).length;
      }
    } catch {
      plan.conflicts.push(`${source} is unreadable or has an unsupported shape`);
      continue;
    }
    if (held.has(`${table}/${key}`))
      plan.conflicts.push(`${source}: ${table} already holds ${key || "ingested runs"}`);
    plan.mappings.push({ source, target: `${table}/${key}`, count, hash: digest(bytes) });
  }
  return plan;
}

export function migrateJsonStores(dataDir: string, { apply = false } = {}) {
  const plan = planJsonStores(dataDir);
  if (!apply || plan.alreadyMigrated || plan.conflicts.length || !plan.mappings.length)
    return { ...plan, applied: false, backup: "" };
  const backup = verifiedBackup(
    dataDir,
    "json-stores",
    plan.mappings.map((mapping) => ({
      ...mapping,
      bytes: fs.readFileSync(path.join(dataDir, mapping.source)),
    })),
    plan,
  );
  const db = runtimeDatabase(dataDir);
  const count = (table: Table) =>
    (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  db.exec("BEGIN IMMEDIATE");
  try {
    const expected = {
      studio_documents: count("studio_documents"),
      studio_library_imports: count("studio_library_imports"),
      studio_ingested_jobs: count("studio_ingested_jobs"),
    };
    const insert = {
      studio_documents: db.prepare("INSERT INTO studio_documents (name, value) VALUES (?, ?)"),
      studio_library_imports: db.prepare(
        "INSERT INTO studio_library_imports (id, value) VALUES (?, ?)",
      ),
    };
    const saved = {
      studio_documents: db.prepare("SELECT value FROM studio_documents WHERE name = ?"),
      studio_library_imports: db.prepare("SELECT value FROM studio_library_imports WHERE id = ?"),
    };
    for (const mapping of plan.mappings) {
      if (!mapping.target) continue;
      const { table, key } = targetOf(mapping.source.replace(/\.bak$/, ""));
      const value = JSON.parse(fs.readFileSync(path.join(backup, mapping.source), "utf8"));
      if (table === "studio_ingested_jobs") {
        const rows = ingestedRows(value);
        const job = db.prepare("INSERT INTO studio_ingested_jobs (job_id, at) VALUES (?, ?)");
        for (const [id, at] of rows) job.run(id, at);
        const back = db.prepare("SELECT job_id, at FROM studio_ingested_jobs ORDER BY rowid").all();
        if (JSON.stringify(back.map((row) => [row.job_id, row.at])) !== JSON.stringify(rows))
          throw new Error(`Round-trip verification failed: ${mapping.source}`);
        expected[table] += rows.length;
        continue;
      }
      const text = JSON.stringify(value);
      insert[table].run(key, text);
      if ((saved[table].get(key) as { value: string } | undefined)?.value !== text)
        throw new Error(`Round-trip verification failed: ${mapping.source}`);
      expected[table] += 1;
    }
    for (const [table, rows] of Object.entries(expected))
      if (count(table as Table) !== rows)
        throw new Error(`Row count verification failed: ${table}`);
    db.prepare("INSERT INTO studio_migrations (name, applied_at) VALUES (?, ?)").run(
      jsonStoresMigration,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const mapping of plan.mappings) fs.rmSync(path.join(dataDir, mapping.source));
  return { ...plan, applied: true, backup };
}
