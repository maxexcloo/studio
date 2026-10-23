import { useLocalStorage } from "@mantine/hooks";

export interface MediaTransfer {
  href: string;
  download: string;
}
export function useShareWithoutSettings() {
  return useLocalStorage<boolean>({
    key: "studio-share-without-settings",
    defaultValue: false,
    getInitialValueInEffect: false,
  });
}
export function canCopyMediaImage() {
  return (
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    (!ClipboardItem.supports || ClipboardItem.supports("image/png"))
  );
}
export function canShareMedia(type: "image" | "video") {
  if (!window.isSecureContext || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({
      files: [
        new File([new Uint8Array([0])], type === "video" ? "studio.mp4" : "studio.png", {
          type: type === "video" ? "video/mp4" : "image/png",
        }),
      ],
    });
  } catch {
    return false;
  }
}
function ownMediaUrl(href: string) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin)
    throw new Error("Save this media in Studio before copying or sharing it.");
  return url.href;
}
async function mediaBlob(target: MediaTransfer, signal?: AbortSignal) {
  const response = await fetch(ownMediaUrl(target.href), { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Studio could not prepare this media (${response.status}).`);
  return response.blob();
}
async function pngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare an image for the clipboard.");
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Your browser could not prepare an image for the clipboard.")),
      "image/png",
    ),
  );
}
export function downloadMedia(target: MediaTransfer) {
  const link = document.createElement("a");
  link.href = ownMediaUrl(target.href);
  link.download = target.download;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
/** ClipboardItem receives a promise so Safari sees the write during the original tap. */
export async function copyMediaImage(
  target: MediaTransfer,
  withoutSettings: boolean,
): Promise<"copied" | "downloaded"> {
  if (!canCopyMediaImage()) {
    downloadMedia(target);
    return "downloaded";
  }
  try {
    const png = mediaBlob(target).then((blob) =>
      blob.type === "image/png" && !withoutSettings ? blob : pngBlob(blob),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copied";
  } catch {
    downloadMedia(target);
    return "downloaded";
  }
}
export async function prepareMediaShare(target: MediaTransfer, signal?: AbortSignal) {
  const blob = await mediaBlob(target, signal);
  return new File([blob], target.download, { type: blob.type });
}
/** The file must already be prepared: native sharing requires the current user gesture. */
export async function sharePreparedMedia(
  file: File,
  target: MediaTransfer,
): Promise<"shared" | "cancelled" | "downloaded"> {
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return "shared";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  }
  downloadMedia(target);
  return "downloaded";
}
