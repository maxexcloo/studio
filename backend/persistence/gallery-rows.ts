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
 * A row's Dream state (null outside Dream), arm and comparison side: the `studio_gallery_dream`
 * index's expressions.
 */
export const dreamState = field("dream.state");
export const dreamArm = field("dream.arm");
export const dreamPair = field("dream.pair");

/**
 * Columns derived from each row's JSON, so queries filter and order the gallery in SQL. `created_ms`
 * is Date.parse's time (null when unreadable) and `bucket` is order.js's galleryBucket: JS `trim`
 * strips every whitespace character, so the SQL one names them.
 */
const galleryColumns: [string, string][] = [
  ["item_id", field("id")],
  ["owner_id", `coalesce(${field("ownerId")}, '')`],
  ["job_id", field("jobId")],
  ["item_index", `coalesce(${field("index")}, 0)`],
  ["type", field("type")],
  ["status", field("status")],
  ["upscale_status", field("upscale.status")],
  ["uploaded", `CASE WHEN ${field("uploaded")} THEN 1 ELSE 0 END`],
  ["rating", field("rating")],
  [
    "unlisted",
    `CASE WHEN ${field("rating")} IS 'disliked' OR (json_type(value, '$.dream') = 'object' AND ${field("dream.state")} IS NOT 'kept') THEN 1 ELSE 0 END`,
  ],
  ["set_id", field("resultSet.id")],
  ["created_ms", `CAST(round(unixepoch(${field("createdAt")}, 'subsec') * 1000) AS INTEGER)`],
  [
    "bucket",
    `CASE WHEN ${field("status")} IS 'done' AND ${field("civitai.imageId")} IS NULL AND trim(coalesce(${field("prompt")}, ''), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 1 ELSE 0 END`,
  ],
];

/**
 * What the account summaries (the filter menu and LoRA previews) read of each row, as named
 * columns: the `studio_gallery_summary` index holds them, so a summary reads no records.
 */
export const summaryFields = {
  createdAt: field("createdAt"),
  loras: "value -> '$.settings.loras'",
  model: field("model"),
  modelName: field("settings.modelName"),
  tags: "value -> '$.caption.tags'",
  thumbnailUrl: field("thumbnailUrl"),
};

// The gallery's order, then the columns pages filter on, so a page's count reads only the index.
const galleryOrder =
  "uploaded, unlisted, bucket, created_ms DESC, job_id DESC, item_index, item_id DESC, status, type, rating";

/** The indexes over `galleryColumns`: gallery order with and without an owner, jobs, ids, sets,
 * states, Dream states (with arms and comparison sides, so Dream's counts read the index alone),
 * an owner's prompts (a repeated prompt's title), times (recent work) and runs (profile health,
 * read from the index alone). */
const galleryIndexes: [string, string][] = [
  ["studio_gallery_order", galleryOrder],
  ["studio_gallery_owner_order", `owner_id, ${galleryOrder}`],
  ["studio_gallery_job", "job_id"],
  ["studio_gallery_item", "item_id"],
  ["studio_gallery_set", "set_id"],
  ["studio_gallery_status", "status"],
  ["studio_gallery_upscale", "upscale_status"],
  ["studio_gallery_dream", `${dreamState}, owner_id, ${dreamArm}, ${dreamPair}`],
  ["studio_gallery_prompt", "owner_id, json_extract(value, '$.prompt')"],
  ["studio_gallery_created", "created_ms"],
  [
    "studio_gallery_runs",
    "created_ms, key, unlisted, status, rating, json_extract(value, '$.settings.profileId'), json_extract(value, '$.timing.runMs')",
  ],
  [
    "studio_gallery_summary",
    `owner_id, unlisted, type, status, key, ${Object.values(summaryFields).join(", ")}`,
  ],
];

/**
 * Creates the gallery table where missing and brings its derived columns and indexes in line with
 * `galleryColumns` and `galleryIndexes`. They hold only what each row's JSON gives, so adding,
 * replacing or dropping them changes no data.
 */
export function syncGallerySchema(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS studio_gallery (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const columns = new Set(
    (db.prepare("PRAGMA table_xinfo(studio_gallery)").all() as { name: string; hidden: number }[])
      .filter((column) => column.hidden >= 2)
      .map((column) => column.name),
  );
  const indexes = new Map(
    (
      db
        .prepare(
          "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'studio_gallery' AND sql IS NOT NULL",
        )
        .all() as { name: string; sql: string }[]
    ).map((index) => [index.name, index.sql]),
  );
  const wanted = new Map(
    galleryIndexes.map(([name, keys]) => [
      name,
      `CREATE INDEX ${name} ON studio_gallery (${keys})`,
    ]),
  );
  const staleIndexes = [...indexes].filter(([name, sql]) => wanted.get(name) !== sql);
  const staleColumns = [...columns].filter(
    (name) => !galleryColumns.some(([want]) => want === name),
  );
  const newColumns = galleryColumns.filter(([name]) => !columns.has(name));
  const newIndexes = [...wanted].filter(([name, sql]) => indexes.get(name) !== sql);
  if (!staleIndexes.length && !staleColumns.length && !newColumns.length && !newIndexes.length)
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [name] of staleIndexes) db.exec(`DROP INDEX ${name}`);
    for (const name of staleColumns) db.exec(`ALTER TABLE studio_gallery DROP COLUMN ${name}`);
    for (const [name, expression] of newColumns)
      db.exec(
        `ALTER TABLE studio_gallery ADD COLUMN ${name} GENERATED ALWAYS AS (${expression}) VIRTUAL`,
      );
    for (const [, sql] of newIndexes) db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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
