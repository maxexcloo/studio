import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { databaseFile, runtimeDatabase, readOfflineRuntime } from "./runtime.ts";

const documents = ["accounts", "gallery", "gallery-hidden"] as const;
const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");

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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(
    dataDir,
    ".backups",
    `sqlite-${stamp}-${crypto.randomBytes(3).toString("hex")}`,
  );
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const mapping of plan.mappings) {
    const source = path.join(dataDir, mapping.source);
    const copy = path.join(backup, mapping.source);
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copy, 0o600);
    if (
      digest(fs.readFileSync(copy)) !== mapping.hash ||
      digest(fs.readFileSync(source)) !== mapping.hash
    )
      throw new Error(`Backup verification failed: ${mapping.source}`);
  }
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
  fs.writeFileSync(
    path.join(backup, "mapping.json"),
    JSON.stringify(
      {
        ...plan,
        database: path.basename(databaseFile(dataDir)),
        appliedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return { ...plan, applied: true, backup };
}

/** Restores only into a separate empty directory, so a rehearsal cannot overwrite live state. */
export function restoreRuntimeBackup(backup: string, destination: string) {
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw new Error("Restore destination must be empty");
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "mapping.json"), "utf8"));
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const mapping of manifest.mappings) {
    if (!documents.some((name) => mapping.source === `${name}.json`))
      throw new Error("Unsupported backup mapping");
    const source = path.join(backup, mapping.source);
    const bytes = fs.readFileSync(source);
    if (digest(bytes) !== mapping.hash)
      throw new Error(`Backup verification failed: ${mapping.source}`);
    fs.writeFileSync(path.join(destination, mapping.source), bytes, { mode: 0o600, flag: "wx" });
  }
  return { restored: manifest.mappings.length };
}
