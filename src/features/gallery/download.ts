import type { MediaItem } from "../../types";

/** Single-result actions save the displayed media; only bulk selection uses ZIP. */
export function mediaDownload(item: MediaItem) {
  const extension = item.type === "video" ? "mp4" : "png";
  const filename = (item.filename || `studio-${item.id}.${extension}`)
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim();
  return {
    href: item.upscale?.url || item.url,
    download: item.upscale?.url ? filename.replace(/\.[^.]+$/, ".png") : filename,
  };
}
