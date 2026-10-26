import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Paper } from "@mantine/core";
import { useMotionDuration } from "../../ui/Appearance";
import classes from "./DreamPage.module.css";

export type Direction = "left" | "right" | "up";
/** Flies the card out in a direction; resolves once it has left. */
export type Fly = (direction: Direction) => Promise<void>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
// A flick this fast (px/ms) decides even below the distance threshold.
const flick = 0.6;

/**
 * The top card follows a finger or pointer, tilting with the drag, and flies out past a third of
 * its width (or up, where `up` is allowed); below that it springs back. Buttons and keys fly it
 * out the same way through `fly`. Motion follows the shared animation-speed token; with Off or
 * reduced motion it decides without animating.
 */
export function SwipeCard({
  children,
  depth,
  up,
  fly,
  onSwipe,
  label,
}: {
  children: ReactNode;
  /** 0 for the top card, 1 for the one waiting beneath it. */
  depth: number;
  up: boolean;
  fly?: RefObject<Fly | null>;
  onSwipe?: (direction: Direction) => void;
  label: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const duration = useMotionDuration();
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    t: number;
    vx: number;
    vy: number;
  } | null>(null);
  const leaving = useRef(false);

  function place(dx: number, dy: number) {
    const element = card.current!;
    const width = element.offsetWidth || 1;
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${(dx / width) * 14}deg)`;
    const threshold = width / 3;
    element.style.setProperty("--dream-keep", String(clamp(dx / threshold)));
    element.style.setProperty("--dream-discard", String(clamp(-dx / threshold)));
    element.style.setProperty(
      "--dream-up",
      String(up && -dy > Math.abs(dx) ? clamp(-dy / threshold) : 0),
    );
  }
  function out(direction: Direction) {
    const element = card.current;
    if (!element || leaving.current) return Promise.resolve();
    leaving.current = true;
    if (!duration) return Promise.resolve();
    const from = drag.current;
    const x =
      direction === "up" ? (from?.dx ?? 0) : (direction === "right" ? 1 : -1) * window.innerWidth;
    const y = direction === "up" ? -window.innerHeight : (from?.dy ?? 0) + 40;
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
        const width = event.currentTarget.offsetWidth;
        const threshold = width / 3;
        const { dx, dy, vx, vy } = current;
        const direction: Direction | null =
          up && -dy > Math.abs(dx) && (-dy > threshold || (-vy > flick && -dy > 40))
            ? "up"
            : dx > threshold || (vx > flick && dx > 40)
              ? "right"
              : dx < -threshold || (-vx > flick && dx < -40)
                ? "left"
                : null;
        if (!direction) {
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
      {!depth && (
        <>
          <span className={classes.hint} data-hint="keep" aria-hidden>
            Keep
          </span>
          <span className={classes.hint} data-hint="discard" aria-hidden>
            Discard
          </span>
          {up && (
            <span className={classes.hint} data-hint="up" aria-hidden>
              Variations
            </span>
          )}
        </>
      )}
    </Paper>
  );
}
