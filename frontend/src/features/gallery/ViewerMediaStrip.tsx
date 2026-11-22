import { type PointerEvent, useEffect, useMemo, useRef } from "react";

import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { mediaSource } from "./mediaSource";
import { type SwipeDirection, type SwipeGesture, dragAxis, swipeDirection } from "./swipe";

import classes from "./MediaViewer.module.css";

/**
 * Touch swipes over media that has no zoom of its own: running work and videos. Lifting reports
 * whether the touch was a tap: short, and barely moving.
 */
export function useTouchSwipe(swipe: SwipeGesture) {
  const start = useRef<{
    id: number;
    at: number;
    x: number;
    y: number;
    drag?: "x" | "y";
  } | null>(null);
  return {
    onPointerDown(event: PointerEvent) {
      start.current =
        event.pointerType === "touch"
          ? { id: event.pointerId, at: event.timeStamp, x: event.clientX, y: event.clientY }
          : null;
    },
    onPointerMove(event: PointerEvent) {
      const from = start.current;
      if (from?.id !== event.pointerId) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      from.drag ??= dragAxis(dx, dy);
      if (from.drag) swipe.move(from.drag === "x" ? dx : 0, from.drag === "y" ? dy : 0);
    },
    onPointerUp(event: PointerEvent) {
      const from = start.current;
      start.current = null;
      if (from?.id !== event.pointerId) return false;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      const direction = swipeDirection(dx, dy);
      if (direction || from.drag) swipe.release(direction);
      return !direction && Math.hypot(dx, dy) < 10 && event.timeStamp - from.at < 500;
    },
    onPointerCancel(event: PointerEvent) {
      if (start.current?.id !== event.pointerId) return;
      if (start.current.drag) swipe.release();
      start.current = null;
    },
  };
}

/**
 * The strip the current media sits in between its neighbours, which follows a dragging finger a
 * frame at a time without rendering. Lifting settles it onto the neighbour it was pulled towards,
 * then `swipe` moves there (true when it did); past the first or last item it resists and slides
 * back. A drag down shrinks the media towards closing, and stays as the viewer closes.
 */
export function useStrip(
  ends: { previous: boolean; next: boolean },
  swipe: (direction: SwipeDirection) => boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotionDuration();
  const latest = useRef({ ends, swipe, motion });
  latest.current = { ends, swipe, motion };
  const frame = useRef(0);
  const settling = useRef(false);
  const landed = useRef(false);
  const place = (transform: string, animate: boolean) => {
    const node = ref.current;
    if (!node) return;
    node.style.transition = animate ? "" : "none";
    node.style.transform = transform;
  };
  const gesture = useMemo<SwipeGesture>(
    () => ({
      move(dx, dy) {
        if (settling.current) return;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const { ends } = latest.current;
          const x = (dx < 0 ? ends.next : ends.previous) ? dx : dx / 3;
          place(
            dy > 0
              ? `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 2000})`
              : dy < 0
                ? ""
                : `translateX(${x}px)`,
            false,
          );
        });
      },
      release(direction) {
        cancelAnimationFrame(frame.current);
        if (settling.current) return;
        const { ends, swipe, motion } = latest.current;
        const side =
          (direction === "left" && ends.next && "next") ||
          (direction === "right" && ends.previous && "previous");
        const node = ref.current;
        if (side && node) {
          settling.current = true;
          let timer = 0;
          const settled = (event?: TransitionEvent) => {
            if (event && event.target !== node) return;
            node.removeEventListener("transitionend", settled);
            clearTimeout(timer);
            settling.current = false;
            if (!node.isConnected) return;
            landed.current = swipe(direction!);
            if (!landed.current) place("", true);
          };
          node.addEventListener("transitionend", settled);
          // Reduced motion, or a transform that hardly moves, may end without the event.
          timer = window.setTimeout(settled, motion + 100);
          place(
            `translateX(calc(${side === "next" ? "-100% - " : "100% + "}var(--mantine-spacing-md)))`,
            true,
          );
          return;
        }
        if (direction === "down") swipe(direction);
        else {
          place("", true);
          if (direction === "up") swipe(direction);
        }
      },
    }),
    [],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  /** Once the neighbour it settled on is the current item, the strip returns to centre unseen. */
  const arrived = () => {
    if (!landed.current) return;
    landed.current = false;
    place("", false);
  };
  return { ref, gesture, arrived, settling };
}

/** A neighbour waiting beside the current media: its display copy, or a video's still. */
export function Neighbour({ item, side }: { item?: MediaItem; side: "previous" | "next" }) {
  if (!item?.url) return null;
  const source = mediaSource(item);
  return (
    <div className={classes.neighbour} data-side={side} aria-hidden>
      <img
        src={item.type === "video" ? source.thumbnailUrl : source.displayUrl}
        alt=""
        decoding="async"
        fetchPriority="low"
        draggable={false}
        width={source.width}
        height={source.height}
      />
    </div>
  );
}
