import { notifications } from "@mantine/notifications";
import { failure } from "../api";

/** Copies text and reports the outcome as "<label> copied" or a failure. */
export function copyText(text: string, label: string): Promise<void> {
  return writeText(text).then(() => {
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
