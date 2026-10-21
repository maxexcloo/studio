/**
 * Studio no longer has Hidden. Once, on the first start without it, this
 * backs up what Hidden left in data/ and puts what can be read back into the
 * ordinary gallery. Nothing is deleted:
 *
 * - data/backups/hidden-removal-<time>/ (0700) gets copies of gallery.json,
 *   gallery-hidden.json, privacy.json and hidden-runs.json (with their .bak
 *   copies), and the encrypted .private-vault folder moved in whole: nothing
 *   reads it any more, and its images need the owner's password to open.
 *   summary.json and README.txt say what changed. The folder is written even
 *   when there was no Hidden, so a deployment can confirm this ran.
 * - Gallery records flagged as Hidden lose the flags; records a delete marker
 *   kept out of view lose the marker (a deleted record leaves gallery.json,
 *   so a record still there was hidden, not deleted); prompts sealed by the
 *   older scheme are cleared, their ciphertext kept in the backup.
 * - data/.hidden-removed-v1 marks it done.
 *
 * Imported by server/index.js right after data-snapshot.js, before any store
 * loads gallery.json. Node built-ins and json-store.js only, for that reason.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataDir = process.env.STUDIO_DATA_DIR ? path.resolve(process.env.STUDIO_DATA_DIR) : path.join(root, "data");

export const flagName = ".hidden-removed-v1";
export const backupsName = "backups";
const vaultName = ".private-vault";
const copiedFiles = ["gallery.json", "gallery-hidden.json", "privacy.json", "hidden-runs.json"];
const hiddenFlags = ["privateVault", "hidden", "vaultLocked", "promptProtected"];
const sealedFields = ["promptEncrypted", "negativeEncrypted"];
const sealed = (value) => typeof value === "string" && value.startsWith("enc:v1:");

// As in gallery-store.js: galleryKey, and markerOf's keyed digest under data/.gallery-marker-key.
const galleryKey = (item) => item?.url || item?.id || item?.outputName || item?.filename || "";
function markerFor(dataDir) {
  let key = null;
  try {
    const saved = Buffer.from(fs.readFileSync(path.join(dataDir, ".gallery-marker-key"), "utf8").trim(), "base64url");
    if (saved.length === 32) key = saved;
  } catch { /* none yet: only plain markers can exist */ }
  return (text) => (key ? `h:${crypto.createHmac("sha256", key).update(text).digest("base64url")}` : "");
}

