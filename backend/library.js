import { localOutputFile } from "./comfy.js";
import { describeComfyGraph, gallery, galleryKey, setGallery } from "./gallery-store.js";
import { parseA1111Parameters, readPngInfo } from "./png-text.js";
import { loadSharp } from "./sharp-loader.js";
import { probeVideo } from "./video-previews.js";

const imagePattern = /\.(png|jpe?g|webp|gif|avif)$/i;

/** What a file says about itself: its size, and a prompt when it carries one. */
export async function readMediaInfo(file) {
  const info = { width: 0, height: 0, prompt: "", negative: "", model: "" };
  if (/\.png$/i.test(file)) {
    const png = readPngInfo(file);
    if (png) {
      info.width = png.width;
      info.height = png.height;
      const a1111 = png.text.parameters ? parseA1111Parameters(png.text.parameters) : null;
      if (a1111?.prompt)
        Object.assign(info, { prompt: a1111.prompt, negative: a1111.negative, model: a1111.model });
      else if (png.text.prompt) {
        // The size in the graph is what was asked for; the PNG's own is truer, so only the words are taken.
        try {
          const { prompt, negative, model } = describeComfyGraph(JSON.parse(png.text.prompt));
          Object.assign(info, { prompt, negative, model });
        } catch {
          /* not ComfyUI's graph */
        }
      }
      return info;
    }
  }
  if (imagePattern.test(file)) {
    const sharp = await loadSharp();
    if (sharp) {
      try {
        const meta = await sharp(file).metadata();
        info.width = Number(meta.width || 0);
        info.height = Number(meta.height || 0);
      } catch {
        /* unreadable: shown without its size */
      }
    }
  }
  return info;
}

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
