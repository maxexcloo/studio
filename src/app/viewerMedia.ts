import { mediaUrl } from './mediaUrl';
import type { GalleryItem } from './types';
import { upscaleDisplayThumbnail, upscaleDisplayUrl } from './useUpscale';

/** The longest edge of the server's display copy (server/thumbnails.js RENDITIONS.display). */
export const DISPLAY_EDGE = 2560;

/** The pixel size of the picture the viewer shows: the upscale when it is on, else the output. */
export function viewerMediaSize(item: GalleryItem): { width: number; height: number } | null {
  const source = item.upscaleActive && item.upscale?.url ? item.upscale : item;
  const width = Number(source?.width) || 0;
  const height = Number(source?.height) || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * What the viewer loads for a picture, smallest first: the grid's thumbnail
 * (usually cached already) as the placeholder, a display-sized WebP the
 * server keeps beside it, and the original, needed only past the display
 * copy's size. Outputs without a server thumbnail go straight to the original.
 */
export function viewerSources(item: GalleryItem) {
  const original = mediaUrl(upscaleDisplayUrl(item), item);
  const thumbnail = upscaleDisplayThumbnail(item) || '';
  const placeholder = thumbnail ? mediaUrl(thumbnail, item) : '';
  const display = thumbnail.startsWith('/comfy/thumb?') ? `${placeholder}&size=display` : original;
  return { placeholder: placeholder === original ? '' : placeholder, display, original };
}

/**
 * Whether the screen shows more of the picture than the display copy holds:
 * `scale` is screen pixels per original pixel (zoom × device pixel ratio).
 */
export function needsOriginal(item: GalleryItem, scale: number) {
  const size = viewerMediaSize(item);
  const longest = size ? Math.max(size.width, size.height) : 0;
  if (!longest || longest <= DISPLAY_EDGE) return false;
  return longest * scale > DISPLAY_EDGE * 1.02;
}
