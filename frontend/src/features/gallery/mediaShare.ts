import { useEffect, useState } from "react";
import { notifications } from "@mantine/notifications";
import { failure } from "../../api";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { mediaDownload } from "./download";

interface MediaTransfer {
  href: string;
  download: string;
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
    throw new Error("Save this media in Studio before sharing it.");
  return url.href;
}
async function mediaBlob(target: MediaTransfer, signal?: AbortSignal) {
  const response = await fetch(ownMediaUrl(target.href), { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Studio could not prepare this media (${response.status}).`);
  return response.blob();
}
function downloadMedia(target: MediaTransfer) {
  const link = document.createElement("a");
  link.href = ownMediaUrl(target.href);
  link.download = target.download;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
 * Download and Share for one result. Phones prepare the share file while `active`
 * and keep it, so the Share tap itself can call the native share sheet.
 */
export function useMediaTransfer(item: MediaItem, active: boolean) {
  const phone = usePhone();
  const download = mediaDownload(item);
  const key = `${download.href}\n${download.download}`;
  const [prepared, setPrepared] = useState<{ key: string; file: File } | null>(null);
  const file = prepared?.key === key ? prepared.file : null;
  const [preparing, setPreparing] = useState(false);
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
  return {
    download,
    canShare,
    shareReady: Boolean(file),
    sharing: preparing || sharing,
    share,
  };
}
export type MediaTransferActions = ReturnType<typeof useMediaTransfer>;
