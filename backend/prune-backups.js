import fs from "node:fs";
import path from "node:path";

/**
 * The migrate-runtime step that deletes the data folder's backup folders: `backups/` (copies kept
 * by profile edits, removals, merges and backend combines) and `.backups/` (earlier migration
 * backups and the snapshots a new version takes on start). Studio writes these but reads them only
 * when a profile has no version history yet, so the step is safe while Studio runs. Plans by
 * default, listing each folder in them with its size; `apply` deletes both folders. Their
 * `--restore`s are then impossible. A second run finds nothing.
 */
export const pruneBackupsNote =
  "Deletes these backups for good: no --restore from them is possible afterwards.";
const roots = ["backups", ".backups"];

function bytesIn(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((total, name) => total + bytesIn(path.join(target, name)), 0);
}

export function pruneBackups(dataDir, { apply = false } = {}) {
  const folders = roots
    .filter((root) => fs.existsSync(path.join(dataDir, root)))
    .flatMap((root) => {
      const entries = fs.readdirSync(path.join(dataDir, root)).sort();
      // An empty root is still listed, so the step deletes it.
      return entries.length ? entries.map((name) => path.join(root, name)) : [root];
    })
    .map((folder) => ({ path: folder, bytes: bytesIn(path.join(dataDir, folder)) }));
  const result = {
    applied: false,
    note: pruneBackupsNote,
    folders,
    bytes: folders.reduce((total, folder) => total + folder.bytes, 0),
  };
  if (!apply || !folders.length) return result;
  for (const root of roots) fs.rmSync(path.join(dataDir, root), { recursive: true, force: true });
  result.applied = true;
  return result;
}
