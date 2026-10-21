import { copyImage, copyText } from './api';
import { showToastTone as showToast } from './toast';
import type { GalleryItem, PreviousExit } from './types';

/**
 * Copies for a button that shows its own check (useCopyFeedback), so only a
 * failure is a toast. `announce` says it in a toast instead, for the few
 * buttons that are gone once clicked (a tile's menu).
 */
export async function copyToClipboard(text: string, announce = ""): Promise<boolean> {
  if (!text) {
    showToast("Nothing to copy", "error");
    return false;
  }
  const copied = await copyText(text);
  if (!copied) showToast("Couldn’t copy", "error");
  else if (announce) showToast(announce, "success");
  return copied;
}

/** The viewer's copy button: the image itself, its link, or its details. */
export async function copyItemToClipboard(item: GalleryItem): Promise<boolean> {
  const copied = await copyImage(item);
  if (!copied) showToast("Couldn’t copy", "error");
  return copied;
}

/** How the last run stopped, when nobody meant it to: told once per stop, on this computer. */
export function tellPreviousExit(exit: PreviousExit) {
  const key = `studio:exit-told:${exit.at}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* told this session at most */ }
  const when = new Date(exit.lastSeen || exit.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const details = [`Studio stopped: ${exit.reason}`, `Last seen running: ${new Date(exit.lastSeen || exit.at).toISOString()}`, exit.code !== null ? `Exit code: ${exit.code}` : "", exit.signal ? `Signal: ${exit.signal}` : "", exit.detail ? `\nLast output:\n${exit.detail}` : ""].filter(Boolean).join("\n");
  showToast(`Studio stopped unexpectedly last time: ${exit.reason.replace(/\.?$/, "")}, last seen running ${when}`, "warning", {
    duration: 20_000,
    action: { label: "Copy Details", onClick: () => { void copyToClipboard(details, "Details copied"); } }
  });
}
