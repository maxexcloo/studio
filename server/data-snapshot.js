/**
 * A copy of Studio's own state, taken the first time a new version starts.
 *
 * Updates can change what is in data/ in ways an older version can't read
 * back (sign-in sessions, the gallery file). Before
 * anything else loads, the files a version may rewrite are copied to
 * data/.backups/<from>-to-<to>-<time>/, so going back to the previous version
 * is a matter of stopping Studio and copying them back (docs/guides/TROUBLESHOOTING.md).
 *
 * Only the small state files are copied. Thumbnails, reference images and
 * the backups in data/backups stay where they are: no update rewrites them,
 * and copying them could take gigabytes. Snapshots are readable by this user
 * only and go after 14 days (3 at most).
 *
 * Imported first by server/index.js, so it runs before any store loads.
 * Node built-ins only, for the same reason.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trashFolderNames } from "./data-names.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataDir = process.env.STUDIO_DATA_DIR ? path.resolve(process.env.STUDIO_DATA_DIR) : path.join(root, "data");

const markerName = ".version";
const backupsName = ".backups";
const keepDays = 14;
const keepCount = 3;
// Large, or never rewritten by an update, or not ours to keep. An encrypted
// vault from before Hidden was removed moves into backups/ on its first start.
const skipped = new Set([".thumbnails", backupsName, "backups", ".private-vault", "reference-assets", "setup-demo", ...trashFolderNames, ".DS_Store", "Thumbs.db"]);

function currentVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "");
  } catch {
    return "";
  }
}

const safeName = (text) => String(text || "earlier").replace(/[^0-9A-Za-z.+-]/g, "-");

/** Whether data/ holds anything a version wrote (a fresh install has nothing to keep). */
function hasState(dataDir) {
  try {
    return fs.readdirSync(dataDir).some((name) => !skipped.has(name) && name !== markerName);
  } catch {
    return false;
  }
}

/** Removes snapshots past their days, then all but the newest `keepCount`. */
export function pruneSnapshots({ dataDir = defaultDataDir, now = Date.now() } = {}) {
  const dir = path.join(dataDir, backupsName);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return 0;
  }
  const dated = entries.map((entry) => {
    const full = path.join(dir, entry.name);
    let time = 0;
    try { time = fs.statSync(full).mtimeMs; } catch { /* gone meanwhile */ }
    return { full, time };
  }).sort((a, b) => b.time - a.time);
  let removed = 0;
  dated.forEach(({ full, time }, index) => {
    if (index < keepCount && now - time < keepDays * 86_400_000) return;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Held open (Windows); next start tries again.
    }
  });
  return removed;
}

/**
 * Copies data/'s state when `version` differs from the one that last ran
 * here. Returns the snapshot's folder, or "" when none was needed. A failed
 * copy leaves the marker alone, so the next start tries again.
 */
export function snapshotIfNewVersion({ dataDir = defaultDataDir, version = currentVersion(), now = Date.now() } = {}) {
  if (!version) return "";
  const marker = path.join(dataDir, markerName);
  let previous = "";
  try { previous = fs.readFileSync(marker, "utf8").trim(); } catch { previous = ""; }
  if (previous === version) {
    pruneSnapshots({ dataDir, now });
    return "";
  }
  let target = "";
  if (hasState(dataDir)) {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    target = path.join(dataDir, backupsName, `${safeName(previous)}-to-${safeName(version)}-${stamp}`);
    try {
      fs.mkdirSync(path.join(dataDir, backupsName), { recursive: true, mode: 0o700 });
      // Entry by entry: Node won't copy a folder into one inside itself (.backups).
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      for (const name of fs.readdirSync(dataDir)) {
        if (skipped.has(name) || name === markerName) continue;
        fs.cpSync(path.join(dataDir, name), path.join(target, name), { recursive: true, preserveTimestamps: true });
      }
      fs.chmodSync(target, 0o700);
      // preserveTimestamps gives the folder data/'s own date; its age counts from now.
      fs.utimesSync(target, new Date(now), new Date(now));
    } catch (error) {
      console.warn(`\n  Couldn't back up the data folder before updating (${error.message}). Trying again next start.\n`);
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* nothing to undo */ }
      return "";
    }
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(marker, `${version}\n`);
  } catch {
    // Read-only data folder: nothing will be rewritten either.
  }
  pruneSnapshots({ dataDir, now });
  return target;
}

snapshotIfNewVersion();
