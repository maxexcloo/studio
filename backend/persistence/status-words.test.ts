import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeGalleryRows, readGalleryRows } from "./gallery-rows.ts";
import { restoreRuntimeBackup } from "./migration.ts";
import {
  assertCurrentStorage,
  closeRuntimeDatabase,
  hasMigration,
  runtimeDatabase,
} from "./runtime.ts";
import { migrateStatusWords } from "./status-words.ts";

const gallery = [
  { id: "a", url: "/a.png", status: "error", error: "Out of memory" },
  { id: "b", url: "/b.png", status: "done", upscale: { status: "canceled" } },
  { id: "c", url: "/c.png", status: "done" },
];
const job = {
  id: "job-1",
  status: "failed",
  items: [{ id: "a", status: "canceled" }, "kept as it is"],
  outputs: [],
};

/** A data folder whose gallery rows and queue record an older build wrote. */
function dataFolder(t: test.TestContext) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-status-words-"));
  t.after(() => {
    closeRuntimeDatabase(data);
    fs.rmSync(data, { recursive: true, force: true });
  });
  const db = runtimeDatabase(data);
  writeGalleryRows(db, gallery);
  db.exec(
    "CREATE TABLE studio_queue (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO studio_queue VALUES (?, '', 's', '', 'failed', ?)").run(
    job.id,
    JSON.stringify(job),
  );
  closeRuntimeDatabase(data);
  return data;
}

test("status-words-v1 plans, rewrites the old words, restores and runs once", (t) => {
  const data = dataFolder(t);
  assert.throws(
    () => assertCurrentStorage(data),
    /still holds 2 gallery rows with old status words, 1 queue records with old status words\./,
  );

  const plan = migrateStatusWords(data);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.words, { "error → failed": 1, "canceled → cancelled": 2 });
  assert.deepEqual(
    plan.mappings.map(({ source, target, count }) => [source, target, count]),
    [
      ["studio_gallery.json", "studio_gallery", 2],
      ["studio_queue.json", "studio_queue", 1],
    ],
  );

  const result = migrateStatusWords(data, { apply: true });
  assert.equal(result.applied, true);
  assertCurrentStorage(data);
  const db = runtimeDatabase(data);
  assert.equal(hasMigration(db, "status-words-v1"), true);
  assert.deepEqual(
    readGalleryRows(db).sort((x, y) =>
      String((x as { id: string }).id).localeCompare((y as { id: string }).id),
    ),
    [
      { ...gallery[0], status: "failed" },
      { ...gallery[1], upscale: { status: "cancelled" } },
      gallery[2],
    ],
  );
  const record = db.prepare("SELECT record FROM studio_queue").get() as { record: string };
  assert.deepEqual(JSON.parse(record.record), {
    ...job,
    items: [{ id: "a", status: "cancelled" }, "kept as it is"],
  });

  const again = migrateStatusWords(data, { apply: true });
  assert.equal(again.alreadyMigrated, true);
  assert.equal(again.applied, false);

  const restored = fs.mkdtempSync(path.join(os.tmpdir(), "studio-status-words-restore-"));
  t.after(() => fs.rmSync(restored, { recursive: true, force: true }));
  assert.deepEqual(restoreRuntimeBackup(result.backup, restored), { restored: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, "studio_queue.json"), "utf8")), [
    { id: job.id, record: JSON.stringify(job) },
  ]);
});

test("migrate-runtime's dry run starts on a folder Studio refuses for old status words", (t) => {
  const data = dataFolder(t);
  const command = path.join(import.meta.dirname, "../commands/migrate-runtime.mjs");
  const output = execFileSync(process.execPath, [command, "--data-dir", data], {
    env: { ...process.env, STUDIO_DATA_DIR: data },
    encoding: "utf8",
  });
  assert.match(output, /"error → failed": 1/);
});
