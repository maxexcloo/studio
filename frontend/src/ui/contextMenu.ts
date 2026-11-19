import type { KeyboardEvent, MouseEvent } from "react";

import { closingPopup } from "./popupClicks";

const editing = (target: EventTarget) =>
  target instanceof Element &&
  target.closest("textarea, input:not([type=checkbox], [type=radio]), [contenteditable=true]");

/** Opens an item's usual anchored menu on secondary click or the keyboard shortcuts. */
export function contextMenuHandlers(open: () => void) {
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || editing(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!closingPopup()) open();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (
        (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) ||
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        editing(event.target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      open();
    },
  };
}
