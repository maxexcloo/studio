import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hasMigration, runtimeDatabase, withOfflineDatabase } from "./runtime.ts";

/**
 * Production's profile id renames of 20 and 24 Oct 2026 replaced profile files without rewriting
 * everything that named them, so older gallery records, preferences, LoRA stacks and access grants
 * still name ids that no longer exist. This one-off step rewrites each `custom:<old id>` to the id
 * the profile has now, with Studio stopped. Ids of removed profiles (Boogu, Chroma, MOSS Base,
 * H3 Singularity and other retired variants) have no successor and stay as they are.
 */
// The 24 Oct rename (production's backups/profile-id-rename-2026-10-24…, ai b0278b8).
const renamed24: Record<string, string> = {
  "grok-image-2.0": "image-grok-imagine-2.0-cloud",
  "grok-image-standard": "image-grok-imagine-cloud",
  "grok-video": "video-grok-imagine-1.5-cloud",
  "grok-video-standard": "video-grok-imagine-cloud",
  "h3-fl-pdd8": "video-h3-first-frame-fast-comfyui",
  "h3-fl-stock20": "video-h3-first-frame-quality-comfyui",
  "h3-radiance-fast8": "video-fasth3-v2-fast-radiance",
  "h3-radiance-stock50": "video-h3-quality-radiance",
  "h3-ref-pdd8": "video-h3-reference-fast-comfyui",
  "h3-ref-stock20": "video-h3-reference-quality-comfyui",
  "image-fibo2-dev-int8-convrot": "image-fibo2-generate-dev-comfyui",
  "image-fibo2-edit-turbo-int8-convrot": "image-fibo2-edit-turbo-comfyui",
  "image-fineporn-rays-fp8-fast": "image-fineporn-rays-fast-comfyui",
  "image-fineporn-rays-fp8-quality": "image-fineporn-rays-quality-comfyui",
  "image-fineporn-v5-int8-fast": "image-fineporn-v5-fast-comfyui",
  "image-fineporn-v5-int8-quality": "image-fineporn-v5-quality-comfyui",
  "image-flux2-klein-9b-base-fp8": "image-flux2-klein-9b-base-comfyui",
  "image-flux2-klein-9b-kv-fp8": "image-flux2-klein-9b-kv-comfyui",
  "image-flux3-klein-base-int8": "image-flux3-klein-base-comfyui",
  "image-flux3-klein-distilled-int8": "image-flux3-klein-distilled-comfyui",
  "image-ideogram4-int8-convrot": "image-ideogram4-comfyui",
  "image-krea2-turbo-int8-convrot": "image-krea2-turbo-comfyui",
  "image-kroma-turbo-w8a8-fast": "image-kroma-turbo-fast-comfyui",
  "image-kroma-turbo-w8a8-quality": "image-kroma-turbo-quality-comfyui",
  "image-kromafine-turbo-int8-fast": "image-kromafine-turbo-fast-comfyui",
  "image-kromafine-turbo-int8-quality": "image-kromafine-turbo-quality-comfyui",
  "image-moss-sft": "image-moss-sft-comfyui",
  "image-qwen-image-2-1-int8-convrot": "image-qwen-image-2.1-comfyui",
  "image-qwen-image-2-1-turbo-int8-convrot": "image-qwen-image-2.1-turbo-comfyui",
  "image-radiance-flux3-klein": "image-flux3-klein-distilled-radiance",
  "image-radiance-flux3-klein-base": "image-flux3-klein-base-radiance",
  "image-radiance-krea2-turbo": "image-krea2-turbo-radiance",
  "image-radiance-noctq-v4": "image-noctq-v4-radiance",
  "image-radiance-qwen-image-2-1": "image-qwen-image-2.1-radiance",
  "image-radiance-qwen-image-2-1-turbo-uncensored":
    "image-qwen-image-2.1-turbo-uncensored-radiance",
  "image-z-image-turbo-int8-convrot": "image-z-image-turbo-comfyui",
};
// The 20 Oct rename (backups/profile-id-rename-2026-10-20…) to the ids the 24 Oct rename renamed
// again; each pair loads the same model files.
const renamed20: Record<string, string> = {
  "bento-h3-fl-pdd8": "h3-fl-pdd8",
  "bento-h3-fl-stock20": "h3-fl-stock20",
  "bento-h3-ref-pdd8": "h3-ref-pdd8",
  "bento-h3-ref-pdd8-guided": "h3-ref-pdd8",
  "bento-h3-ref-stock20": "h3-ref-stock20",
  "bento-image-fineporn-v5-int8": "image-fineporn-v5-int8-quality",
  "bento-image-fineporn-v5-int8-fast": "image-fineporn-v5-int8-fast",
  "bento-image-flux-2-klein-base-9b-fp8": "image-flux2-klein-9b-base-fp8",
  "bento-image-flux3-klein-base-int8": "image-flux3-klein-base-int8",
  "bento-image-flux3-klein-distilled-int8": "image-flux3-klein-distilled-int8",
  "bento-image-ideogram4-int8-convrot": "image-ideogram4-int8-convrot",
  "bento-image-klein9b-kv-fp8": "image-flux2-klein-9b-kv-fp8",
  "bento-image-krea2-turbo-int8-convrot": "image-krea2-turbo-int8-convrot",
  "bento-image-kroma-turbo-w8a8": "image-kroma-turbo-w8a8-fast",
  "bento-image-kroma-turbo-w8a8-quality": "image-kroma-turbo-w8a8-quality",
  "bento-image-kromafine-turbo-int8-convrot": "image-kromafine-turbo-int8-fast",
  "bento-image-kromafine-turbo-int8-convrot-quality": "image-kromafine-turbo-int8-quality",
  "bento-image-moss-sft": "image-moss-sft",
  "bento-image-qwen-image-2-1-int8-convrot": "image-qwen-image-2-1-int8-convrot",
  "bento-image-qwen21-turbo-int8": "image-qwen-image-2-1-turbo-int8-convrot",
  "bento-image-radiance-flux3-klein": "image-radiance-flux3-klein",
  "bento-image-radiance-flux3-klein-base": "image-radiance-flux3-klein-base",
  "bento-image-radiance-krea2-turbo": "image-radiance-krea2-turbo",
  "bento-image-radiance-noctq-v4": "image-radiance-noctq-v4",
  "bento-image-radiance-qwen21": "image-radiance-qwen-image-2-1",
  "bento-image-radiance-turbo": "image-radiance-qwen-image-2-1-turbo-uncensored",
  "bento-image-z-image-turbo-int8-convrot": "image-z-image-turbo-int8-convrot",
  "bento-radiance-fasth3-8": "h3-radiance-fast8",
  "bento-radiance-h3-stock50": "h3-radiance-stock50",
};
export const renamedProfileIds: Record<string, string> = {
  ...renamed24,
  ...Object.fromEntries(Object.entries(renamed20).map(([old, mid]) => [old, renamed24[mid]])),
};

