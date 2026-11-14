import fs from "node:fs";
import { galleryColumns, galleryIndexes } from "./persistence/gallery-rows.ts";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that adds the gallery's derived columns and their indexes
 * (persistence/gallery-rows.ts) to `studio_gallery`: virtual columns, as ALTER TABLE cannot add
 * stored ones; the indexes hold their values. It also gives images saved before thumbnails existed
 * their thumbnail address, which the gallery otherwise added each time it loaded. Safe while Studio
 * runs, as the running gallery added those addresses itself and writes only items it changes; a
 * second run finds nothing.
 */
const thumbnailless = `FROM studio_gallery WHERE json_extract(value, '$.type') = 'image'
  AND coalesce(json_extract(value, '$.thumbnailUrl'), '') = ''
  AND json_extract(value, '$.url') LIKE '/comfy/view?%'`;

export function galleryColumnsStep(dataDir, { apply = false } = {}) {
  const result = { applied: false, columns: [], indexes: [], thumbnails: 0 };
  if (!fs.existsSync(databaseFile(dataDir))) return result;
  const db = runtimeDatabase(dataDir);
  const have = new Set(
    db
      .prepare("PRAGMA table_xinfo(studio_gallery)")
      .all()
      .map((column) => column.name),
  );
  const indexed = new Set(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'studio_gallery'",
      )
      .all()
      .map((index) => index.name),
  );
  const columns = galleryColumns.filter(([name]) => !have.has(name));
  const indexes = galleryIndexes.filter(([name]) => !indexed.has(name));
  result.columns = columns.map(([name]) => name);
  result.indexes = indexes.map(([name]) => name);
  result.thumbnails = db.prepare(`SELECT count(*) AS count ${thumbnailless}`).get().count;
  if (!apply || !(columns.length || indexes.length || result.thumbnails)) return result;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [name, expression] of columns)
      db.exec(
        `ALTER TABLE studio_gallery ADD COLUMN ${name} GENERATED ALWAYS AS (${expression}) VIRTUAL`,
      );
    for (const [name, keys] of indexes) db.exec(`CREATE INDEX ${name} ON studio_gallery (${keys})`);
    db.exec(`UPDATE studio_gallery SET value = json_set(value, '$.thumbnailUrl',
      '/comfy/thumb?' || substr(json_extract(value, '$.url'), 13)) WHERE key IN (SELECT key ${thumbnailless})`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  result.applied = true;
  return result;
}
