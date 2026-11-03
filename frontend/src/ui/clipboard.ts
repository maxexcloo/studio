import { useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { failure } from "../api";

/**
 * Copies text from a menu item, which closes with nothing left to show the result, so it reports
 * "<label> copied" or a failure. Buttons use `useCopy`, showing the result on themselves.
 */
export function copyText(text: string, label: string): Promise<void> {
  return writeText(text).then(() => {
    notifications.show({ message: `${label} copied` });
  }, failure);
}

/** A copy button's copy: `copied` names what it copied last for a moment; failures still report. */
export function useCopy() {
  const [copied, setCopied] = useState<string>();
  const timer = useRef(0);
  return {
    copied,
    copy: (text: string, name = "text") =>
      void writeText(text).then(() => {
        setCopied(name);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(undefined), 1500);
      }, failure),
  };
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
