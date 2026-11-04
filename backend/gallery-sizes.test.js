import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { gallerySizes } from "./gallery-sizes.js";
import {
  createGalleryTable,
  readGalleryRows,
  writeGalleryRows,
} from "./persistence/gallery-rows.ts";
import { restoreRuntimeBackup } from "./persistence/migration.ts";
import { openDatabase } from "./persistence/runtime.ts";

test("gallery images take their file's size after a dry run, with a restorable backup, once", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-sizes-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "media", "studio"), { recursive: true });
  const png = (name, width, height) =>
    sharp({ create: { width, height, channels: 3, background: "#000" } })
      .png()
      .toFile(path.join(dataDir, "media", "studio", name));
  await png("square.png", 1000, 1000);
  await png("right.png", 1368, 768);
  const item = (name, width, height) => ({
    id: `/comfy/view?filename=${name}&subfolder=studio&type=media`,
    url: `/comfy/view?filename=${name}&subfolder=studio&type=media`,
    type: "image",
    status: "done",
    width,
    height,
  });
  const db = openDatabase(path.join(dataDir, "studio.sqlite"));
  db.exec(createGalleryTable);
  // The asked-for size on a square file, a right one, and one whose file is gone.
  writeGalleryRows(db, [
    item("square.png", 1368, 768),
    item("right.png", 1368, 768),
    item("gone.png", 1024, 1024),
  ]);
  db.close();

  const plan = gallerySizes(dataDir);
  assert.deepEqual(
    { ...plan, examples: plan.examples.map(({ from, to }) => [from, to]) },
    { corrected: 1, examples: [["1368×768", "1000×1000"]], unread: 1, applied: false, backup: "" },
  );

  const result = gallerySizes(dataDir, { apply: true });
  const sizes = () => {
    const after = openDatabase(path.join(dataDir, "studio.sqlite"));
    const rows = readGalleryRows(after).map((row) => [
      new URLSearchParams(row.url.split("?")[1]).get("filename"),
      row.width,
      row.height,
    ]);
    after.close();
    return rows.sort();
  };
  assert.deepEqual(sizes(), [
    ["gone.png", 1024, 1024],
    ["right.png", 1368, 768],
    ["square.png", 1000, 1000],
  ]);
  const restored = path.join(dataDir, "restored");
  restoreRuntimeBackup(result.backup, restored);
  const [row] = JSON.parse(fs.readFileSync(path.join(restored, "studio_gallery.json"), "utf8"));
  assert.equal(JSON.parse(row.value).width, 1368);
  assert.equal(gallerySizes(dataDir).corrected, 0);
});
