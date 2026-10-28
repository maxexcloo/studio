import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateGalleryRows, migrateRuntime, restoreRuntimeBackup } from "./migration.ts";
import { readGalleryRows } from "./gallery-rows.ts";
import { closeRuntimeDatabase, readRuntimeDocument, runtimeDatabase } from "./runtime.ts";

test("gallery-rows-v1 moves the gallery document into rows that Studio then saves item by item", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-rows-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const item = (id: string, minute: number) => ({
    id,
    type: "image",
    status: "done",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  });
  const original = [item("kept", 2), item("removed", 1)];
  fs.writeFileSync(path.join(dataDir, "gallery.json"), JSON.stringify(original));
  assert.equal(migrateRuntime(dataDir, { apply: true }).applied, true);

  const plan = migrateGalleryRows(dataDir);
  assert.equal(plan.applied, false);
  assert.equal(plan.mappings[0].count, 2);
  assert.deepEqual(readRuntimeDocument(dataDir, "gallery"), original);

  const result = migrateGalleryRows(dataDir, { apply: true });
  assert.equal(result.applied, true);
  assert.throws(() => readRuntimeDocument(dataDir, "gallery"), { code: "ENOENT" });
  assert.equal(migrateGalleryRows(dataDir, { apply: true }).alreadyMigrated, true);
  const restored = path.join(dataDir, "restore-rehearsal");
  restoreRuntimeBackup(result.backup, restored);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(restored, "gallery.json"), "utf8")),
    original,
  );
  closeRuntimeDatabase(dataDir);

  const run = (source: string) =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STUDIO_DATA_DIR: dataDir, STUDIO_ENV_FILE: "/dev/null" },
    });
  run(`
    import assert from 'node:assert/strict';
    import {gallery,setGallery,setGalleryFavorites,flushGalleryStrict} from './backend/gallery-store.js';
    assert.deepEqual(gallery.map(item=>item.id),['kept','removed']);
    setGalleryFavorites(['kept'],true);
    setGallery([{id:'added',type:'image',status:'done',createdAt:'2026-01-02T00:00:00Z',preview:'data:'},...gallery.filter(item=>item.id!=='removed')]);
    await flushGalleryStrict();
  `);
  const rows = readGalleryRows(runtimeDatabase(dataDir)) as {
    id: string;
    favorite?: boolean;
    preview?: string;
  }[];
  assert.deepEqual(rows.map((row) => row.id).sort(), ["added", "kept"]);
  assert.equal(rows.find((row) => row.id === "kept")?.favorite, true);
  assert.equal(rows.find((row) => row.id === "added")?.preview, undefined);
});
