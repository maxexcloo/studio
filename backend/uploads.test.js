import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mediaSubfolder } from "./media-paths.js";
import {
  migrateGalleryRows,
  migrateRuntime,
  restoreRuntimeBackup,
} from "./persistence/migration.ts";
import { readGalleryRows } from "./persistence/gallery-rows.ts";
import { closeRuntimeDatabase, runtimeDatabase } from "./persistence/runtime.ts";
import { migrateUploads } from "./uploads.js";

test("uploads-gallery-v1 turns the reference store's uploads into their owners' uploaded gallery images, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uploads-gallery-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const generation = { id: "made", type: "image", status: "done", createdAt: "2026-01-01" };
  fs.writeFileSync(path.join(dataDir, "gallery.json"), JSON.stringify([generation]));
  const store = path.join(dataDir, "reference-assets");
  fs.mkdirSync(path.join(store, "files"), { recursive: true });
  fs.writeFileSync(path.join(store, "files", "kept.png"), "png bytes");
  const upload = (id, file, ownerId) => ({
    id,
    source: "upload",
    name: `${id}.png`,
    mime: "image/png",
    width: 32,
    height: 24,
    size: 9,
    hash: "abc",
    file,
    thumbnail: `${id}.webp`,
    ...(ownerId ? { ownerId } : {}),
    createdAt: "2026-02-01T00:00:00.000Z",
  });
  const index = [upload("kept", "kept.png", "account-a"), upload("lost", "lost.png")];
  fs.writeFileSync(path.join(store, "index.json"), JSON.stringify(index));

  assert.equal(migrateUploads(dataDir).galleryRowsMigrated, false, "waits for gallery rows");
  migrateRuntime(dataDir, { apply: true });
  migrateGalleryRows(dataDir, { apply: true });

  const plan = migrateUploads(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(
    plan.uploads.map((item) => item.id),
    ["kept"],
  );
  assert.deepEqual(plan.missing, ["lost"]);
  assert.equal(readGalleryRows(runtimeDatabase(dataDir)).length, 1);
  assert.ok(fs.existsSync(store), "a dry run moves nothing");

  const result = migrateUploads(dataDir, { apply: true });
  assert.equal(result.applied, true);
  const rows = readGalleryRows(runtimeDatabase(dataDir));
  const item = rows.find((row) => row.id === "kept");
  assert.equal(item.uploaded, true);
  assert.equal(item.ownerId, "account-a");
  assert.equal(item.filename, "kept.png");
  const subfolder = mediaSubfolder("account-a");
  assert.equal(
    fs.readFileSync(path.join(dataDir, "media", subfolder, "kept.png"), "utf8"),
    "png bytes",
  );
  assert.equal(
    item.url,
    `/comfy/view?${new URLSearchParams({ filename: "kept.png", subfolder, type: "media" })}`,
  );
  assert.equal(fs.existsSync(store), false, "the store moves into the backup");
  assert.equal(migrateUploads(dataDir, { apply: true }).alreadyMigrated, true);

  const restored = path.join(dataDir, "restore-rehearsal");
  restoreRuntimeBackup(result.backup, restored);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(restored, "reference-assets", "index.json"), "utf8")),
    index,
  );
  assert.ok(fs.existsSync(path.join(restored, "reference-assets", "files", "kept.png")));
});
