import { useEffect, useRef } from 'react';
import type React from 'react';
import { startLoraSync, subscribeLoraLibrary, subscribeLoraSync, type LoraSyncStatus } from './lora-storage';
import { showToastTone as showToast } from './toast';
import type { GalleryItem, Mode } from './types';

export const OPEN_DIALOG = '[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]';

/** Page-wide guards: the platform and mode classes the CSS reads, and file drops no drop zone claimed. */
export function useWindowGuards(mode: Mode) {
  // Chrome on Windows can hand playing videos to a hardware layer that frosted
  // glass can't blur, so the glass over the video gallery shows it through.
  // There, in video mode, the glass turns nearly opaque (16-system.css).
  useEffect(() => {
    const root = document.documentElement;
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
    root.classList.toggle("is-windows", /^win/i.test(platform));
    root.classList.toggle("is-video-mode", mode === "video");
  }, [mode]);
  // A file dropped outside a drop zone would make the browser open it and
  // leave the app. Swallow file drags the zones haven't claimed.
  useEffect(() => {
    const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));
    function onDragOver(event: DragEvent) {
      if (!isFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    }
    function onDrop(event: DragEvent) {
      if (isFileDrag(event)) event.preventDefault();
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}

/** The LoRA library's sync with the server, and its change count for whoever lists it. */
export function useLoraSync(onLibraryChange: () => void) {
  // The LoRA library lives on the server and syncs edit by edit. Speak up only
  // when edits are actually stuck (a server restart with nothing to sync is not
  // worth an error), and say so again once they have gone through.
  const loraSyncFailing = useRef(false);
  useEffect(() => {
    const stop = startLoraSync();
    const offLibrary = subscribeLoraLibrary(() => onLibraryChange());
    const offSync = subscribeLoraSync((sync: LoraSyncStatus) => {
      if (sync.failing && sync.pending > 0 && !loraSyncFailing.current) {
        showToast(sync.locked
          ? "LoRA changes are saved on this device. Sign in again to sync them."
          : "Can’t reach Studio. LoRA changes are saved on this device and sync when it’s back.", "error");
      } else if (!sync.failing && loraSyncFailing.current && !sync.pending) {
        showToast("LoRA changes synced", "success");
      }
      if (!sync.failing || sync.pending > 0) loraSyncFailing.current = sync.failing && sync.pending > 0;
    });
    return () => { stop(); offLibrary(); offSync(); };
  }, []);
}

/** Escape closes the topmost surface, typing anywhere goes to the prompt, and the page holds still under an overlay. */
export function useAppKeys({ active, setActive, settings, setSettings, workflowGalleryOpen, setWorkflowGalleryOpen, promptRef }: {
  active: GalleryItem | null;
  setActive: (item: GalleryItem | null) => void;
  settings: boolean;
  setSettings: (open: boolean) => void;
  workflowGalleryOpen: boolean;
  setWorkflowGalleryOpen: (open: boolean) => void;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => {
    if (!active && !settings && !workflowGalleryOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active, settings, workflowGalleryOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector(OPEN_DIALOG)) return;
      if (event.defaultPrevented || document.fullscreenElement) return;
      if (event.key !== "Escape") return;
      if (settings) {
        event.preventDefault();
        setSettings(false);
        return;
      }
      if (workflowGalleryOpen) {
        event.preventDefault();
        setWorkflowGalleryOpen(false);
        return;
      }
      if (active) {
        event.preventDefault();
        setActive(null);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, active, workflowGalleryOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector(OPEN_DIALOG)) return;
      if (settings || active) return;
      // AltGr types @ { \ € on many layouts; Windows reports it as Ctrl+Alt.
      const altGraph = event.getModifierState("AltGraph") || (event.ctrlKey && event.altKey);
      if (!altGraph && (event.ctrlKey || event.metaKey || event.altKey)) return;
      if (event.key.length !== 1 && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='listbox'], [data-radix-popper-content-wrapper]")) return;
      promptRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [settings, active]);
}