// Profiles and guides are versioned definitions, edited in Studio; backups and logs stay as written.
const unscanned = new Set([
  "backups",
  "config",
  "guides",
  "history",
  "imports",
  "logs",
  "media",
  "workflows",
]);
// The JSON the SQLite import read; SQLite holds these documents now.
const sourceDocuments = new Set(["accounts.json", "gallery.json", "gallery-hidden.json"]);

type Counts = Record<string, number>;

/**
 * `value` with every `custom:<old id>` string (keys included) replaced. Where an object already has
 * the new key, its entry wins; an array keeps one copy of each id.
 */
export function remapValue(value: unknown, ids: Counts): unknown {
  const remap = (text: string) => {
    const next = text.startsWith("custom:") && renamedProfileIds[text.slice(7)];
    if (!next) return text;
    ids[text.slice(7)] = (ids[text.slice(7)] || 0) + 1;
    return `custom:${next}`;
  };
  if (typeof value === "string") return remap(value);
  if (Array.isArray(value)) {
    const next = value.map((item) => remapValue(item, ids));
    const renamed = (at: number) => typeof next[at] === "string" && next[at] !== value[at];
    return next.filter(
      (item, at) =>
        !renamed(at) || !next.some((other, i) => other === item && (!renamed(i) || i < at)),
    );
  }
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const kept = remap(key);
    if (kept !== key && (Object.hasOwn(value, kept) || Object.hasOwn(next, kept))) continue;
    next[kept] = remapValue(item, ids);
  }
  return next;
}

