import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { databaseFile, jsonStoreSource, legacyFiles } from "./runtime.ts";

// What earlier migrate-runtime steps backed up, so --restore still restores their backups: the
// runtime and gallery rows steps' documents, the legacy records and status words steps' rows as
// JSON lists, the env settings step's env file and settings document, the download sources step's
// retired file and the profile ids step's files beside profiles, versions and LoRA stacks.
const documents = legacyFiles.map((file) => path.basename(file, ".json"));
const legacyRecordFiles = ["lora-stacks", "model-types", "studio_gallery", "studio_chat_messages"];
const envSettingsFiles = [".env", "settings.json"];
const downloadSourcesFiles = ["model-download-sources.json", "model-download-sources.json.bak"];
const profileIdFiles = ["guides/prompting.json", "workflow-preferences.json", "timings.json"];
const statusWordsFiles = ["studio_gallery", "studio_queue"];
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
    fs.mkdirSync(path.dirname(copy), { recursive: true, mode: 0o700 });
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

/**
 * Restores a backup only into a separate empty directory, so a rehearsal cannot overwrite live
 * state: each file at its path, and for a reference store (the uploads step's) the whole folder it
 * moved aside.
 */
export function restoreRuntimeBackup(backup: string, destination: string) {
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw new Error("Restore destination must be empty");
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "mapping.json"), "utf8"));
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const mapping of manifest.mappings) {
    const store = mapping.source === "reference-assets/index.json";
    // A profile and Studio's records beside it, a profile's or guide's version.
    const profile =
      /^workflows\/(\.studio-(aliases|edits|meta)|[a-z0-9][a-z0-9._-]*)\.json$/.test(
        mapping.source,
      ) ||
      /^history\/(profiles|guides)\/[A-Za-z0-9][A-Za-z0-9._:-]*\/\d+\.json$/.test(mapping.source);
    const catalogue = mapping.source === "library/catalogue.json";
    if (
      !store &&
      !profile &&
      !catalogue &&
      !jsonStoreSource.test(mapping.source) &&
      !envSettingsFiles.includes(mapping.source) &&
      !downloadSourcesFiles.includes(mapping.source) &&
      !profileIdFiles.includes(mapping.source) &&
      ![...documents, ...legacyRecordFiles, ...statusWordsFiles].some(
        (name) => mapping.source === `${name}.json`,
      )
    )
      throw new Error("Unsupported backup mapping");
    fs.mkdirSync(path.join(destination, path.dirname(mapping.source)), {
      recursive: true,
      mode: 0o700,
    });
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
