import type { MediaItem } from "../../types";

/** Display and transfer the version selected on the saved gallery item. */
export function mediaSource(item: MediaItem): {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  upscaled: boolean;
} {
  const upscale = item.upscaleActive && item.upscale?.url ? item.upscale : undefined;
  const url = upscale?.url || item.url;
  return {
    url,
    thumbnailUrl: upscale?.thumbnailUrl || item.thumbnailUrl,
    width: upscale?.width || item.width,
    height: upscale?.height || item.height,
    upscaled: Boolean(upscale),
  };
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
