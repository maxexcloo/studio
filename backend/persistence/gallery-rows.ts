import type { DatabaseSync } from "node:sqlite";

/**
 * Gallery records as one `studio_gallery` row each, keyed by `galleryKey`, so a save writes only
 * the items that changed. The `gallery-rows-v1` step of migrate-runtime creates the table and moves
 * the `gallery` document into it; until then the document stays authoritative.
 */
export const galleryRowsMigration = "gallery-rows-v1";

type GalleryItem = { url?: unknown; id?: unknown; outputName?: unknown; filename?: unknown };

export function galleryKey(item: GalleryItem | null | undefined): string {
  return String(item?.url || item?.id || item?.outputName || item?.filename || "");
}

export const createGalleryTable =
  "CREATE TABLE studio_gallery (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

export function readGalleryRows(db: DatabaseSync): unknown[] {
  return (db.prepare("SELECT value FROM studio_gallery").all() as { value: string }[]).map((row) =>
    JSON.parse(row.value),
  );
}

/** Upserts `items` and deletes the `removed` keys in one transaction. */
export function writeGalleryRows(db: DatabaseSync, items: GalleryItem[], removed: string[] = []) {
  const upsert = db.prepare(
    "INSERT INTO studio_gallery (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const remove = db.prepare("DELETE FROM studio_gallery WHERE key = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) upsert.run(galleryKey(item), JSON.stringify(item));
    for (const key of removed) remove.run(key);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
