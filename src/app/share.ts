import type { GalleryItem } from './types';
import type { ShowToast } from './toast';
import { sharesWithoutSettings } from './shareSettings';
import { upscaleDisplayUrl } from './useUpscale';

/**
 * Hidden files are served inline; asking for an attachment gets them a real
 * file name. "Share without settings" asks the server for the file without
 * the prompt and workflow inside it.
 */
export function downloadUrl(item: GalleryItem) {
  const url = upscaleDisplayUrl(item) || "";
  const params = [item.privateVault ? "download=1" : "", url && sharesWithoutSettings(item) ? "clean=1" : ""].filter(Boolean).join("&");
  return params ? `${url}${url.includes("?") ? "&" : "?"}${params}` : url;
}

// The file is fetched when the actions open, so the share itself runs inside the
// tap: iOS only allows the share sheet straight from a user gesture.
const shareBlobs = new Map<string, Promise<Blob>>();

/** Web Share with files needs a secure page; over plain http on the LAN it is not there. */
/** Whether the browser's share sheet takes files; iOS's includes Save Image. */
export const canShareFiles = (() => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || !window.isSecureContext || !('share' in navigator)) return false;
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'image.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
})();

export function prefetchShare(item: GalleryItem | null, includeVideo = false) {
  if (!item?.url || !canShareFiles) return;
  // Opening a video must not also fetch a second full copy into a share Blob.
  if (item.type === 'video' && !includeVideo) return;
  const url = downloadUrl(item);
  if (!shareBlobs.has(url)) shareBlobs.set(url, fetch(url).then((response) => response.ok ? response.blob() : Promise.reject(new Error('fetch failed'))));
}

/** A file name from the prompt, for downloads and shared files. */
export function downloadName(item: GalleryItem, type = '') {
  const base = String(item.outputName || item.filename || 'studio').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'studio';
  if (/\.\w{2,4}$/.test(base)) return base;
  return `${base}.${type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : item.type === 'video' ? 'mp4' : 'png'}`;
}

/** Share where the phone can (Photos, Messages, AirDrop…), otherwise save the file. */
export async function shareItem(item: GalleryItem, showToast: ShowToast) {
  const url = downloadUrl(item);
  if (canShareFiles) {
    try {
      prefetchShare(item, true);
      const blob = await shareBlobs.get(url)!;
      const file = new File([blob], downloadName(item, blob.type), { type: blob.type || 'image/png' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  downloadItem(item);
  if (!canShareFiles) showToast('Saved to downloads', 'success');
}

/** Saves one file through a temporary link, named from its prompt. */
export function downloadItem(item: GalleryItem) {
  const link = document.createElement('a');
  link.href = downloadUrl(item);
  link.download = downloadName(item);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Several files: one share sheet where possible, otherwise one download after another. */
export async function shareItems(items: GalleryItem[], showToast: ShowToast) {
  const ready = items.filter((item) => item.status === 'done' && item.url);
  if (!ready.length) return;
  if (ready.length === 1) return shareItem(ready[0], showToast);
  if (canShareFiles) {
    try {
      ready.forEach((item) => prefetchShare(item, true));
      const files = await Promise.all(ready.map(async (item) => {
        const blob = await shareBlobs.get(downloadUrl(item))!;
        return new File([blob], downloadName(item, blob.type), { type: blob.type || 'image/png' });
      }));
      if (!navigator.canShare || navigator.canShare({ files })) {
        await navigator.share({ files });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  await downloadItems(ready, showToast);
}

export async function downloadItems(items: GalleryItem[], showToast: ShowToast) {
  const ready = items.filter((item) => item.status === 'done' && item.url);
  if (!ready.length) return;
  for (const item of ready) {
    downloadItem(item);
    // Browsers drop downloads fired in one burst.
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  showToast(`Saved ${ready.length} items to downloads`, 'success');
}
