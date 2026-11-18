import fs from "node:fs";
import path from "node:path";

import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";

// The runtime records that hold JSON, by table and column.
export const records = [
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
 * `custom:<id>-<backend>` → `{to, backend}` for each backend of a combined profile in `workflows`
 * whose per-backend profile is gone, for records no alias repoints.
 * FLUX.2 [klein] ids stay: those return as their own profiles.
 */
function combinedRenames(ids) {
  const renames = new Map();
  for (const [id, backends] of ids)
    for (const backend of backends)
      if (!ids.has(`${id}-${backend}`) && !id.includes("flux2-klein"))
        renames.set(`custom:${id}-${backend}`, { to: `custom:${id}`, backend });
  return renames;
}

/** Each profile in `workflows` by id, with its backends when it is combined. */
function profileBackends(dir) {
  const ids = new Map();
  if (!fs.existsSync(dir)) return ids;
  for (const name of fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    ids.set(raw?.studio?.id || name.slice(0, -5), Object.keys(raw?.studio?.backends || {}));
  }
  return ids;
}

// Rows read and rewritten per event loop turn, so a run never holds the server up for long.
const batchSize = 200;

/**
 * The migration that retires profile aliases (`workflows/.studio-aliases.json`, written by Merge
 * Duplicate Profiles, Combine Backends and retiring a profile into another) and the per-backend ids
 * of combined profiles: every runtime record naming an old id names the profile it became, and a
 * run on a combined profile's per-backend id records that backend as `profileBackend`. It runs
 * online, a batch at a time with each batch read and written in one turn: the server's copies of
 * these records are reloaded where it can (runtime-migrations.js) and otherwise dropped by a
 * restart, which can write a stale copy back first, so the alias file stays until an applied run
 * finds nothing left to rewrite. `unmatched` counts gallery runs whose profile is gone and has no
 * rename. Plans by default; `apply` writes.
 */
export async function profileAliases(dataDir, { apply = false } = {}) {
  const dir = path.join(dataDir, "workflows");
  const file = path.join(dir, ".studio-aliases.json");
  const aliases = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const profiles = profileBackends(dir);
  const renames = new Map([...combinedRenames(profiles), ...renamesOf(aliases)]);
  let rewritten = 0;
  const unmatched = {};
  if (fs.existsSync(databaseFile(dataDir))) {
    const db = runtimeDatabase(dataDir);
    for (const [table, column] of records) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table);
      if (!exists) continue;
      const read = db.prepare(
        `SELECT rowid, ${column} AS value FROM ${table}
         WHERE rowid > ? AND instr(${column}, 'custom:') ORDER BY rowid LIMIT ${batchSize}`,
      );
      const write = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
      for (let after = 0; ;) {
        const rows = read.all(after);
        const changed = [];
        for (const row of rows) {
          const value = JSON.parse(row.value);
          const next = repoint(value, renames);
          if (next !== value) changed.push([JSON.stringify(next), row.rowid]);
          const id = next?.settings?.profileId;
          if (table === "studio_gallery" && id?.startsWith("custom:") && !profiles.has(id.slice(7)))
            unmatched[id] = (unmatched[id] || 0) + 1;
        }
        rewritten += changed.length;
        if (apply && changed.length) {
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const change of changed) write.run(...change);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        }
        if (rows.length < batchSize) break;
        after = rows.at(-1).rowid;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }
  if (apply && !rewritten && fs.existsSync(file)) fs.rmSync(file);
  return {
    applied: apply,
    aliases: Object.keys(aliases).length,
    records: rewritten,
    renames: Object.fromEntries([...renames].map(([from, { to }]) => [from, to])),
    unmatched,
  };
}