function jsonFiles(dir: string, top = true): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name.startsWith(".") || (top && unscanned.has(entry.name))
        ? []
        : jsonFiles(file, false);
    return entry.isFile() &&
      entry.name.endsWith(".json") &&
      !(top && sourceDocuments.has(entry.name))
      ? [file]
      : [];
  });
}

/** Each changed row value, from every table but the migration log. */
function databaseChanges(db: DatabaseSync, stores: Counts, ids: Counts) {
  const changes: { table: string; column: string; rowid: number; next: string }[] = [];
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'studio_migrations'",
    )
    .all() as { name: string }[];
  for (const { name: table } of tables)
    for (const row of db.prepare(`SELECT rowid AS rowid, * FROM "${table}"`).all() as Record<
      string,
      unknown
    >[])
      for (const [column, value] of Object.entries(row)) {
        if (column === "rowid" || typeof value !== "string" || !value.includes("custom:")) continue;
        let parsed: unknown = value;
        try {
          parsed = JSON.parse(value);
        } catch {
          // A plain text column.
        }
        const found: Counts = {};
        const next = remapValue(parsed, found);
        const count = Object.values(found).reduce((sum, n) => sum + n, 0);
        if (!count) continue;
        const store =
          table === "studio_documents" ? `sqlite:${row.name}` : `sqlite:${table}.${column}`;
        stores[store] = (stores[store] || 0) + count;
        for (const [id, n] of Object.entries(found)) ids[id] = (ids[id] || 0) + n;
        changes.push({
          table,
          column,
          rowid: Number(row.rowid),
          next: typeof next === "string" && parsed === value ? next : JSON.stringify(next),
        });
      }
  return changes;
}

/**
 * Plans (by default) or applies the rewrite. Needs the SQLite import (`runtime-json-v1`); run it
 * with Studio stopped, since Studio caches these stores. A second run finds nothing to change.
 */
export function remapProfileIds(dataDir: string, { apply = false } = {}) {
  const stores: Counts = {};
  const ids: Counts = {};
  if (!withOfflineDatabase(dataDir, (db) => hasMigration(db, "runtime-json-v1")))
    return {
      applied: false,
      skipped: "The SQLite import (runtime-json-v1) has not run",
      stores,
      ids,
    };
  const files: { file: string; next: unknown; compact: boolean }[] = [];
  for (const file of jsonFiles(dataDir)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("custom:")) continue;
    const found: Counts = {};
    const next = remapValue(JSON.parse(text), found);
    const count = Object.values(found).reduce((sum, n) => sum + n, 0);
    if (!count) continue;
    stores[path.relative(dataDir, file)] = count;
    for (const [id, n] of Object.entries(found)) ids[id] = (ids[id] || 0) + n;
    files.push({ file, next, compact: !text.includes("\n") });
  }
  if (!apply) {
    withOfflineDatabase(dataDir, (db) => databaseChanges(db, stores, ids));
    return { applied: false, stores, ids };
  }
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const change of databaseChanges(db, stores, ids))
      db.prepare(`UPDATE "${change.table}" SET "${change.column}" = ? WHERE rowid = ?`).run(
        change.next,
        change.rowid,
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  // Each file is replaced whole, keeping its permissions and layout.
  for (const { file, next, compact } of files) {
    const temporary = `${file}.profile-ids`;
    fs.writeFileSync(temporary, compact ? JSON.stringify(next) : JSON.stringify(next, null, 2), {
      mode: fs.statSync(file).mode & 0o777,
    });
    fs.renameSync(temporary, file);
  }
  return { applied: true, stores, ids };
}
