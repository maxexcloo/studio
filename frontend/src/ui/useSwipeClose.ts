import { type TouchEvent, useRef } from "react";

import { closingPopup, layerAbove, popupLayer } from "./popupClicks";

/** Whether anything from `from` up to and including `to` is scrolled away from its top. */
function scrolled(from: Element, to: Element) {
  for (let element: Element | null = from; element; element = element.parentElement) {
    if (element.scrollTop > 0) return true;
    if (element === to) return false;
  }
  return false;
}

/**
 * Touch handlers for a phone drawer or sheet that a drag towards `direction` pulls with the finger
 * and, past 80 px, closes. A drag mostly across that direction is left alone, and a downward one
 * only pulls while the content under the finger is scrolled to its top, so lists still scroll.
 */
export function useSwipeClose(direction: "down" | "left", close: () => void, enabled = true) {
  const drag = useRef<{
    target: Element;
    x: number;
    y: number;
    moved: number;
    /** The element's own inline transition, set aside while the finger moves it. */
    transition?: string;
    transform?: string;
  } | null>(null);
  const down = direction === "down";
  function release(event: TouchEvent<HTMLElement>) {
    const start = drag.current;
    drag.current = null;
    if (start?.transition === undefined) return;
    event.currentTarget.style.transition = start.transition;
    if (event.type === "touchend" && event.cancelable) event.preventDefault();
    if (
      enabled &&
      start.moved > 80 &&
      event.type === "touchend" &&
      !layerAbove(event.currentTarget)
    ) {
      close();
    } else {
      event.currentTarget.style.transform = start.transform ?? "";
    }
  }
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const target = event.target as Element;
      const touch = event.touches[0];
      if (drag.current) release(event);
      drag.current =
        enabled &&
        event.touches.length === 1 &&
        event.currentTarget.contains(target) &&
        !target.closest(
          `${popupLayer}, input, textarea, select, [contenteditable], [role="slider"]`,
        ) &&
        !closingPopup() &&
        !layerAbove(event.currentTarget) &&
        !(down && scrolled(target, event.currentTarget))
          ? { target, x: touch.clientX, y: touch.clientY, moved: 0 }
          : null;
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const start = drag.current;
      if (!start) return;
      if (!enabled || event.touches.length !== 1) {
        release(event);
        return;
      }
      const touch = event.touches[0];
      const along = down ? touch.clientY - start.y : start.x - touch.clientX;
      const across = down ? touch.clientX - start.x : touch.clientY - start.y;
      if (start.transition === undefined && Math.max(Math.abs(along), Math.abs(across)) < 8) return;
      // The drag went across or back (scrolling the content), or the content scrolled under the
      // finger: it is not a pull, and the sheet is left alone so the content keeps the gesture.
      if (
        (start.transition === undefined && (along < 0 || Math.abs(across) > Math.abs(along))) ||
        (down && scrolled(start.target, event.currentTarget))
      ) {
        release(event);
        return;
      }
      start.moved = Math.max(0, along);
      start.transition ??= event.currentTarget.style.transition;
      start.transform ??= event.currentTarget.style.transform;
      event.currentTarget.style.transition = "none";
      event.currentTarget.style.transform = down
        ? `translateY(${start.moved}px)`
        : `translateX(${-start.moved}px)`;
    },
    onTouchEnd: release,
    onTouchCancel: release,
  };
}
