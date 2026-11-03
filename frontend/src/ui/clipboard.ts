import { notifications } from "@mantine/notifications";
import { failure } from "../api";

/** Copies text and reports the outcome as "<label> copied" or a failure. */
export function copyText(text: string, label: string): Promise<void> {
  return writeText(text).then(() => {
    notifications.show({ message: `${label} copied` });
  }, failure);
}
/**
 * Copies inside the tap itself, as iOS Safari requires: a selected text area and the copy command
 * first, since it answers there and then. Were the clipboard API tried first, a fallback after its
 * refusal would come after the tap, too late. The API serves browsers without the command.
 */
function writeText(text: string): Promise<void> {
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.dataset.composerLayer = "";
  input.style.cssText = "position:fixed;left:-9999px;font-size:16px";
  (document.activeElement?.closest('[role="dialog"]') || document.body).appendChild(input);
  const previous = document.activeElement as HTMLElement | null;
  input.select();
  // iOS selects nothing with select() alone.
  input.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // Browsers that dropped the command throw; the clipboard API remains.
  }
  input.remove();
  previous?.focus({ preventScroll: true });
  if (copied) return Promise.resolve();
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("Your browser could not copy the text."));
}
