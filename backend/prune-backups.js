import fs from "node:fs";
import path from "node:path";

/**
 * The migrate-runtime step that deletes the backups and leftovers older builds wrote into the data
 * folder: `backups/` (copies kept by profile edits, removals, merges and backend combines),
 * `.backups/` (migration backups and the snapshots a new version took on start) with its
 * `.version` marker, the `.bak` copies beside JSON files and `logs/` (logs now go to stdout).
 * Studio no longer reads any of them, so the step is safe while Studio runs. Plans by default,
 * listing what it would delete with its size; `apply` deletes it. A second run finds nothing.
 */
export const pruneBackupsNote = "Deletes these backups and old logs for good.";
const roots = ["backups", ".backups", "logs", ".version"];
// Media and caches hold no JSON stores, and walking them is slow.
const unwalked = new Set(["media", ".thumbnails", ".video-previews", "image-search", ...roots]);

function bytesIn(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((total, name) => total + bytesIn(path.join(target, name)), 0);
}

export function pruneBackups(dataDir, { apply = false } = {}) {
  const listed = [
    ...roots.filter((root) => fs.existsSync(path.join(dataDir, root))),
    ...fs.globSync(["**/*.json.bak", "**/.*.json.bak"], {
      cwd: dataDir,
      exclude: (name) => unwalked.has(name),
    }),
  ];
  const paths = listed.map((item) => ({ path: item, bytes: bytesIn(path.join(dataDir, item)) }));
  const result = {
    applied: false,
    note: pruneBackupsNote,
    paths,
    bytes: paths.reduce((total, item) => total + item.bytes, 0),
  };
  if (!apply || !paths.length) return result;
  for (const item of listed) fs.rmSync(path.join(dataDir, item), { recursive: true, force: true });
  result.applied = true;
  return result;
}
