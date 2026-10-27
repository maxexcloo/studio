import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime, restoreRuntimeBackup } from "./migration.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  usesRuntimeDatabase,
  writeRuntimeDocument,
} from "./runtime.ts";

test("migration dry run, verified backup, SQLite authority and restoration preserve identities and result links", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-migration-"));
  t.after(() => {
    closeRuntimeDatabase(data);
    fs.rmSync(data, { recursive: true, force: true });
  });
  const documents = {
    accounts: {
      version: 1,
      accounts: [{ id: "kept-owner", role: "administrator", username: "example" }],
      sessions: [],
    },
    gallery: [
      {
        id: "original",
        jobId: "kept-job",
        index: 0,
        ownerId: "kept-owner",
        url: "/comfy/view?filename=old.png&subfolder=studio&type=media",
        settings: { profileId: "custom:original" },
      },
    ],
    "gallery-hidden": { "h:marker": 123 },
  };
  for (const [name, value] of Object.entries(documents))
    fs.writeFileSync(path.join(data, `${name}.json`), JSON.stringify(value));
  assert.equal(migrateRuntime(data).applied, false);
  assert.equal(fs.existsSync(path.join(data, "studio.sqlite")), false);
  const result = migrateRuntime(data, { apply: true });
  assert.equal(result.applied, true);
  assert.equal(usesRuntimeDatabase(data), true);
  for (const [name, value] of Object.entries(documents))
    assert.deepEqual(readRuntimeDocument(data, name), value);
  writeRuntimeDocument(data, "gallery", [...documents.gallery, { id: "new" }]);
  closeRuntimeDatabase(data);
  assert.equal((readRuntimeDocument(data, "gallery") as unknown[]).length, 2);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(data, "gallery.json"), "utf8")),
    documents.gallery,
    "legacy files remain untouched for rollback",
  );
  assert.equal(
    migrateRuntime(data, { apply: true }).applied,
    false,
    "re-running never imports stale JSON",
  );
  const restored = path.join(data, "restore-rehearsal");
  assert.deepEqual(restoreRuntimeBackup(result.backup, restored), { restored: 3 });
  for (const [name, value] of Object.entries(documents))
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(restored, `${name}.json`), "utf8")),
      value,
    );
  assert.throws(() => restoreRuntimeBackup(result.backup, restored), /empty/);
});

test("malformed source fails migration without creating or overwriting a database", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-migration-conflict-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  fs.writeFileSync(path.join(data, "gallery.json"), "{broken");
  const result = migrateRuntime(data, { apply: true });
  assert.equal(result.applied, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(fs.existsSync(path.join(data, "studio.sqlite")), false);
});

test("a backup manifest write failure leaves legacy state authoritative", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-migration-backup-failure-"));
  t.after(() => {
    closeRuntimeDatabase(data);
    fs.rmSync(data, { recursive: true, force: true });
  });
  const original = JSON.stringify([{ id: "kept" }]);
  fs.writeFileSync(path.join(data, "gallery.json"), original);
  const write = fs.writeFileSync;
  t.mock.method(
    fs,
    "writeFileSync",
    (
      file: Parameters<typeof fs.writeFileSync>[0],
      value: Parameters<typeof fs.writeFileSync>[1],
      options?: Parameters<typeof fs.writeFileSync>[2],
    ) => {
      if (String(file).endsWith("mapping.json")) throw new Error("Backup disk is full");
      return write(file, value, options);
    },
  );
  assert.throws(() => migrateRuntime(data, { apply: true }), /Backup disk is full/);
  assert.equal(usesRuntimeDatabase(data), false);
  assert.equal(fs.readFileSync(path.join(data, "gallery.json"), "utf8"), original);
});
