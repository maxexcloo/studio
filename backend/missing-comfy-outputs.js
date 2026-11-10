import { mediaParams } from "./media-paths.js";
import { galleryKey } from "./persistence/gallery-rows.ts";

/**
 * The migrate-runtime step that deletes gallery records whose file lived only in ComfyUI's output
 * folder (a `/comfy/view` URL that isn't Studio media) and is gone: that folder doesn't survive a
 * worker restart, so these show as broken tiles and fail the caption and image search passes.
 * Studio can't see that folder, so the gallery still counts them as there; new results move into
 * Studio media, so only old records are left like this. `gallery.check(item)` asks the worker that
 * made a record for its file: only a 404 marks it missing. A worker that doesn't answer (stopped,
 * timed out, 5xx) stops the checks and leaves the rest unknown, so a stopped worker deletes
 * nothing. The step needs the running server's gallery and workers, so it runs only through
 * POST /api/maintenance/migrations, and is safe there: `apply` removes the missing records through
 * the gallery's own delete, with delete markers, captions and search vectors. A second run finds nothing.
 */
export const missingComfyOutputsNote =
  "Deletes these gallery records, with their captions and search vectors, without a backup; --restore cannot bring them back. Their files are already gone.";
const offline =
  "Asks the workers for each file, so it runs only in Studio: POST /api/maintenance/migrations.";
const concurrency = 4;

const comfyOnly = (item) =>
  String(item?.url || "").startsWith("/comfy/view?") && !mediaParams(item.url);

/** `gallery`: `{ items(), check(item), remove(items) }`, the server's gallery and comfy fetch. */
export async function missingComfyOutputs(_dataDir, { apply = false, gallery } = {}) {
  const result = {
    applied: false,
    note: missingComfyOutputsNote,
    checked: 0,
    missing: 0,
    unknown: 0,
    examples: [],
  };
  if (!gallery) return { ...result, skipped: offline };
  const candidates = gallery.items().filter(comfyOnly);
  const missing = [];
  let unanswered = null;
  let next = 0;
  const work = async () => {
    while (!unanswered && next < candidates.length) {
      const item = candidates[next++];
      try {
        await gallery.check(item);
        result.checked += 1;
      } catch (error) {
        if (error?.status === 404) {
          result.checked += 1;
          missing.push(item);
        } else if (!error?.status || error.status >= 500) unanswered ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
  result.missing = missing.length;
  result.unknown = candidates.length - result.checked;
  if (unanswered) result.error = String(unanswered.message || unanswered);
  result.examples = missing
    .slice(0, 5)
    .map((item) => ({ id: item.id, createdAt: item.createdAt || "" }));
  if (!apply || !missing.length) return result;
  // Read again: the gallery may have changed while the checks ran.
  const keys = new Set(missing.map(galleryKey));
  gallery.remove(gallery.items().filter((item) => keys.has(galleryKey(item))));
  result.applied = true;
  return result;
}
