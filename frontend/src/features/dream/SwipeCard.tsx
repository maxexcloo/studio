import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Paper } from "@mantine/core";
import { useMotionDuration } from "../../ui/Appearance";
import classes from "./DreamPage.module.css";

export type Direction = "left" | "right" | "up" | "down";
/** Flies the card out in a direction; resolves once it has left. */
export type Fly = (direction: Direction) => Promise<void>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
// A flick this fast (px/ms) decides even below the distance threshold.
const flick = 0.6;
// A press that moves less than this is a tap.
const tap = 6;

/**
 * The top card follows a finger or pointer, tilting with the drag, and flies out past a third of
 * its width in a direction `hints` names (the word showing while dragging that way); below that it
 * springs back, and a tap calls `onTap` with the element pressed. Buttons and keys fly it out the
 * same way through `fly`. Motion follows the shared animation-speed token; with Off or reduced
 * motion it decides without animating.
 */
export function SwipeCard({
  children,
  depth,
  fly,
  onSwipe,
  onTap,
  label,
  hints,
  pair,
}: {
  children: ReactNode;
  /** 0 for the top card, 1 for the one waiting beneath it. */
  depth: number;
  fly?: RefObject<Fly | null>;
  onSwipe?: (direction: Direction) => void;
  onTap?: (target: HTMLElement) => void;
  label: string;
  hints: Partial<Record<Direction, string>>;
  /** Two images side by side, each answering for one side. */
  pair?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const duration = useMotionDuration();
  const drag = useRef<{
    id: number;
    target: HTMLElement;
    x: number;
    y: number;
    dx: number;
    dy: number;
    t: number;
    vx: number;
    vy: number;
  } | null>(null);
  const leaving = useRef(false);
  /** The direction a drag leans: its larger axis, where that way is allowed. */
  function lean(dx: number, dy: number): Direction | null {
    const direction: Direction =
      Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "up" : "down") : dx < 0 ? "left" : "right";
    return hints[direction] ? direction : null;
  }

  function place(dx: number, dy: number) {
    const element = card.current!;
    const width = element.offsetWidth || 1;
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${(dx / width) * 14}deg)`;
    const threshold = width / 3;
    const toward = lean(dx, dy);
    for (const direction of ["left", "right", "up", "down"] as const)
      element.style.setProperty(
        `--dream-${direction}`,
        String(
          toward === direction
            ? clamp(
                (direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy)) /
                  threshold,
              )
            : 0,
        ),
      );
  }
  function out(direction: Direction) {
    const element = card.current;
    if (!element || leaving.current) return Promise.resolve();
    leaving.current = true;
    if (!duration) return Promise.resolve();
    const from = drag.current;
    const vertical = direction === "up" || direction === "down";
    const x = vertical ? (from?.dx ?? 0) : (direction === "right" ? 1 : -1) * window.innerWidth;
    const y = vertical ? (direction === "up" ? -1 : 1) * window.innerHeight : (from?.dy ?? 0) + 40;
    element.style.transition = `transform ${duration * 2}ms cubic-bezier(.2,.7,.3,1), opacity ${duration * 2}ms ease`;
    place(x, y);
    element.style.opacity = "0";
    return new Promise<void>((resolve) => {
      // transitionend may not fire if the card is hidden or the transition is skipped.
      const timer = setTimeout(resolve, duration * 2 + 50);
      element.addEventListener(
        "transitionend",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  useEffect(() => {
    if (!fly || depth) return;
    fly.current = out;
    return () => {
      if (fly.current === out) fly.current = null;
    };
  });

  const settle = () => {
    const element = card.current!;
    element.style.transition = `transform ${duration * 2.5}ms cubic-bezier(.34,1.56,.64,1)`;
    place(0, 0);
    element.style.transform = "";
  };
  return (
    <Paper
      ref={card}
      withBorder
      radius="lg"
      className={classes.card}
      data-depth={depth}
      data-pair={pair || undefined}
      role="group"
      aria-roledescription="card"
      aria-label={label}
      aria-hidden={depth ? true : undefined}
      onPointerDown={(event) => {
        if (depth || leaving.current || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button, a")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.transition = "none";
        drag.current = {
          id: event.pointerId,
          target: event.target as HTMLElement,
          x: event.clientX,
          y: event.clientY,
          dx: 0,
          dy: 0,
          t: event.timeStamp,
          vx: 0,
          vy: 0,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        const elapsed = Math.max(1, event.timeStamp - current.t);
        drag.current = {
          ...current,
          dx,
          dy,
          t: event.timeStamp,
          vx: (dx - current.dx) / elapsed,
          vy: (dy - current.dy) / elapsed,
        };
        place(dx, dy);
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const { dx, dy, vx, vy, target } = current;
        if (Math.abs(dx) < tap && Math.abs(dy) < tap) {
          drag.current = null;
          settle();
          return onTap?.(target);
        }
        const threshold = event.currentTarget.offsetWidth / 3;
        const direction = lean(dx, dy);
        const vertical = direction === "up" || direction === "down";
        const distance = vertical ? Math.abs(dy) : Math.abs(dx);
        const speed = vertical ? (direction === "up" ? -vy : vy) : direction === "left" ? -vx : vx;
        if (!direction || (distance < threshold && !(speed > flick && distance > 40))) {
          drag.current = null;
          return settle();
        }
        void out(direction).then(() => onSwipe?.(direction));
      }}
      onPointerCancel={() => {
        if (!drag.current) return;
        drag.current = null;
        settle();
      }}
    >
      {children}
      {!depth &&
        (Object.entries(hints) as [Direction, string][]).map(([direction, hint]) => (
          <span key={direction} className={classes.hint} data-hint={direction} aria-hidden>
            {hint}
          </span>
        ))}
    </Paper>
  );
}
