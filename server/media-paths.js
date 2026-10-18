import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside } from "./paths.js";

/**
 * HEISS-owned media storage. With it, ComfyUI is a worker: each finished output
 * is fetched over its HTTP API into this folder and ComfyUI's copy is removed
 * (media-store.js). Gallery URLs keep ComfyUI's shape with `type=media`:
 * `/comfy/view?filename=…&subfolder=…&type=media`, so owner subfolders, caches
 * and parsers carry over, but such a file is only ever served from here.
 *
 * On by default in multi-user mode; `HEISS_OUTPUT_STORAGE=heiss` opts a
 * single-user studio in and `=comfy` keeps ComfyUI's output folder.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR ? path.resolve(process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR) : path.join(root, "data");

export const mediaType = "media";
export const mediaStorageEnabled = process.env.HEISS_OUTPUT_STORAGE
  ? process.env.HEISS_OUTPUT_STORAGE === "heiss"
  : process.env.HEISS_MULTI_USER === "1";
export const mediaRoot = path.resolve(process.env.HEISS_MEDIA_DIR || path.join(dataDir, "media"));

const mediaPattern = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|m4v|flac|mp3|wav|ogg|opus|m4a|aac)$/i;
const inDotFolder = (subfolder) => String(subfolder || "").split(/[\\/]/).some((part) => part.startsWith("."));

/** Where a media file lives (or would live); null for anything outside the media folder or in a dot folder. */
export function mediaPath(filename, subfolder = "") {
  if (!filename || filename !== path.basename(String(filename)) || /[\\/]/.test(String(filename)) || !mediaPattern.test(String(filename))) return null;
  if (inDotFolder(subfolder) || path.isAbsolute(String(subfolder || ""))) return null;
  const file = path.resolve(mediaRoot, String(subfolder || ""), String(filename));
  return isInside(mediaRoot, file) ? file : null;
}

/** An existing media file, checked on its real path so a symlink cannot lead outside; null otherwise. */
export function mediaFile(filename, subfolder = "") {
  const file = mediaPath(filename, subfolder);
  if (!file) return null;
  try {
    if (!isInside(fs.realpathSync(mediaRoot), fs.realpathSync(file))) return null;
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** A gallery URL's media file reference, or null when it is not a HEISS media URL. */
export function mediaParams(url) {
  const value = String(url || "");
  if (!value.startsWith("/comfy/view?") && !value.startsWith("/comfy/thumb?") && !value.startsWith("/comfy/video-preview?")) return null;
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  if (params.get("type") !== mediaType) return null;
  return { filename: params.get("filename") || "", subfolder: params.get("subfolder") || "" };
}

export function isMediaUrl(url) {
  return Boolean(mediaParams(url));
}

export function mediaUrls(filename, subfolder) {
  const query = new URLSearchParams({ filename, subfolder, type: mediaType }).toString();
  return { url: `/comfy/view?${query}`, thumbnailUrl: `/comfy/thumb?${query}` };
}
