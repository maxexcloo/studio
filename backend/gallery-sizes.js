import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mediaParams, mediaRootFor } from "./media-paths.js";
import { isInside } from "./paths.js";
import { outputFileSize } from "./gallery/store.js";
import { verifiedBackup } from "./persistence/migration.ts";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that gives each finished gallery image the size of its file. Images
 * saved before Studio read that size kept the one asked for, which an edit drawing at its
 * reference's size does not match, so their tiles cropped them. It reads each image's size with sharp, whatever its format;
 * videos were already measured from their files. Plans by default, reporting the `corrected`
 * count, a few `examples` and the images it could not read (`unread`: missing or not an image);
 * `apply` copies the changed rows to a `.backups/gallery-sizes-*` folder with a `mapping.json`
 * and then writes them. Online-safe: the running server then takes the written sizes into its
 * gallery (runtime-migrations.js). A second run finds nothing to change.
 */
export async function gallerySizes(dataDir, { apply = false } = {}) {
  const empty = { corrected: 0, examples: [], unread: 0, applied: false, backup: "" };
  if (!fs.existsSync(databaseFile(dataDir))) return empty;
  const db = runtimeDatabase(dataDir);
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_gallery'")
    .get();
  if (!table) return empty;
  const root = mediaRootFor(dataDir);
  const rows = db.prepare("SELECT key, value FROM studio_gallery").all();
  const changed = [];
  let unread = 0;
  for (const row of rows) {
    const item = JSON.parse(row.value);
    const params = item.status === "done" && item.type === "image" && mediaParams(item.url);
    if (!params) continue;
    const file = path.resolve(root, params.subfolder, params.filename);
    const info = isInside(root, file) ? await outputFileSize(file, "image") : null;
    if (!info?.width || !info.height) {
      unread += 1;
      continue;
    }
    if (info.width === Number(item.width) && info.height === Number(item.height)) continue;
    changed.push({ row, item, width: info.width, height: info.height });
  }
  const plan = {
    corrected: changed.length,
    examples: changed.slice(0, 5).map(({ row, item, width, height }) => ({
      key: row.key,
      from: `${item.width || 0}×${item.height || 0}`,
      to: `${width}×${height}`,
    })),
    unread,
  };
  if (!apply || !changed.length) return { ...plan, applied: false, backup: "" };

  const bytes = Buffer.from(JSON.stringify(changed.map(({ row }) => row)));
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const backup = verifiedBackup(
    dataDir,
    "gallery-sizes",
    [{ source: "studio_gallery.json", hash, bytes }],
    { mappings: [{ source: "studio_gallery.json", hash }], ...plan },
  );
  const update = db.prepare("UPDATE studio_gallery SET value = ? WHERE key = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { row, item, width, height } of changed)
      update.run(JSON.stringify({ ...item, width, height }), row.key);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}
