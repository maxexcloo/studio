import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateJsonStores } from "./json-stores.ts";
import { restoreRuntimeBackup } from "./migration.ts";
import {
  assertCurrentStorage,
  closeRuntimeDatabase,
  databaseFile,
  hasMigration,
  ownerDocumentName,
  readRuntimeDocument,
  runtimeDatabase,
} from "./runtime.ts";

const owner = ownerDocumentName("", "account-1").slice(1);
const files = {
  "workflow-preferences.json": { favorites: ["custom:a"], lastUsed: {} },
  "workflow-preferences.json.bak": { favorites: [], lastUsed: {} },
  "timings.json": { runs: [{ key: "image:custom:a", ms: 1000 }], upscales: [] },
  "library/updates.json": { checkedAt: "", byEntry: {}, applied: {} },
  "mcp-ownership.json": {
    version: 1,
    signingKey: "kept",
    jobs: { j: "o" },
    assets: {},
    uploads: { "upload-link:abcdefghijklmnop": "asset-1" },
  },
  "prompt-history.json": { version: 1, enabled: true, entries: [{ text: "a fox" }] },
  [`accounts/${owner}/lora-stacks.json`]: { stacks: { "custom:a": [] }, library: null },
  "library/imports/imp-abc123.json": { id: "imp-abc123", state: "ready" },
  "media-ingested.json": { version: 1, jobs: { "job-1": 1, "job-2": 2 } },
};

function dataFolder(t: test.TestContext) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-json-stores-"));
  t.after(() => {
    closeRuntimeDatabase(data);
    fs.rmSync(data, { recursive: true, force: true });
  });
  for (const [name, value] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(data, name)), { recursive: true });
    fs.writeFileSync(path.join(data, name), JSON.stringify(value));
  }
  // A picture beside the import records stays a file.
  fs.writeFileSync(path.join(data, "library/imports/imp-abc123.webp"), "picture");
  return data;
}

test("json-stores-v1 plans, moves every store into SQLite, restores and runs once", (t) => {
  const data = dataFolder(t);
  const plan = migrateJsonStores(data);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(fs.existsSync(databaseFile(data)), false, "a dry run creates no database");
  assert.deepEqual(
    Object.fromEntries(plan.mappings.map(({ source, target, count }) => [source, [target, count]])),
    {
      "workflow-preferences.json": ["studio_documents/workflow-preferences", 1],
      "workflow-preferences.json.bak": ["", 0],
      "timings.json": ["studio_documents/timings", 1],
      "library/updates.json": ["studio_documents/library-updates", 1],
      "mcp-ownership.json": ["studio_documents/mcp-ownership", 1],
      "prompt-history.json": ["studio_documents/prompt-history:", 1],
      [`accounts/${owner}/lora-stacks.json`]: [`studio_documents/lora-stacks:${owner}`, 1],
      "library/imports/imp-abc123.json": ["studio_library_imports/imp-abc123", 1],
      "media-ingested.json": ["studio_ingested_jobs/", 2],
    },
  );

  assert.throws(
    () => assertCurrentStorage(data),
    /still holds .*media-ingested\.json.*timings\.json.*, 1 import records in library\/imports\. .*--apply/,
  );

  const result = migrateJsonStores(data, { apply: true });
  assert.equal(result.applied, true);
  assertCurrentStorage(data);
  for (const name of Object.keys(files)) assert.equal(fs.existsSync(path.join(data, name)), false);
  assert.equal(fs.existsSync(path.join(data, "library/imports/imp-abc123.webp")), true);
  assert.deepEqual(
    readRuntimeDocument(data, "workflow-preferences"),
    files["workflow-preferences.json"],
  );
  assert.deepEqual(readRuntimeDocument(data, "mcp-ownership"), files["mcp-ownership.json"]);
  assert.deepEqual(readRuntimeDocument(data, "library-updates"), files["library/updates.json"]);
  assert.deepEqual(
    readRuntimeDocument(data, ownerDocumentName("prompt-history")),
    files["prompt-history.json"],
  );
  assert.deepEqual(
    readRuntimeDocument(data, ownerDocumentName("lora-stacks", "account-1")),
    files[`accounts/${owner}/lora-stacks.json`],
  );
  const db = runtimeDatabase(data);
  assert.deepEqual(
    db
      .prepare("SELECT id, value FROM studio_library_imports")
      .all()
      .map((row) => ({ ...row })),
    [{ id: "imp-abc123", value: JSON.stringify(files["library/imports/imp-abc123.json"]) }],
  );
  assert.deepEqual(
    db
      .prepare("SELECT job_id, at FROM studio_ingested_jobs ORDER BY job_id")
      .all()
      .map((row) => ({ ...row })),
    [
      { job_id: "job-1", at: 1 },
      { job_id: "job-2", at: 2 },
    ],
  );
  assert.equal(hasMigration(db, "json-stores-v1"), true);

  const again = migrateJsonStores(data, { apply: true });
  assert.equal(again.alreadyMigrated, true);
  assert.equal(again.applied, false);
  assert.deepEqual(again.mappings, []);

  const restored = fs.mkdtempSync(path.join(os.tmpdir(), "studio-json-stores-restore-"));
  t.after(() => fs.rmSync(restored, { recursive: true, force: true }));
  assert.deepEqual(restoreRuntimeBackup(result.backup, restored), {
    restored: Object.keys(files).length,
  });
  for (const [name, value] of Object.entries(files))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, name), "utf8")), value);
});

test("json-stores-v1 refuses unreadable stores and leaves everything in place", (t) => {
  const data = dataFolder(t);
  fs.writeFileSync(path.join(data, "comparisons.json"), "{");
  const result = migrateJsonStores(data, { apply: true });
  assert.equal(result.applied, false);
  assert.deepEqual(result.conflicts, [
    "comparisons.json is unreadable or has an unsupported shape",
  ]);
  assert.equal(fs.existsSync(path.join(data, "timings.json")), true);
  assert.equal(fs.existsSync(databaseFile(data)), false);
});

test("migrate-runtime's dry run starts on a folder Studio itself refuses", (t) => {
  const data = dataFolder(t);
  const command = path.join(import.meta.dirname, "../commands/migrate-runtime.mjs");
  const output = execFileSync(process.execPath, [command, "--data-dir", data], {
    env: { ...process.env, STUDIO_DATA_DIR: data },
    encoding: "utf8",
  });
  assert.match(output, /"source": "timings\.json"/);
});