function readOptionalJson(file) {
  if (!fs.existsSync(file) && !fs.existsSync(`${file}.bak`)) return undefined;
  return readJsonFile(file);
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

/** One gallery record as an ordinary item; `changes` counts what it lost. */
function ordinaryRecord(record, changes) {
  if (!record || typeof record !== "object") return record;
  let next = record;
  const without = (keys) => {
    const present = keys.filter((key) => key in next);
    if (!present.length) return false;
    next = Object.fromEntries(Object.entries(next).filter(([key]) => !present.includes(key)));
    return true;
  };
  if (without(hiddenFlags)) changes.unflagged += 1;
  const sealedPrompt = sealed(next.prompt) || sealed(next.negative);
  if (without(sealedFields) || sealedPrompt) {
    changes.sealedPrompts += 1;
    next = { ...next, ...(sealed(next.prompt) ? { prompt: "" } : {}), ...(sealed(next.negative) ? { negative: "" } : {}) };
  }
  return next;
}

function readme(summary) {
  const lines = [
    "Studio removed Hidden. This folder is the backup taken first; nothing was deleted.",
    "",
    "gallery.json and gallery-hidden.json are the gallery and its delete markers as they were.",
    "privacy.json and hidden-runs.json, where present, are Hidden's key ring and unfinished runs."
  ];
  if (summary.vault) {
    lines.push(
      ".private-vault is Hidden's encrypted store, kept here whole.",
      `It holds ${summary.vault.encryptedFiles} encrypted file(s). Opening them needs the Hidden password (or a passkey) and privacy.json; Studio no longer can.`
    );
  }
  lines.push("", "summary.json counts what changed in the gallery.", "");
  return lines.join("\n");
}

/**
 * Runs the removal unless data/.hidden-removed-v1 says it already ran.
 * Returns the summary it wrote, or null when it had run before.
 */
export function removeHidden({ dataDir = defaultDataDir, now = new Date(), log = console } = {}) {
  const flag = path.join(dataDir, flagName);
  if (fs.existsSync(flag)) return null;
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupsDir = path.join(dataDir, backupsName);
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  let backup = path.join(backupsDir, `hidden-removal-${stamp}`);
  for (let suffix = 2; fs.existsSync(backup); suffix += 1) backup = path.join(backupsDir, `hidden-removal-${stamp}-${suffix}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  fs.chmodSync(backup, 0o700);

  // Copies first: data/ changes only once they are on disk.
  const copied = [];
  for (const name of copiedFiles) {
    for (const file of [name, `${name}.bak`]) {
      const source = path.join(dataDir, file);
      if (!fs.existsSync(source)) continue;
      fs.copyFileSync(source, path.join(backup, file));
      copied.push(file);
    }
  }

  let vault = null;
  const vaultDir = path.join(dataDir, vaultName);
  if (fs.existsSync(vaultDir)) {
    const encryptedFiles = countFiles(vaultDir);
    const target = path.join(backup, vaultName);
    try {
      fs.renameSync(vaultDir, target);
      vault = { moved: true, encryptedFiles, needsPassword: true };
    } catch {
      // data/ spans more than one disk: copy it, and leave the original where it was.
      fs.cpSync(vaultDir, target, { recursive: true, preserveTimestamps: true });
      vault = { moved: false, encryptedFiles, needsPassword: true };
    }
  }

  const changes = { records: 0, unflagged: 0, unsuppressed: 0, sealedPrompts: 0 };
  const galleryPath = path.join(dataDir, "gallery.json");
  const gallery = readOptionalJson(galleryPath);
  if (Array.isArray(gallery)) {
    changes.records = gallery.length;
    const next = gallery.map((record) => ordinaryRecord(record, changes));
    if (changes.unflagged || changes.sealedPrompts) writeJsonFile(galleryPath, next, { compact: true });

    const markersPath = path.join(dataDir, "gallery-hidden.json");
    const markers = readOptionalJson(markersPath);
    if (markers && typeof markers === "object") {
      const markerOf = markerFor(dataDir);
      const present = new Set(next.map(galleryKey).filter(Boolean).flatMap((key) => [key, markerOf(key)]).filter(Boolean));
      const entries = Array.isArray(markers) ? markers.map((key) => [String(key)]) : Object.entries(markers);
      const kept = entries.filter(([key]) => !present.has(key));
      changes.unsuppressed = entries.length - kept.length;
      if (changes.unsuppressed) writeJsonFile(markersPath, Array.isArray(markers) ? kept.map(([key]) => key) : Object.fromEntries(kept));
    }
  }

  const hiddenFound = Boolean(vault || changes.unflagged || changes.unsuppressed || changes.sealedPrompts
    || copied.some((file) => file.startsWith("privacy.json") || file.startsWith("hidden-runs.json")));
  const summary = {
    version: 1,
    migratedAt: now.toISOString(),
    backup: path.relative(dataDir, backup),
    hiddenFound,
    copied,
    vault,
    gallery: changes
  };
  writeJsonFile(path.join(backup, "summary.json"), summary, { mode: 0o600 });
  fs.writeFileSync(path.join(backup, "README.txt"), readme(summary), { mode: 0o600 });
  writeJsonFile(flag, { migratedAt: summary.migratedAt, backup: summary.backup, hiddenFound });

  log.log(`[Studio] Hidden removal: backup in ${summary.backup}; ${changes.unflagged} record(s) unflagged, ${changes.unsuppressed} brought back into view, ${changes.sealedPrompts} sealed prompt(s) cleared.`);
  if (vault) log.warn(`[Studio] Hidden removal: ${vault.encryptedFiles} encrypted Hidden file(s) are kept in ${summary.backup}/${vaultName}; restoring them needs the owner's Hidden password.`);
  return summary;
}

try {
  removeHidden();
} catch (error) {
  // No flag is written, so the next start tries again; data/ keeps what it had.
  console.error(`[Studio] Hidden removal failed (${error.message}); it runs again on the next start.`);
}
