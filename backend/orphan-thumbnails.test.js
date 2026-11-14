import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { orphanThumbnails } from "./orphan-thumbnails.js";

test("orphanThumbnails deletes the thumbnails no gallery item shows", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-orphan-thumbnails-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const gallery = { items: () => [{ id: "kept" }], thumbnailKeys: (item) => [`${item.id}key`] };
  assert.equal(orphanThumbnails(dataDir, { gallery }).files, 0);
  assert.ok(orphanThumbnails(dataDir).skipped, "needs the running gallery");

  const dir = path.join(dataDir, ".thumbnails");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "keptkey-a.webp"), "kept");
  fs.writeFileSync(path.join(dir, "gonekey-b.webp"), "gone");
  const plan = orphanThumbnails(dataDir, { gallery });
  assert.deepEqual([plan.applied, plan.files, plan.bytes, plan.kept], [false, 1, 4, 1]);
  assert.equal(fs.readdirSync(dir).length, 2, "a dry run deletes nothing");

  assert.equal(orphanThumbnails(dataDir, { gallery, apply: true }).applied, true);
  assert.deepEqual(fs.readdirSync(dir), ["keptkey-a.webp"]);
  assert.equal(orphanThumbnails(dataDir, { gallery }).files, 0);
});
