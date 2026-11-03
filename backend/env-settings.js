import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { verifiedBackup } from "./persistence/migration.ts";
import { runtimeDatabase, withOfflineDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that moves what older builds' Settings wrote into the data folder's
 * env file (`<data>/.env`, the image's STUDIO_ENV_FILE) to the SQLite `settings` document
 * Settings saves to now (deployment-settings.js). Studio loads that file as environment, so until
 * this runs those values show as the deployment's and locked.
 * - `moved`: the keys Settings › Models saved (`savedKeys`) go to the document, replacing a value
 *   saved there (`replaced`), since the file's value was the one in effect.
 * - `removed`: the switches Studio no longer reads (`retiredKeys`) and empty values go.
 * - `kept`: every other key stays in the file; with none left the file goes.
 * Reports key names only, never values. Plans by default; `apply` copies the file and the
 * document to a `.backups/env-settings-*` folder with a `mapping.json` (restorable with
 * `--restore`), then writes both, with Studio stopped. A second run finds nothing.
 */
const savedKeys = [
  "STUDIO_ASSISTANT_MODEL",
  "STUDIO_DEFAULT_IMAGE_PROFILE",
  "STUDIO_DEFAULT_VIDEO_PROFILE",
  "STUDIO_GALLERY_CAPTIONS",
  "STUDIO_IMAGE_SEARCH",
];
const retiredKeys = [
  "STUDIO_ENABLE_GROK",
  "STUDIO_ENABLE_INPAINT",
  "STUDIO_ENABLE_LORAS",
  "STUDIO_VIDEO_CLOUD_FALLBACK",
];
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function readSettings(dataDir) {
  return withOfflineDatabase(dataDir, (db) => {
    const row = db.prepare("SELECT value FROM studio_documents WHERE name = 'settings'").get();
    return row ? row.value : null;
  });
}

export function envSettings(dataDir, { apply = false } = {}) {
  const file = path.join(dataDir, ".env");
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const values = bytes ? parseEnv(bytes.toString("utf8")) : {};
  const keys = Object.keys(values);
  const moved = keys.filter((key) => savedKeys.includes(key) && values[key] !== "");
  const removed = keys.filter(
    (key) => retiredKeys.includes(key) || (savedKeys.includes(key) && values[key] === ""),
  );
  const stored = readSettings(dataDir) ?? null;
  const settings = stored ? JSON.parse(stored) : {};
  const plan = {
    moved,
    replaced: moved.filter((key) => key in settings && settings[key] !== values[key]),
    removed,
    kept: keys.filter((key) => !moved.includes(key) && !removed.includes(key)),
  };
  if (!apply || !(moved.length || removed.length)) return { ...plan, applied: false, backup: "" };

  const gone = new Set([...moved, ...removed]);
  const lines = bytes
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => !gone.has(line.match(assignment)?.[1]));
  const rest = lines.join("\n").replace(/\n*$/, "\n");
  const left = parseEnv(rest);
  // Only whole assignments go: anything else (a value spanning lines) stops the step unwritten.
  if (
    JSON.stringify(left) !==
    JSON.stringify(Object.fromEntries(plan.kept.map((key) => [key, values[key]])))
  )
    throw new Error("The env file has a value Studio cannot remove line by line; edit it by hand");

  const copies = [
    { source: ".env", bytes },
    ...(stored ? [{ source: "settings.json", bytes: Buffer.from(stored) }] : []),
  ].map((copy) => ({ ...copy, hash: digest(copy.bytes) }));
  const backup = verifiedBackup(dataDir, "env-settings", copies, {
    ...plan,
    mappings: copies.map(({ source, hash }) => ({ source, hash })),
  });

  if (moved.length) {
    const next = { ...settings };
    for (const key of moved) next[key] = values[key];
    const db = runtimeDatabase(dataDir);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db
        .prepare("SELECT value FROM studio_documents WHERE name = 'settings'")
        .get();
      if ((current?.value ?? null) !== stored)
        throw new Error("The saved settings changed during the migration");
      db.prepare(
        "INSERT INTO studio_documents (name, value) VALUES ('settings', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      ).run(JSON.stringify(next));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (plan.kept.length) fs.writeFileSync(file, rest, { mode: 0o600 });
  else fs.rmSync(file);
  return { ...plan, applied: true, backup };
}
