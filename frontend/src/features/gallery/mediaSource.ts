import type { MediaItem } from "../../types";
import { displayEdge } from "../../../../shared/media";

/**
 * Display and transfer the version selected on the saved gallery item. `displayUrl` is what screens
 * show: the server's display copy of a picture no larger than it, otherwise the original `url`,
 * which downloads, shares and edits always use.
 */
export function mediaSource(item: MediaItem): {
  url: string;
  displayUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  upscaled: boolean;
} {
  const upscale = item.upscaleActive && item.upscale?.url ? item.upscale : undefined;
  const url = upscale?.url || item.url;
  const thumbnailUrl = upscale?.thumbnailUrl || item.thumbnailUrl;
  const width = upscale?.width || item.width;
  const height = upscale?.height || item.height;
  const longest = Math.max(width || 0, height || 0);
  return {
    url,
    displayUrl:
      item.type === "image" &&
      thumbnailUrl?.startsWith("/comfy/thumb?") &&
      longest &&
      longest <= displayEdge
        ? `${thumbnailUrl}&size=display`
        : url,
    thumbnailUrl,
    width,
    height,
    upscaled: Boolean(upscale),
  };
}

/**
 * Where a video plays: Studio's copy that iOS Safari plays (backend getComfyVideoPlayback), the
 * original itself when it already does. Downloads and shares keep the original's address.
 */
export function playbackUrl(url: string) {
  return url.startsWith("/comfy/view?")
    ? `${url.replace("/comfy/view?", "/comfy/video-preview?")}&format=play`
    : url;
}

/**
 * The listed version of an open item: the same record, or the result that took its pending tile's
 * place (a saved result gets a new ID), so a viewer opened on running work follows it to the result.
 */
export function currentMedia(items: MediaItem[], item: MediaItem) {
  return (
    items.find((candidate) => candidate.id === item.id) ||
    (item.jobId && item.index !== undefined
      ? items.find((candidate) => candidate.jobId === item.jobId && candidate.index === item.index)
      : undefined) ||
    item
  );
}
