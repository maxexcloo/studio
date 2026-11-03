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

export function deleteRuntimeDocument(dataDir: string, name: string): void {
  runtimeDatabase(dataDir).prepare("DELETE FROM studio_documents WHERE name = ?").run(name);
}

export function closeRuntimeDatabase(dataDir: string): void {
  const filename = databaseFile(dataDir);
  databases.get(filename)?.close();
  databases.delete(filename);
}
