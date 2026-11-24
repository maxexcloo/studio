import { useEffect, useRef } from "react";

const holdTime = 500;
const holdSlop = 10;

/**
 * A button whose click acts and whose hold, right-click, Menu key or Shift+F10 calls `open`
 * instead (such as Pass and Decline opening their reason picker). Spread the handlers on the
 * button and skip the click where `consumeClick` answers true. A hold cancels on movement and its
 * release does nothing more; a change of `key` (the item it acts on) drops a press in progress.
 */
export function useHold(key: string, open: () => void) {
  const press = useRef<{ x: number; y: number; timer: number }>(undefined);
  const suppressClick = useRef(false);
  function stop() {
    window.clearTimeout(press.current?.timer);
    press.current = undefined;
  }
  function cancel() {
    if (press.current) suppressClick.current = true;
    stop();
  }
  useEffect(() => stop, [key]);
  return {
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
      stop();
      if (!event.isPrimary) {
        suppressClick.current = true;
        return;
      }
      if (event.button !== 0) return;
      suppressClick.current = false;
      const button = event.currentTarget;
      button.setPointerCapture(event.pointerId);
      press.current = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          suppressClick.current = true;
          button.focus({ preventScroll: true });
          open();
        }, holdTime),
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
      const start = press.current;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= holdSlop)
        return;
      cancel();
    },
    onPointerUp: stop,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      if (event.button === 2) open();
    },
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      open();
    },
    consumeClick(event: React.MouseEvent<HTMLButtonElement>) {
      if (!event.detail || !suppressClick.current) return false;
      suppressClick.current = false;
      return true;
    },
  };
}
