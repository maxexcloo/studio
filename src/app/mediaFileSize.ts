import React from 'react';
import { mediaUrl } from './mediaUrl';
import { upscaleDisplayUrl } from './useUpscale';
import type { GalleryItem } from './types';

/*
 * The size of the file the viewer shows, for Details › Output › Size. Gallery
 * records don't store it, so it is read from the media itself: one byte asked
 * for with a Range request, whose Content-Range carries the whole length (or a
 * full answer's Content-Length, its body left unread). Asked once per address.
 */

const sizes = new Map<string, Promise<number>>();

async function readSize(url: string) {
  const controller = new AbortController();
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal, credentials: 'same-origin' });
    if (!response.ok) return 0;
    const range = Number(response.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1] || 0);
    if (range) return range;
    const length = Number(response.headers.get('content-length') || 0);
    // A data: or blob: address has no headers to read; its body is already in memory.
    if (!length && /^(data|blob):/i.test(url)) return (await response.blob()).size;
    return response.status === 200 ? length : 0;
  } catch {
    return 0;
  } finally {
    controller.abort();
  }
}

/** The shown file's size in bytes, or 0 while unknown (and where it can't be known). */
export function useMediaFileSize(item: GalleryItem | null | undefined) {
  const url = item && item.status === 'done' ? mediaUrl(upscaleDisplayUrl(item), item) : '';
  const [size, setSize] = React.useState<{ url: string; bytes: number }>({ url: '', bytes: 0 });
  React.useEffect(() => {
    if (!url) return;
    let live = true;
    if (!sizes.has(url)) sizes.set(url, readSize(url));
    void sizes.get(url)!.then((bytes) => {
      if (!bytes) sizes.delete(url);
      if (live) setSize({ url, bytes });
    });
    return () => { live = false; };
  }, [url]);
  return size.url === url ? size.bytes : 0;
}
