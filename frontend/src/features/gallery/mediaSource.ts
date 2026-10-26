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
