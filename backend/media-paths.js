import fs from "node:fs";
import path from "node:path";
import { isInside } from "./paths.js";
import { currentDataDir } from "./data-dir.js";
import { accountOutputSubfolder } from "./account-ownership.js";
import { outputFolderName } from "./data-names.js";

/**
 * Studio-owned media storage. With it, ComfyUI is a worker: each finished output
 * is fetched over its HTTP API into this folder and ComfyUI's copy is removed
 * (media-store.js). Gallery URLs keep ComfyUI's shape with `type=media`:
 * `/comfy/view?filename=…&subfolder=…&type=media`, so owner subfolders, caches
 * and parsers carry over, but such a file is only ever served from here.
 *
 * On by default in multi-user mode; `STUDIO_OUTPUT_STORAGE=studio` opts a
 * single-user studio in and `=comfy` keeps ComfyUI's output folder.
 */
export const dataDir = currentDataDir();

export const mediaType = "media";
/** Whether outputs live in Studio media; any value other than `studio` or `comfy` is refused. */
export function outputStorageFromEnv(env = process.env) {
  if (!env.STUDIO_OUTPUT_STORAGE) return env.STUDIO_MULTI_USER === "1";
  if (!["studio", "comfy"].includes(env.STUDIO_OUTPUT_STORAGE))
    throw new Error('STUDIO_OUTPUT_STORAGE must be "studio" or "comfy".');
  return env.STUDIO_OUTPUT_STORAGE === "studio";
}
export const mediaStorageEnabled = outputStorageFromEnv();
/** A data folder's media folder: STUDIO_MEDIA_DIR, else its `media`. */
export const mediaRootFor = (directory) =>
  path.resolve(process.env.STUDIO_MEDIA_DIR || path.join(directory, "media"));
export const mediaRoot = mediaRootFor(dataDir);

/** The owner's media folder: the account's own subfolder, or the studio's. */
export function mediaSubfolder(ownerId = "") {
  return ownerId ? accountOutputSubfolder(ownerId) : outputFolderName;
}

const mediaPattern =
  /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|m4v|flac|mp3|wav|ogg|opus|m4a|aac)$/i;
const inDotFolder = (subfolder) =>
  String(subfolder || "")
    .split(/[\\/]/)
    .some((part) => part.startsWith("."));

/** Where a media file lives (or would live); null for anything outside the media folder or in a dot folder. */
export function mediaPath(filename, subfolder = "") {
  if (
    !filename ||
    filename !== path.basename(String(filename)) ||
    /[\\/]/.test(String(filename)) ||
    !mediaPattern.test(String(filename))
  )
    return null;
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

/** A gallery URL's media file reference, or null when it is not a Studio media URL. */
export function mediaParams(url) {
  const value = String(url || "");
  if (
    !value.startsWith("/comfy/view?") &&
    !value.startsWith("/comfy/thumb?") &&
    !value.startsWith("/comfy/video-preview?")
  )
    return null;
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
