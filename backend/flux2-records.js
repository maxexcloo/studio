import fs from "node:fs";
import path from "node:path";

import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { records } from "./profile-aliases.js";

const kv = "custom:image-flux2-klein-9b-kv-fast";
const base = "custom:image-flux2-klein-9b-base-quality";
// The FLUX.2 [klein] 9B model files, by the profile that ran them.
const flux2Files = new Map([
  ["flux-2-klein-9b-kv-fp8.safetensors", kv],
  ["flux-2-klein-base-9b-fp8.safetensors", base],
]);
// FLUX.2 [klein] 9B's text encoder; FLUX.3 [klein] runs Qwen3-VL 4B.
const flux2Encoder = "qwen_3_8b_fp8mixed.safetensors";
const flux3 = new Set([
  "custom:image-flux3-klein-base-quality",
  "custom:image-flux3-klein-distilled-fast",
]);
// The fields that name a model file: a gallery item or job input, its settings, a graph's loader.
const fileFields = new Set(["baseModel", "model", "modelName", "unet", "unet_name"]);
// In the order they decide: the first a record holds settles it.
const rules = ["modelFile", "profileName", "textEncoder"];

/** The FLUX.2 encoder's run: the 4-step KV profile takes no more than 8 steps and no CFG. */
const encoderProfile = (settings) =>
  Number(settings.steps) > 0
    ? Number(settings.steps) <= 8
      ? kv
      : base
    : settings.cfg === undefined
      ? kv
      : base;

/** Per rule, the FLUX.2 profiles `value` records anywhere within it, `other` for anything else. */
function evidenceIn(value, found = Object.fromEntries(rules.map((rule) => [rule, new Set()]))) {
  if (Array.isArray(value)) for (const item of value) evidenceIn(item, found);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" || !item) evidenceIn(item, found);
      else if (fileFields.has(key) && !item.startsWith("custom:"))
        found.modelFile.add(flux2Files.get(path.basename(item)) ?? "other");
      else if (key === "profileName")
        found.profileName.add(
          !item.startsWith("FLUX.2")
            ? "other"
            : /\b(KV|Fast)\b/.test(item)
              ? kv
              : /\b(Base|Quality)\b/.test(item)
                ? base
                : "other",
        );
      else if (key === "textEncoder")
        found.textEncoder.add(
          path.basename(item) === flux2Encoder ? encoderProfile(value) : "other",
        );
    }
  return found;
}

/**
 * `value` with each FLUX.3 id set back to the FLUX.2 profile its nearest object records under the
 * first rule it holds; the same value when none is. `tally` notes the rule that rewrote and whether
 * a FLUX.3 id was left in an object recording nothing.
 */
function repoint(value, tally, found) {
  const resolve = (id) => {
    if (!flux3.has(id)) return id;
    const rule = rules.find((each) => found[each].size);
    if (!rule) tally.unresolved = true;
    const ids = found[rule] ?? new Set();
    if (ids.size !== 1 || ids.has("other")) return id;
    tally.rule ||= rule;
    return [...ids][0];
  };
  if (typeof value === "string") return resolve(value);
  if (Array.isArray(value)) {
    const next = value.map((item) => repoint(item, tally, found));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  found = evidenceIn(value);
  let changed = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const to = resolve(key);
    const repointed = repoint(item, tally, found);
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
 * a FLUX.2 model file, a FLUX.2 profile name or FLUX.2's text encoder names the matching FLUX.2
 * profile again, counted by that rule. Records holding none of these keep their id and count as
 * `unresolved`. Online like profileAliases: a restart drops the server's
 * other copies and may write a stale one back, so apply again until `records` is 0. Plans by
 * default; `apply` writes.
 */
export function flux2Records(dataDir, { apply = false } = {}) {
  const changed = [];
  const counts = { ...Object.fromEntries(rules.map((rule) => [rule, 0])), unresolved: 0 };
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
        const tally = { rule: "", unresolved: false };
        const next = repoint(value, tally, evidenceIn(null));
        if (tally.unresolved) counts.unresolved++;
        if (next === value) continue;
        counts[tally.rule]++;
        changed.push({ table, column, rowid: row.rowid, value: next });
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
  return { applied: apply, records: changed.length, ...counts };
}
