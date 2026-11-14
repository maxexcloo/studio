import fs from "node:fs";
import path from "node:path";

/**
 * The migrate-runtime step that deletes cached thumbnails no gallery item (Dream's pool included)
 * shows any more: those of deleted items and of older rendition settings. The cache rebuilds any
 * thumbnail on its next request, so the step is safe while Studio runs. It needs the running
 * server's gallery, so it runs only through POST /api/maintenance/migrations. A second run finds
 * nothing.
 */
export const orphanThumbnailsNote =
  "Deletes these cached thumbnails; Studio remakes any on request.";
const offline =
  "Reads the running gallery, so it runs only in Studio: POST /api/maintenance/migrations.";

/** `gallery`: `{ items(), thumbnailKeys(item) }`, the server's gallery and its thumbnails' keys. */
export function orphanThumbnails(dataDir, { apply = false, gallery } = {}) {
  const result = { applied: false, note: orphanThumbnailsNote, files: 0, bytes: 0, kept: 0 };
  if (!gallery) return { ...result, skipped: offline };
  const dir = path.join(dataDir, ".thumbnails");
  const shown = new Set(gallery.items().flatMap((item) => gallery.thumbnailKeys(item)));
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  const orphans = [];
  for (const name of names) {
    if (shown.has(name.slice(0, name.indexOf("-")))) result.kept += 1;
    else {
      orphans.push(name);
      result.bytes += fs.statSync(path.join(dir, name)).size;
    }
  }
  result.files = orphans.length;
  if (!apply || !orphans.length) return result;
  for (const name of orphans) fs.rmSync(path.join(dir, name), { force: true });
  result.applied = true;
  return result;
}
