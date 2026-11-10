import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeGalleryRows } from "./gallery-rows.ts";
import { restoreRuntimeBackup, verifiedBackup } from "./migration.ts";
import {
  assertCurrentStorage,
  closeRuntimeDatabase,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./runtime.ts";

test("a new data folder starts with every table, the gallery's included", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-new-folder-"));
  t.after(() => {
    closeRuntimeDatabase(data);
    fs.rmSync(data, { recursive: true, force: true });
  });
  assertCurrentStorage(data);
  const tables = runtimeDatabase(data)
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, [
    "studio_documents",
    "studio_gallery",
    "studio_ingested_jobs",
    "studio_library_imports",
    "studio_migrations",
  ]);
});

test("Studio refuses a data folder that predates current storage until its migration is marked", (t) => {
  const folder = (name: string) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), `studio-${name}-`));
    t.after(() => {
      closeRuntimeDatabase(data);
      fs.rmSync(data, { recursive: true, force: true });
    });
    return data;
  };
  const mark = (data: string, name: string) =>
    runtimeDatabase(data)
      .prepare("INSERT INTO studio_migrations (name, applied_at) VALUES (?, ?)")
      .run(name, new Date().toISOString());
  const refused = (data: string, holds: RegExp) =>
    assert.throws(
      () => assertCurrentStorage(data),
      (error: Error) => {
        assert.match(error.message, holds);
        assert.match(error.message, /predates current storage/);
        assert.match(error.message, /migrate-runtime from Studio v2026\.11\.10\.4/);
        return true;
      },
    );

  const accounts = folder("accounts");
  fs.writeFileSync(path.join(accounts, "accounts.json"), JSON.stringify({ accounts: [] }));
  refused(accounts, /accounts\.json/);
  mark(accounts, "runtime-json-v1");
  assertCurrentStorage(accounts);

  const gallery = folder("gallery-document");
  writeRuntimeDocument(gallery, "gallery", []);
  refused(gallery, /the gallery document/);

  const stores = folder("json-stores");
  fs.writeFileSync(path.join(stores, "timings.json"), "{}");
  refused(stores, /timings\.json/);
  mark(stores, "json-stores-v1");
  assertCurrentStorage(stores);

  const words = folder("status-words");
  writeGalleryRows(runtimeDatabase(words), [{ id: "old", status: "error" } as { id: string }]);
  refused(words, /1 gallery rows with old status words/);
  mark(words, "status-words-v1");
  assertCurrentStorage(words);
});

test("a verified backup restores only into a separate empty folder", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backup-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const bytes = Buffer.from(JSON.stringify([{ id: "kept" }]));
  const mapping = {
    source: "gallery.json",
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
  const backup = verifiedBackup(data, "test", [{ ...mapping, bytes }], { mappings: [mapping] });
  const restored = path.join(data, "restore-rehearsal");
  assert.deepEqual(restoreRuntimeBackup(backup, restored), { restored: 1 });
  assert.deepEqual(fs.readFileSync(path.join(restored, "gallery.json")), bytes);
  assert.throws(() => restoreRuntimeBackup(backup, restored), /empty/);
});
