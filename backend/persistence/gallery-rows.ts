import type { DatabaseSync } from "node:sqlite";

/**
 * Gallery records as one `studio_gallery` row each, keyed by `galleryKey`, with indexed columns
 * derived from each row so the gallery is queried in SQL (gallery/store.js).
 */
type GalleryItem = { url?: unknown; id?: unknown; outputName?: unknown; filename?: unknown };

export function galleryKey(item: GalleryItem | null | undefined): string {
  return String(item?.url || item?.id || item?.outputName || item?.filename || "");
}

const field = (name: string) => `json_extract(value, '$.${name}')`;

/**
 * Columns derived from each row's JSON, so queries filter and order the gallery in SQL. `created_ms`
 * is Date.parse's time (null when unreadable) and `bucket` is order.js's galleryBucket: JS `trim`
 * strips every whitespace character, so the SQL one names them.
 */
export const galleryColumns: [string, string][] = [
  ["item_id", field("id")],
  ["owner_id", `coalesce(${field("ownerId")}, '')`],
  ["job_id", field("jobId")],
  ["item_index", `coalesce(${field("index")}, 0)`],
  ["type", field("type")],
  ["status", field("status")],
  ["upscale_status", field("upscale.status")],
  ["uploaded", `CASE WHEN ${field("uploaded")} THEN 1 ELSE 0 END`],
  ["favorite", `CASE WHEN ${field("favorite")} THEN 1 ELSE 0 END`],
  [
    "dream_pool",
    `CASE WHEN json_type(value, '$.dream') = 'object' AND ${field("dream.state")} IS NOT 'kept' THEN 1 ELSE 0 END`,
  ],
  ["set_id", field("resultSet.id")],
  ["created_ms", `CAST(round(unixepoch(${field("createdAt")}, 'subsec') * 1000) AS INTEGER)`],
  [
    "bucket",
    `CASE WHEN ${field("status")} IS 'done' AND ${field("civitai.imageId")} IS NULL AND trim(coalesce(${field("prompt")}, ''), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 1 ELSE 0 END`,
  ],
];

// The gallery's order, then the columns pages filter on, so a page's count reads only the index.
const galleryOrder =
  "uploaded, dream_pool, bucket, created_ms DESC, job_id DESC, item_index, item_id DESC, status, type, favorite";

/** The indexes over `galleryColumns`: gallery order with and without an owner, jobs, ids, sets and
 * states. */
export const galleryIndexes: [string, string][] = [
  ["studio_gallery_order", galleryOrder],
  ["studio_gallery_owner_order", `owner_id, ${galleryOrder}`],
  ["studio_gallery_job", "job_id"],
  ["studio_gallery_item", "item_id"],
  ["studio_gallery_set", "set_id"],
  ["studio_gallery_status", "status"],
  ["studio_gallery_upscale", "upscale_status"],
];

/** The gallery table with its columns and indexes, for a database that has none yet. */
export const createGalleryTable = [
  `CREATE TABLE studio_gallery (key TEXT PRIMARY KEY, value TEXT NOT NULL, ${galleryColumns
    .map(([name, expression]) => `${name} GENERATED ALWAYS AS (${expression}) VIRTUAL`)
    .join(", ")})`,
  ...galleryIndexes.map(([name, keys]) => `CREATE INDEX ${name} ON studio_gallery (${keys})`),
].join(";\n");

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
