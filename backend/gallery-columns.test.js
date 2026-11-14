import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { galleryColumnsStep } from "./gallery-columns.js";
import { galleryOrderKey } from "./gallery/order.js";
import { writeGalleryRows } from "./persistence/gallery-rows.ts";
import { closeRuntimeDatabase, runtimeDatabase } from "./persistence/runtime.ts";

test("galleryColumns adds columns that read each item as the gallery's own order does", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-columns-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  assert.deepEqual(galleryColumnsStep(dataDir, { apply: true }).columns, [], "no database");
  const items = [
    {
      url: "/a",
      id: "a",
      ownerId: "u1",
      jobId: "j",
      index: 1,
      type: "image",
      status: "done",
      prompt: " \n　",
      createdAt: "2026-11-14T01:02:03.456Z",
      uploaded: true,
      dream: { state: "unseen" },
      upscale: { status: "running" },
    },
    {
      url: "/b",
      id: "b",
      status: "done",
      prompt: "",
      civitai: { imageId: 3 },
      createdAt: "not a time",
      favorite: true,
      resultSet: { id: "s" },
      dream: { state: "kept" },
    },
    { url: "/c", status: "pending", prompt: "" },
    { url: "/comfy/view?filename=old.png&type=media", id: "old", type: "image", status: "done" },
  ];
  writeGalleryRows(runtimeDatabase(dataDir), items);

  const plan = galleryColumnsStep(dataDir);
  assert.equal(plan.applied, false);
  assert.ok(plan.columns.includes("created_ms") && plan.indexes.includes("studio_gallery_order"));
  assert.equal(plan.thumbnails, 1);
  assert.equal(galleryColumnsStep(dataDir, { apply: true }).applied, true);
  const rows = runtimeDatabase(dataDir)
    .prepare(
      "SELECT item_id, owner_id, job_id, item_index, type, status, upscale_status, uploaded, favorite, dream_pool, set_id, created_ms, bucket FROM studio_gallery ORDER BY key",
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(
    rows.map(({ bucket, created_ms }) => ({ bucket, time: created_ms })),
    items.map((item) => {
      const { bucket, time } = galleryOrderKey(item);
      return { bucket, time };
    }),
  );
  assert.deepEqual(rows[0], {
    item_id: "a",
    owner_id: "u1",
    job_id: "j",
    item_index: 1,
    type: "image",
    status: "done",
    upscale_status: "running",
    uploaded: 1,
    favorite: 0,
    dream_pool: 1,
    set_id: null,
    created_ms: Date.parse(items[0].createdAt),
    bucket: 1,
  });
  assert.deepEqual(
    [rows[1].owner_id, rows[1].favorite, rows[1].dream_pool, rows[1].set_id],
    ["", 1, 0, "s"],
  );
  assert.equal(
    JSON.parse(
      runtimeDatabase(dataDir)
        .prepare("SELECT value FROM studio_gallery WHERE key = ?")
        .get(items[3].url).value,
    ).thumbnailUrl,
    "/comfy/thumb?filename=old.png&type=media",
  );
  const again = galleryColumnsStep(dataDir, { apply: true });
  assert.deepEqual(
    [again.applied, again.columns, again.indexes, again.thumbnails],
    [false, [], [], 0],
  );
});
