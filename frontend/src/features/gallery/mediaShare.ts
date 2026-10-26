import { useEffect, useState } from "react";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { failure } from "../../api";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { mediaDownload } from "./download";

interface MediaTransfer {
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
function canCopyMediaImage() {
  return (
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    (!ClipboardItem.supports || ClipboardItem.supports("image/png"))
  );
}
function canShareMedia(type: "image" | "video") {
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
function downloadMedia(target: MediaTransfer) {
  const link = document.createElement("a");
  link.href = ownMediaUrl(target.href);
  link.download = target.download;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
/** ClipboardItem receives a promise so Safari sees the write during the original tap. */
async function copyMediaImage(
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
async function prepareMediaShare(target: MediaTransfer, signal?: AbortSignal) {
  const blob = await mediaBlob(target, signal);
  return new File([blob], target.download, { type: blob.type });
}
/** The file must already be prepared: native sharing requires the current user gesture. */
async function sharePreparedMedia(
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
/**
 * Download, Copy Image and Share for one result. Phones prepare the share file while `active`
 * and keep it, so the Share tap itself can call the native share sheet.
 */
export function useMediaTransfer(item: MediaItem, active: boolean) {
  const phone = usePhone();
  const [withoutSettings] = useShareWithoutSettings();
  const download = mediaDownload(item, withoutSettings);
  const key = `${download.href}\n${download.download}`;
  const [prepared, setPrepared] = useState<{ key: string; file: File } | null>(null);
  const file = prepared?.key === key ? prepared.file : null;
  const [preparing, setPreparing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canShare = Boolean(item.url) && phone && canShareMedia(item.type);
  useEffect(() => {
    if (!active || file || !canShare || item.type !== "image" || !download.href) return;
    const controller = new AbortController();
    setPreparing(true);
    void prepareMediaShare(download, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setPrepared({ key, file });
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setPreparing(false);
      });
    return () => {
      controller.abort();
      setPreparing(false);
    };
  }, [key, item.type, canShare, active]);
  async function share() {
    if (!file) {
      setPreparing(true);
      try {
        setPrepared({ key, file: await prepareMediaShare(download) });
      } catch (error) {
        failure(error);
      } finally {
        setPreparing(false);
      }
      return;
    }
    setSharing(true);
    try {
      const result = await sharePreparedMedia(file, download);
      if (result === "downloaded")
        notifications.show({ message: "Sharing is unavailable. Download started." });
    } catch (error) {
      failure(error);
    } finally {
      setSharing(false);
    }
  }
  async function copyImage() {
    setCopying(true);
    try {
      const result = await copyMediaImage(download, withoutSettings);
      notifications.show({
        message: result === "copied" ? "Image copied" : "Clipboard unavailable. Download started.",
      });
    } catch (error) {
      failure(error);
    } finally {
      setCopying(false);
    }
  }
  return {
    download,
    canCopy: Boolean(item.url) && item.type === "image" && canCopyMediaImage(),
    copying,
    copyImage,
    canShare,
    shareReady: Boolean(file),
    sharing: preparing || sharing,
    share,
  };
}
export type MediaTransferActions = ReturnType<typeof useMediaTransfer>;
