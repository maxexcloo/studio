import { usePopoverContext } from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { type ComponentPropsWithRef, useLayoutEffect, useRef } from "react";

import { layerAbove, registerPopup } from "./popupClicks";

// Keep Mantine's root, refs, focus trap and Escape handler; expose only its native dismissal.
export function PopupRoot({ ref, onKeyDownCapture, ...props }: ComponentPropsWithRef<"div">) {
  const context = usePopoverContext();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => registerPopup(root.current!, context), [context]);
  return (
    <div
      {...props}
      ref={useMergedRef(ref, root)}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && layerAbove(root.current, event)) return;
        onKeyDownCapture?.(event);
        if (event.key === "Escape" && context.closeOnEscape) event.stopPropagation();
      }}
    />
  );
}
