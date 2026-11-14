import { localOutputFile } from "../comfy/comfy.js";
import { gallery, setGallery } from "../gallery/store.js";
import { probeVideo } from "../video-previews.js";
import { galleryKey } from "../persistence/gallery-rows.ts";

const yieldToServer = () => new Promise((resolve) => setImmediate(resolve));

/** The file on this computer behind a video in the gallery, or null. */
function videoFileOf(item) {
  if (typeof item.url !== "string" || !item.url.startsWith("/comfy/view?")) return null;
  const params = new URLSearchParams(item.url.slice(item.url.indexOf("?") + 1));
  return localOutputFile(
    params.get("filename") || "",
    params.get("subfolder") || "",
    params.get("type") || "output",
  );
}

let filling = null;

/**
 * Videos added before their size was read from the file (and any other video
 * without one): read it now, in the background, and pass it on in batches,
 * so their tiles take their real shape and the details stop saying ?×?.
 */
export function fillVideoSizes() {
  if (filling) return filling;
  filling = (async () => {
    const missing = gallery.filter(
      (item) =>
        item.type === "video" &&
        item.status === "done" &&
        !(Number(item.width) > 0 && Number(item.height) > 0),
    );
    let filled = 0;
    let batch = new Map();
    const flush = () => {
      if (!batch.size) return;
      const sizes = batch;
      batch = new Map();
      setGallery(
        gallery.map((item) =>
          sizes.has(galleryKey(item)) ? { ...item, ...sizes.get(galleryKey(item)) } : item,
        ),
      );
    };
    for (const item of missing) {
      const file = videoFileOf(item);
      const info = file ? await probeVideo(file) : null;
      if (info) {
        batch.set(galleryKey(item), { width: info.width, height: info.height });
        filled += 1;
      }
      if (batch.size >= 25) flush();
      await yieldToServer();
    }
    flush();
    return filled;
  })().finally(() => {
    filling = null;
  });
  return filling;
}
