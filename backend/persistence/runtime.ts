import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const databases = new Map<string, DatabaseSync>();
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

export function runtimeDatabase(dataDir: string): DatabaseSync {
  const filename = databaseFile(dataDir);
  let db = databases.get(filename);
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS studio_documents (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
    databases.set(filename, db);
  }
  return db;
}

/** Legacy JSON remains authoritative until the explicit, backed-up migration commits. */
export function usesRuntimeDatabase(dataDir: string): boolean {
  if (!fs.existsSync(databaseFile(dataDir))) return false;
  const cached = databases.get(databaseFile(dataDir));
  const db = cached || new DatabaseSync(databaseFile(dataDir), { readOnly: true });
  try {
    return hasMigration(db, "runtime-json-v1");
  } finally {
    if (!cached) db.close();
  }
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
