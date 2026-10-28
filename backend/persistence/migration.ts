import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createGalleryTable, galleryKey, galleryRowsMigration } from "./gallery-rows.ts";
import {
  databaseFile,
  hasMigration,
  readOfflineRuntime,
  runtimeDatabase,
  withOfflineDatabase,
} from "./runtime.ts";

const documents = ["accounts", "gallery", "gallery-hidden"] as const;
const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * Writes `files` and a restore manifest (`mapping.json`, holding `plan`) to a new
 * `.backups/<label>-*` folder, verified and synced before the caller makes SQLite authoritative.
 */
export function verifiedBackup(
  dataDir: string,
  label: string,
  files: { source: string; hash: string; bytes: Buffer }[],
  plan: object,
) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(
    dataDir,
    ".backups",
    `${label}-${stamp}-${crypto.randomBytes(3).toString("hex")}`,
  );
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const copy = path.join(backup, file.source);
    if (digest(file.bytes) !== file.hash)
      throw new Error(`Backup verification failed: ${file.source}`);
    fs.writeFileSync(copy, file.bytes, { mode: 0o600, flag: "wx" });
    if (digest(fs.readFileSync(copy)) !== file.hash)
      throw new Error(`Backup verification failed: ${file.source}`);
  }
  const manifestFile = path.join(backup, "mapping.json");
  const manifest =
    JSON.stringify(
      {
        ...plan,
        database: path.basename(databaseFile(dataDir)),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n";
  fs.writeFileSync(manifestFile, manifest, { mode: 0o600, flag: "wx" });
  if (fs.readFileSync(manifestFile, "utf8") !== manifest)
    throw new Error("Backup mapping verification failed");
  // The complete restorable backup must reach disk before SQLite becomes authoritative.
  for (const file of [
    ...files.map((file) => path.join(backup, file.source)),
    manifestFile,
    backup,
  ]) {
    const handle = fs.openSync(file, "r");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  }
  return backup;
}

/** No media is moved and no source file is rewritten. Run with Studio stopped. */
export function planRuntimeMigration(dataDir: string) {
  const mappings: { source: string; target: string; count: number; hash: string }[] = [];
  const conflicts: string[] = [];
  for (const name of documents) {
    const source = path.join(dataDir, `${name}.json`);
    if (!fs.existsSync(source)) continue;
    try {
      const bytes = fs.readFileSync(source);
      const value = JSON.parse(bytes.toString());
      if (name === "gallery" && !Array.isArray(value)) throw new Error("Expected an array");
      if (name === "accounts" && (!value || !Array.isArray(value.accounts)))
        throw new Error("Expected an accounts record");
      if (name === "gallery-hidden" && (!value || typeof value !== "object"))
        throw new Error("Expected deletion markers");
      mappings.push({
        source: `${name}.json`,
        target: `studio_documents/${name}`,
        count: Array.isArray(value)
          ? value.length
          : name === "accounts"
            ? value.accounts.length
            : Object.keys(value).length,
        hash: digest(bytes),
      });
    } catch {
      conflicts.push(`${name}.json is unreadable or has an unsupported shape`);
    }
  }
  return { alreadyMigrated: readOfflineRuntime(dataDir).migrated, mappings, conflicts };
}

export function migrateRuntime(dataDir: string, { apply = false } = {}) {
  const plan = planRuntimeMigration(dataDir);
  if (!apply || plan.alreadyMigrated || plan.conflicts.length)
    return { ...plan, applied: false, backup: "" };
  const backup = verifiedBackup(
    dataDir,
    "sqlite",
    plan.mappings.map((mapping) => ({
      ...mapping,
      bytes: fs.readFileSync(path.join(dataDir, mapping.source)),
    })),
    plan,
  );
  const db = runtimeDatabase(dataDir);
  db.exec("BEGIN IMMEDIATE");
  try {
    const write = db.prepare("INSERT INTO studio_documents(name, value) VALUES (?, ?)");
    for (const mapping of plan.mappings) {
      const name = path.basename(mapping.source, ".json");
      const text = fs.readFileSync(path.join(backup, mapping.source), "utf8");
      write.run(name, JSON.stringify(JSON.parse(text)));
      const saved = db.prepare("SELECT value FROM studio_documents WHERE name = ?").get(name) as {
        value: string;
      };
      if (saved.value !== JSON.stringify(JSON.parse(text)))
        throw new Error(`Restoration verification failed: ${mapping.source}`);
    }
    db.prepare("INSERT INTO studio_migrations(name, applied_at) VALUES (?, ?)").run(
      "runtime-json-v1",
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}

/**
 * The migrate-runtime step `gallery-rows-v1` (persistence/gallery-rows.ts): moves the `gallery`
 * document into one `studio_gallery` row per item. Plans by default; `apply` backs the document
 * up as `gallery.json` in a `.backups/gallery-rows-<time>` folder (restorable with --restore),
 * then commits the rows, the document's removal and the marker atomically. Runs after
 * runtime-json-v1, with Studio stopped; a second run finds it done.
 */
function planGalleryRows(dataDir: string) {
  const plan = {
    runtimeMigrated: false,
    alreadyMigrated: false,
    mappings: [] as { source: string; target: string; count: number; hash: string }[],
    conflicts: [] as string[],
  };
  withOfflineDatabase(dataDir, (db) => {
    plan.runtimeMigrated = hasMigration(db, "runtime-json-v1");
    plan.alreadyMigrated = hasMigration(db, galleryRowsMigration);
    if (!plan.runtimeMigrated || plan.alreadyMigrated) return;
    const row = db.prepare("SELECT value FROM studio_documents WHERE name = 'gallery'").get() as
      | { value: string }
      | undefined;
    if (!row) return;
    const items = JSON.parse(row.value);
    if (!Array.isArray(items)) {
      plan.conflicts.push("The gallery document is not a list");
      return;
    }
    const keys = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = galleryKey(item);
      if (!key) plan.conflicts.push(`Gallery item ${index} has no url or id`);
      else if (keys.has(key)) plan.conflicts.push(`Two gallery items share the key ${key}`);
      keys.add(key);
    }
    plan.mappings.push({
      source: "gallery.json",
      target: "studio_gallery",
      count: items.length,
      hash: digest(row.value),
    });
  });
  return plan;
}

export function migrateGalleryRows(dataDir: string, { apply = false } = {}) {
  const plan = planGalleryRows(dataDir);
  if (!apply || !plan.runtimeMigrated || plan.alreadyMigrated || plan.conflicts.length)
    return { ...plan, applied: false, backup: "" };
  const db = runtimeDatabase(dataDir);
  const document = () =>
    (
      db.prepare("SELECT value FROM studio_documents WHERE name = 'gallery'").get() as
        | { value: string }
        | undefined
    )?.value;
  const text = document();
  const backup = verifiedBackup(
    dataDir,
    "gallery-rows",
    plan.mappings.map((mapping) => ({ ...mapping, bytes: Buffer.from(text ?? "") })),
    plan,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    if (document() !== text) throw new Error("The gallery changed during the migration");
    db.exec(createGalleryTable);
    const items = text ? (JSON.parse(text) as Parameters<typeof galleryKey>[0][]) : [];
    const insert = db.prepare("INSERT INTO studio_gallery (key, value) VALUES (?, ?)");
    for (const item of items) insert.run(galleryKey(item), JSON.stringify(item));
    const { count } = db.prepare("SELECT count(*) AS count FROM studio_gallery").get() as {
      count: number;
    };
    if (count !== items.length) throw new Error("Gallery row verification failed");
    db.prepare("DELETE FROM studio_documents WHERE name = 'gallery'").run();
    db.prepare("INSERT INTO studio_migrations(name, applied_at) VALUES (?, ?)").run(
      galleryRowsMigration,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...plan, applied: true, backup };
}

/**
 * Restores only into a separate empty directory, so a rehearsal cannot overwrite live state. The
 * uploads step's backup (uploads.js) restores the whole reference store it moved aside.
 */
export function restoreRuntimeBackup(backup: string, destination: string) {
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw new Error("Restore destination must be empty");
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "mapping.json"), "utf8"));
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const mapping of manifest.mappings) {
    const store = mapping.source === "reference-assets/index.json";
    if (!store && !documents.some((name) => mapping.source === `${name}.json`))
      throw new Error("Unsupported backup mapping");
    const source = path.join(backup, mapping.source);
    const bytes = fs.readFileSync(source);
    if (digest(bytes) !== mapping.hash)
      throw new Error(`Backup verification failed: ${mapping.source}`);
    if (store)
      fs.cpSync(path.dirname(source), path.join(destination, path.dirname(mapping.source)), {
        recursive: true,
      });
    else
      fs.writeFileSync(path.join(destination, mapping.source), bytes, { mode: 0o600, flag: "wx" });
  }
  return { restored: manifest.mappings.length };
}
