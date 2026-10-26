import type { MediaItem } from "../../types";
import { mediaSource } from "./mediaSource";

/** Single-result actions save the displayed media; only bulk selection uses ZIP. */
export function mediaDownload(item: MediaItem, withoutSettings = false) {
  const extension = item.type === "video" ? "mp4" : "png";
  const base =
    (item.outputName || item.filename || `studio-${item.id}`)
      .replace(/[\\/:*?"<>|]/g, " ")
      .trim()
      .slice(0, 80) || "studio";
  const filename = /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`;
  const selected = mediaSource(item);
  const source = selected.url || "";
  let href = source;
  if (withoutSettings && source) {
    const url = new URL(source, window.location.origin);
    if (["http:", "https:"].includes(url.protocol)) {
      url.searchParams.set("clean", "1");
      href =
        source.startsWith("/") && !source.startsWith("//")
          ? `${url.pathname}${url.search}${url.hash}`
          : url.href;
    }
  }
  return {
    href,
    download: selected.upscaled ? filename.replace(/\.[^.]+$/, `.${extension}`) : filename,
  };
}
