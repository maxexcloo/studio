import { mediaRoot, mediaStorageEnabled } from "./media-paths.js";
import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir } from "./comfy.js";
import { forgetItemThumbnails } from "./thumbnails.js";
import { forgetItemVideoPreviews } from "./video-previews.js";
import { trashFolderName } from "./data-names.js";

/**
 * Earlier builds moved cleared images into a trash: one folder per clear,
 * `<trash folder>/<batch>/` (data-names.js) inside the media and ComfyUI output folders, with a
 * batch.json listing the gallery records. Those batches are purged for good
 * after STUDIO_TRASH_DAYS (30). Folders starting with a dot are not served as
 * outputs (comfy.js), so the trash is not visible as one either.
 */

export const trashDays = (() => {
  const days = Number(process.env.STUDIO_TRASH_DAYS || 30);
  return Number.isFinite(days) && days >= 1 ? Math.min(365, days) : 30;
})();
const dayMs = 24 * 60 * 60 * 1000;

function trashBases() {
  return [
    ...new Set(
      [mediaStorageEnabled ? mediaRoot : "", comfyOutputDir]
        .filter(Boolean)
        .map((dir) => path.resolve(dir)),
    ),
  ];
}

function readBatch(dir) {
  try {
    const batch = JSON.parse(fs.readFileSync(path.join(dir, "batch.json"), "utf8"));
    return batch && Array.isArray(batch.files) ? batch : null;
  } catch {
    return null;
  }
}

/** The batches in every trash folder, each with when it was made. */
function trashBatches() {
  return trashBases().flatMap((base) => {
    const root = path.join(base, trashFolderName);
    let names = [];
    try {
      names = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    return names.map((name) => {
      const dir = path.join(root, name);
      const batch = readBatch(dir);
      let createdAt = batch?.createdAt || "";
      if (!Date.parse(createdAt)) {
        try {
          createdAt = fs.statSync(dir).mtime.toISOString();
        } catch {
          createdAt = new Date(0).toISOString();
        }
      }
      return { dir, createdAt, batch };
    });
  });
}

async function removeBatch(batch) {
  for (const item of batch.batch?.items || []) {
    await forgetItemThumbnails(item).catch(() => 0);
    await forgetItemVideoPreviews(item).catch(() => 0);
  }
  fs.rmSync(batch.dir, { recursive: true, force: true });
}

/** Deletes batches older than the retention for good. Returns how many went. */
export async function purgeTrash({ now = Date.now() } = {}) {
  let purged = 0;
  for (const batch of trashBatches()) {
    if (now - Date.parse(batch.createdAt) < trashDays * dayMs) continue;
    try {
      await removeBatch(batch);
      purged += 1;
    } catch {
      // In use right now; the next sweep gets it.
    }
  }
  return purged;
}

/** Purges once shortly after start, then every six hours while running. */
export function scheduleTrashPurge() {
  const sweep = () =>
    purgeTrash().catch((error) =>
      console.warn(`[Studio] Could not empty old trash: ${error.message}`),
    );
  setTimeout(sweep, 30 * 1000).unref?.();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref?.();
}
