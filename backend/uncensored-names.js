import fs from "node:fs";
import path from "node:path";

import { writeJsonFile } from "./json-store.js";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { hashOf, versionsIn } from "./profile/store.js";

// Each table's key column and the JSON column holding its records.
const tables = {
  studio_documents: ["name", "value"],
  studio_gallery: ["key", "value"],
  studio_provider_jobs: ["id", "record"],
  studio_queue: ["id", "record"],
  studio_sessions: ["id", "record"],
  studio_user_presets: ["id", "record"],
};
// The fields that name a prompt style: a rewrite's preset and an animation's theme.
const styleFields = new Set(["preset", "theme"]);

/**
 * Renames, in place, each `spicy` flag within `value` to `uncensored` and each `spicy` style
 * reference to `uncensored`, returning whether it renamed any.
 */
function rename(value, conflicts, where) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.reduce((any, item) => rename(item, conflicts, where) || any, false);
  let any = false;
  for (const [key, item] of Object.entries(value)) {
    if (styleFields.has(key) && item === "spicy") {
      value[key] = "uncensored";
      any = true;
    } else any = rename(item, conflicts, where) || any;
  }
  if (!Object.hasOwn(value, "spicy")) return any;
  if (Object.hasOwn(value, "uncensored"))
    conflicts.push(`${where}: holds both spicy and uncensored.`);
  value.uncensored = value.spicy;
  delete value.spicy;
  return true;
}

/**
 * Renames, in place, the Spicy names in runtime document `name` that `rename` does not reach,
 * returning whether it renamed any.
 */
function renameDocument(name, value, conflicts) {
  if (name === "settings" && Object.hasOwn(value, "STUDIO_DREAM_OVERRIDE_SPICY")) {
    if (Object.hasOwn(value, "STUDIO_DREAM_OVERRIDE_UNCENSORED"))
      conflicts.push("studio_documents settings: holds both Dream overrides.");
    value.STUDIO_DREAM_OVERRIDE_UNCENSORED = value.STUDIO_DREAM_OVERRIDE_SPICY;
    delete value.STUDIO_DREAM_OVERRIDE_SPICY;
    return true;
  }
  // Dream merges each settings change into the saved ones, so a choice made since the rename
  // leaves both names; that `uncensored` is the newer.
  const settings = name.startsWith("dream:") && value.settings;
  if (!settings || !Object.hasOwn(settings, "spicy") || !Object.hasOwn(settings, "uncensored"))
    return false;
  delete settings.spicy;
  return true;
}

/** A prompt style list with the built-in Spicy styles named Uncensored. */
function renamedStyles(styles, conflicts, where) {
  const kinds = new Set(styles.filter((style) => style.id === "spicy").map((style) => style.kind));
  for (const style of styles)
    if (style.id === "uncensored" && kinds.has(style.kind))
      conflicts.push(`${where}: ${style.kind} has both spicy and uncensored styles.`);
  return styles.map((style) =>
    style.id === "spicy"
      ? { ...style, id: "uncensored", ...(style.label === "Spicy" ? { label: "Uncensored" } : {}) }
      : style,
  );
}

/**
 * The migrate-runtime step that renames Spicy to Uncensored in stored records: Dream settings
 * and the deployment's Dream override, Dream marks and writing, saved suggestion steps and every other `spicy` flag become `uncensored`;
 * the built-in Spicy prompt styles become `uncensored` (labelled Uncensored where still Spicy) in
 * `prompt-styles.json` and its history, as do the rewrites and animations that name them. Online:
 * each table's rows are read and written in one turn, but work the server holds in memory may be
 * saved back with the old name, so apply again until it finds nothing. A conflict applies nothing.
 * Plans by default; `apply` writes.
 */
export function uncensoredNames(dataDir, { apply = false } = {}) {
  const conflicts = [];
  const rows = {};
  const writes = [];
  if (fs.existsSync(databaseFile(dataDir))) {
    const db = runtimeDatabase(dataDir);
    const present = new Set(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const [table, [key, column]] of Object.entries(tables)) {
      if (!present.has(table)) continue;
      const changed = db
        .prepare(`SELECT ${key} AS key, ${column} AS value FROM ${table} WHERE ${column} LIKE ?`)
        .all("%spicy%")
        .flatMap((row) => {
          const value = JSON.parse(row.value);
          const document =
            table === "studio_documents" && renameDocument(row.key, value, conflicts);
          return rename(value, conflicts, `${table} ${row.key}`) || document
            ? [{ key: row.key, value: JSON.stringify(value) }]
            : [];
        });
      rows[table] = changed.length;
      writes.push({ table, key, column, changed });
    }
  }
  const styleFiles = [];
  const current = path.join(dataDir, "prompt-styles.json");
  const historyDir = path.join(dataDir, "history", "prompt-styles");
  for (const file of [
    current,
    ...versionsIn(historyDir).map((n) => path.join(historyDir, `${n}.json`)),
  ]) {
    if (!fs.existsSync(file)) continue;
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!saved.styles?.some((style) => style.id === "spicy")) continue;
    const styles = renamedStyles(saved.styles, conflicts, path.relative(dataDir, file));
    // A version records its list's hash; the current file's meta records none.
    styleFiles.push({
      file,
      value: { ...saved, styles, ...(saved.hash ? { hash: hashOf(styles) } : {}) },
      mode: file === current ? undefined : 0o600,
    });
  }
  const result = { applied: false, rows, styleFiles: styleFiles.length, conflicts };
  if (!apply || conflicts.length) return result;
  const db = writes.length ? runtimeDatabase(dataDir) : null;
  if (db) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const { table, key, column, changed } of writes) {
        const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
        for (const row of changed) update.run(row.value, row.key);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  for (const { file, value, mode } of styleFiles) writeJsonFile(file, value, { mode });
  return { ...result, applied: true };
}
