import fs from "node:fs";
import path from "node:path";

import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";

// The runtime records that hold JSON, by table and column.
const records = [
  ["studio_documents", "value"],
  ["studio_gallery", "value"],
  ["studio_library_imports", "value"],
  ["studio_mcp_links", "value"],
  ["studio_mcp_offers", "value"],
  ["studio_mcp_prompts", "value"],
  ["studio_mcp_sets", "value"],
  ["studio_provider_jobs", "record"],
  ["studio_queue", "record"],
  ["studio_user_presets", "record"],
];

/**
 * `custom:<old id>` → `{to, backend}` from the alias file: the profile each old id became,
 * following later merges, and the backend a combined profile's per-backend id ran on.
 */
function renamesOf(aliases) {
  const renames = new Map();
  for (const from of Object.keys(aliases)) {
    let id = from;
    let backend = "";
    for (const seen = new Set([id]); typeof aliases[id]?.to === "string"; seen.add(id)) {
      backend ||= typeof aliases[id].backend === "string" ? aliases[id].backend : "";
      if (seen.has(aliases[id].to)) break;
      id = aliases[id].to;
    }
    if (id !== from) renames.set(`custom:${from}`, { to: `custom:${id}`, backend });
  }
  return renames;
}

/** `value` with every renamed id, as a string or a key, replaced; the same value when none is. */
function repoint(value, renames) {
  if (typeof value === "string") return renames.get(value)?.to ?? value;
  if (Array.isArray(value)) {
    const next = value.map((item) => repoint(item, renames));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const to = renames.get(key)?.to ?? key;
    const repointed = repoint(item, renames);
    if (to !== key || repointed !== item) changed = true;
    // The current id's own entry wins over an old id's.
    if (to !== key && Object.hasOwn(value, to)) continue;
    next[to] = repointed;
  }
  // A run on a combined profile's per-backend id runs on that backend again.
  const backend = renames.get(value.profileId)?.backend;
  if (backend && value.profileBackend === undefined) {
    next.profileBackend = backend;
    changed = true;
  }
  return changed ? next : value;
}

/**
 * The migration that retires profile aliases (`workflows/.studio-aliases.json`, written by Merge
 * Duplicate Profiles, Combine Backends and retiring a profile into another): every runtime record
 * naming an old id names the profile it became, and a run on a combined profile's per-backend id
 * records that backend as `profileBackend`. It runs online: the server's copies of these records
 * are reloaded where it can (runtime-migrations.js) and otherwise dropped by a restart, which can
 * write a stale copy back first, so the alias file stays until an applied run finds nothing left to
 * rewrite. Plans by default; `apply` writes.
 */
export function profileAliases(dataDir, { apply = false } = {}) {
  const file = path.join(dataDir, "workflows", ".studio-aliases.json");
  const aliases = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const renames = renamesOf(aliases);
  const changed = [];
  if (renames.size && fs.existsSync(databaseFile(dataDir))) {
    const db = runtimeDatabase(dataDir);
    for (const [table, column] of records) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table);
      if (!exists) continue;
      const rows = db
        .prepare(`SELECT rowid, ${column} AS value FROM ${table} WHERE instr(${column}, 'custom:')`)
        .all();
      for (const row of rows) {
        const value = JSON.parse(row.value);
        const next = repoint(value, renames);
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
  if (apply && !changed.length && fs.existsSync(file)) fs.rmSync(file);
  return {
    applied: apply,
    aliases: Object.keys(aliases).length,
    records: changed.length,
    renames: Object.fromEntries([...renames].map(([from, { to }]) => [from, to])),
  };
}
