import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createGalleryTable } from "./gallery-rows.ts";

const databases = new Map<string, DatabaseSync>();
/** The JSON stores runtime-json-v1 moves into SQLite. */
export const legacyFiles = ["accounts.json", "gallery.json", "gallery-hidden.json"] as const;
export const databaseFile = (dataDir: string) => path.join(dataDir, "studio.sqlite");
/**
 * The JSON files json-stores-v1 (persistence/json-stores.ts) moves into SQLite, relative to the
 * data folder, `.bak` copies included: documents, each account's prompt histories and LoRA stacks
 * (in `accounts/<key>/`, at the top in single-user mode), import records and ingested runs.
 */
export const jsonStoreSource =
  /^(?:(workflow-preferences|timings|model-types|presets|library\/updates|mcp-assistant|comparisons|mcp-ownership)|(?:accounts\/([0-9a-f]{64})\/)?(prompt-history|negative-prompt-history|lora-stacks)|library\/imports\/(imp-[a-z0-9]{6,40})|media-ingested)\.json(\.bak)?$/;

/** The json-stores-v1 sources in a data folder, sorted. */
export function jsonStoreFiles(dataDir: string): string[] {
  const list = (dir: string) => {
    try {
      return fs.readdirSync(path.join(dataDir, dir)).map((name) => (dir ? `${dir}/${name}` : name));
    } catch {
      return [];
    }
  };
  return [
    ...list(""),
    ...list("library"),
    ...list("library/imports"),
    ...list("accounts").flatMap(list),
  ]
    .filter((source) => jsonStoreSource.test(source))
    .sort();
}

/**
 * An account's own document (prompt histories, LoRA stacks): `<name>:<sha256 of its id>`, the key
 * of the `accounts/<key>` folder it was a file in, or `<name>:` in single-user mode.
 */
export const ownerDocumentName = (name: string, ownerId = "") =>
  `${name}:${ownerId ? crypto.createHash("sha256").update(String(ownerId)).digest("hex") : ""}`;

/**
 * Runs `read` on a read-only copy of a stopped studio's database (undefined without one), so
 * SQLite may create sidecars only on the private copy.
 */
export function withOfflineDatabase<T>(dataDir: string, read: (db: DatabaseSync) => T) {
  const file = databaseFile(dataDir);
  if (!fs.existsSync(file)) return undefined;
  const temporary = fs.mkdtempSync(path.join(tmpdir(), "studio-runtime-read-"));
  try {
    const copy = databaseFile(temporary);
    fs.copyFileSync(file, copy);
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Whether a migration (such as `runtime-json-v1`) has committed in this database. */
export function hasMigration(db: DatabaseSync, name: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'studio_migrations'")
      .get() && db.prepare("SELECT name FROM studio_migrations WHERE name = ?").get(name),
  );
}

/** Offline inspection of stopped studios. */
export function readOfflineRuntime(dataDir: string, names: readonly string[] = []) {
  const result: { migrated: boolean; documents: Record<string, unknown> } = {
    migrated: false,
    documents: {},
  };
  withOfflineDatabase(dataDir, (db) => {
    result.migrated = hasMigration(db, "runtime-json-v1");
    if (!result.migrated) return;
    const read = db.prepare("SELECT value FROM studio_documents WHERE name = ?");
    for (const name of names) {
      const row = read.get(name) as { value: string } | undefined;
      if (row) result.documents[name] = JSON.parse(row.value);
    }
  });
  return result;
}

/** Opens a database with Studio's settings; the server shares one connection through runtimeDatabase. */
export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  // Before WAL creates the sidecars, which take the database file's mode.
  if (filename !== ":memory:") fs.chmodSync(filename, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  return db;
}

export function runtimeDatabase(dataDir: string): DatabaseSync {
  const filename = databaseFile(dataDir);
  let db = databases.get(filename);
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    db = openDatabase(filename);
    db.exec(`CREATE TABLE IF NOT EXISTS studio_documents (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_library_imports (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_ingested_jobs (job_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
      ${createGalleryTable};`);
    databases.set(filename, db);
  }
  return db;
}

/**
 * Studio keeps accounts, deletion markers and the gallery only in SQLite. A data folder still on
 * the older JSON files (`runtime-json-v1` not applied) or the single gallery document
 * (`gallery-rows-v1` not applied) must go through migrate-runtime first, so Studio refuses to
 * start on one rather than ignore what it holds.
 */
export function assertCurrentStorage(dataDir: string): void {
  const files = legacyFiles.filter((name) => fs.existsSync(path.join(dataDir, name)));
  const db = runtimeDatabase(dataDir);
  const pending = [
    ...(files.length && !hasMigration(db, "runtime-json-v1") ? files : []),
    ...(db.prepare("SELECT 1 FROM studio_documents WHERE name = 'gallery'").get()
      ? ["the gallery document"]
      : []),
  ];
  if (pending.length)
    throw new Error(
      `${dataDir} still holds ${pending.join(", ")}. Stop Studio and run migrate-runtime (see CONFIGURATION.md, SQLite Migration & Rollback) before starting it.`,
    );
}

export function readRuntimeDocument(dataDir: string, name: string): unknown {
  const row = runtimeDatabase(dataDir)
    .prepare("SELECT value FROM studio_documents WHERE name = ?")
    .get(name) as { value: string } | undefined;
  if (!row) throw Object.assign(new Error(`No saved ${name}`), { code: "ENOENT" });
  return JSON.parse(row.value);
}

export function writeRuntimeDocument(dataDir: string, name: string, value: unknown): void {
  runtimeDatabase(dataDir)
    .prepare(
      "INSERT INTO studio_documents (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    )
    .run(name, JSON.stringify(value));
}

/**
 * A document's value, or undefined without one. A folder without a database stays without one, so
 * migrate-runtime's dry runs read through this.
 */
export function savedDocument(dataDir: string, name: string): unknown {
  if (!fs.existsSync(databaseFile(dataDir))) return undefined;
  const row = runtimeDatabase(dataDir)
    .prepare("SELECT value FROM studio_documents WHERE name = ?")
    .get(name) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

/** Every account's `name` document (ownerDocumentName), read like savedDocument. */
export function ownerDocuments(dataDir: string, name: string) {
  if (!fs.existsSync(databaseFile(dataDir))) return [];
  return (
    runtimeDatabase(dataDir)
      .prepare(
        "SELECT name, value FROM studio_documents WHERE substr(name, 1, ?) = ? ORDER BY name",
      )
      .all(name.length + 1, `${name}:`) as { name: string; value: string }[]
  ).map((row) => ({ name: row.name, value: JSON.parse(row.value) as unknown }));
}

export function deleteRuntimeDocument(dataDir: string, name: string): void {
  runtimeDatabase(dataDir).prepare("DELETE FROM studio_documents WHERE name = ?").run(name);
}

export function closeRuntimeDatabase(dataDir: string): void {
  const filename = databaseFile(dataDir);
  databases.get(filename)?.close();
  databases.delete(filename);
}
