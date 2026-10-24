import { notifications } from "@mantine/notifications";
import { failure } from "../api";

/** Copies text and reports the outcome. LoraPicker still omits the label and reports it itself. */
export function copyText(text: string, label?: string): Promise<void> {
  const copied = writeText(text);
  if (!label) return copied;
  return copied.then(() => {
    notifications.show({ message: `${label} copied` });
  }, failure);
}
function writeText(text: string): Promise<void> {
  const fallback = () => {
    const input = document.createElement("textarea");
    input.value = text;
    input.readOnly = true;
    input.dataset.composerLayer = "";
    input.style.cssText = "position:fixed;left:-9999px;font-size:16px";
    (document.activeElement?.closest('[role="dialog"]') || document.body).appendChild(input);
    const previous = document.activeElement as HTMLElement | null;
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    previous?.focus({ preventScroll: true });
    if (!copied) throw new Error("Your browser could not copy the text.");
  };
  // Safari requires the clipboard request during the original tap.
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(fallback);
  try {
    fallback();
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}
