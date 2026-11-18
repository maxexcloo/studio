import fs from "node:fs";
import path from "node:path";

import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { records } from "./profile-aliases.js";

// The FLUX.2 [klein] 9B model files, by the profile that ran them.
const flux2 = new Map([
  ["flux-2-klein-9b-kv-fp8.safetensors", "custom:image-flux2-klein-9b-kv-fast"],
  ["flux-2-klein-base-9b-fp8.safetensors", "custom:image-flux2-klein-9b-base-quality"],
]);
const flux3 = new Set([
  "custom:image-flux3-klein-base-quality",
  "custom:image-flux3-klein-distilled-fast",
]);
// The fields that name a model file: a gallery item or job input, its settings, a graph's loader.
const fileFields = new Set(["baseModel", "model", "modelName", "unet", "unet_name"]);

/** The model files recorded anywhere within `value`. */
function filesIn(value, files = new Set()) {
  if (Array.isArray(value)) for (const item of value) filesIn(item, files);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (fileFields.has(key) && typeof item === "string" && item && !item.startsWith("custom:"))
        files.add(path.basename(item));
      else filesIn(item, files);
    }
  return files;
}

/**
 * `value` with each FLUX.3 id set back to the FLUX.2 id of the one FLUX.2 file its nearest object
 * records; the same value when none is. `unresolved` counts the FLUX.3 ids left with no file.
 */
function repoint(value, tally, files) {
  const resolve = (id) => {
    if (!flux3.has(id)) return id;
    if (!files.size) tally.unresolved++;
    const ids = new Set([...files].map((file) => flux2.get(file)));
    return ids.size === 1 && !ids.has(undefined) ? [...ids][0] : id;
  };
  if (typeof value === "string") return resolve(value);
  if (Array.isArray(value)) {
    const next = value.map((item) => repoint(item, tally, files));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  files = filesIn(value);
  let changed = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const to = resolve(key);
    const repointed = repoint(item, tally, files);
    if (to !== key || repointed !== item) changed = true;
    // The FLUX.2 id's own entry wins over a FLUX.3 one's.
    if (to !== key && Object.hasOwn(value, to)) continue;
    next[to] = repointed;
  }
  return changed ? next : value;
}

/**
 * The migration that gives FLUX.2 [klein] 9B runs back their own profiles: profileAliases moved
 * the old FLUX.2 ids onto FLUX.3 [klein], so every runtime record naming a FLUX.3 id but recording
 * a FLUX.2 model file names the matching FLUX.2 profile again. Records with no model file keep
 * their id and count as `unresolved`. Online like profileAliases: a restart drops the server's
 * other copies and may write a stale one back, so apply again until `records` is 0. Plans by
 * default; `apply` writes.
 */
export function flux2Records(dataDir, { apply = false } = {}) {
  const changed = [];
  let unresolved = 0;
  if (fs.existsSync(databaseFile(dataDir))) {
    const db = runtimeDatabase(dataDir);
    for (const [table, column] of records) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table);
      if (!exists) continue;
      const rows = db
        .prepare(
          `SELECT rowid, ${column} AS value FROM ${table} WHERE instr(${column}, 'custom:image-flux3-klein-')`,
        )
        .all();
      for (const row of rows) {
        const value = JSON.parse(row.value);
        const tally = { unresolved: 0 };
        const next = repoint(value, tally, new Set());
        if (tally.unresolved) unresolved++;
        if (next !== value) changed.push({ table, column, rowid: row.rowid, value: next });
      }
    }
    if (apply && changed.length) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { table, column, rowid, value } of changed)
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).run(
            JSON.stringify(value),
            rowid,
          );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  return { applied: apply, records: changed.length, unresolved };
}
