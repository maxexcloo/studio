import { Group, Paper, SegmentedControl } from "@mantine/core";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { letter } from "../../../../shared/compare";
import { easing } from "../../theme";
import { useMotionDuration } from "../../ui/Appearance";
import { VideoPlayButton } from "../gallery/VideoPlayButton";
import { useDreamPlayback } from "./DeckMedia";

import classes from "./DreamPage.module.css";

const solid = {
  background: "var(--mantine-color-body)",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
};

export type Direction = "left" | "right" | "up" | "down";
/** Flies the card out in a direction; resolves once it has left. */
export type Fly = (direction: Direction) => Promise<void>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
// A flick this fast (px/ms) decides even below the distance threshold.
const flick = 0.6;
// A press that moves less than this is a tap.
const tapDistance = 6;
// A still press this long (ms) is a hold.
const holdTime = 500;
// A released card leaves within these times (ms), at the finger's speed where they allow.
const releaseTimes = { min: 80, max: 200 };

/**
 * The top card follows a finger or pointer, tilting with the drag while motion is on, and flies
 * out past a third of its width in a direction `hints` names (the word showing while dragging that way); below that it
 * springs back. A tap calls `onTap` with the element pressed, and a hold or a second finger (a
 * pinch) calls `onHold` with it; its release does nothing more. Presses on controls, scrolling
 * text (`data-scrolls`) stay theirs. In fullscreen the viewer handles the gestures.
 * Buttons and keys fly it out the same way through `fly`. Motion follows the shared
 * animation-speed token; with Off or reduced motion it decides without animating.
 */
export function SwipeCard({
  children,
  depth,
  paused = false,
  video,
  view,
  full = false,
  fly,
  onSwipe,
  onTap,
  onHold,
  label,
  hints,
  comparisonSize,
}: {
  children: ReactNode;
  /** 0 for the top card, 1 for the one waiting beneath it. */
  depth: number;
  paused?: boolean;
  video?: boolean;
  view?: ReactNode;
  /** Edge to edge, filling the preview. */
  full?: boolean;
  fly?: RefObject<Fly | null>;
  onSwipe?: (direction: Direction) => boolean;
  onTap?: (target: HTMLElement) => void;
  onHold?: (target: HTMLElement) => void;
  label: string;
  hints: Partial<Record<Direction, string>>;
  comparisonSize?: number;
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
  const dragged = useRef(false);
  const holding = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holding.current), []);
  const [audioSide, setAudioSide] = useState("0");
  const playing = Boolean(video && !depth && !paused);
  const audioOptions = playing ? comparisonSize : undefined;
  const { play, sound } = useDreamPlayback(
    card,
    playing,
    undefined,
    audioOptions ? audioSide : undefined,
  );
  /** Ends the press as a hold: the card settles and the release opens nothing. */
  function hold() {
    clearTimeout(holding.current);
    const target = drag.current?.target;
    if (!target) return;
    drag.current = null;
    settle();
    onHold?.(target);
  }
  /** The direction a drag leans: its larger axis, where that way is allowed. */
  function lean(dx: number, dy: number): Direction | null {
    const direction: Direction =
      Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "up" : "down") : dx < 0 ? "left" : "right";
    return hints[direction] ? direction : null;
  }

  function place(dx: number, dy: number) {
    const element = card.current!;
    const width = element.offsetWidth || 1;
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${duration ? (dx / width) * 14 : 0}deg)`;
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
    // A released drag carries on at the finger's speed and slows to a stop; buttons and keys
    // accelerate the card away.
    let time = duration;
    let curve: string = easing.exit;
    if (from) {
      const remaining = vertical ? Math.abs(y - from.dy) : Math.abs(x - from.dx);
      const speed = Math.abs(vertical ? from.vy : from.vx);
      time = Math.round(
        Math.min(releaseTimes.max, Math.max(releaseTimes.min, remaining / 0.58 / speed)),
      );
      curve = easing.release;
    }
    element.style.transition = `transform ${time}ms ${curve}, opacity ${time}ms ${curve}`;
    delete element.dataset.dragging;
    place(x, y);
    element.style.opacity = "0";
    return new Promise<void>((resolve) => {
      // transitionend may not fire if the card is hidden or the transition is skipped.
      const timer = setTimeout(resolve, time + 50);
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
    element.style.transition = `transform ${duration}ms ${easing.enter}`;
    delete element.dataset.dragging;
    place(0, 0);
    element.style.transform = "";
  };
  return (
    <Paper
      ref={card}
      withBorder={!full}
      radius={full ? 0 : "lg"}
      // Full screen is solid: glass under a fading modal shows its blur late in WebKit.
      styles={full ? { root: solid } : undefined}
      className={classes.card}
      data-depth={depth}
      data-pair={Boolean(comparisonSize) || undefined}
      data-full={full || undefined}
      role="group"
      aria-roledescription="card"
      aria-label={label}
      aria-hidden={depth ? true : undefined}
      inert={depth ? true : undefined}
      onPointerDown={(event) => {
        if (depth || full || leaving.current || event.button !== 0) return;
        if (drag.current && drag.current.id !== event.pointerId) return hold();
        dragged.current = false;
        const pressed = event.target as HTMLElement;
        // A zoomable picture is itself a button, and swipes like any other media.
        const control = pressed.closest("button, a");
        if (
          (control &&
            !(control.closest("[data-zoom-mode]") && !control.closest("[data-zoom-controls]"))) ||
          pressed.closest("[data-scrolls], [data-zoomed]")
        )
          return;
        clearTimeout(holding.current);
        holding.current = setTimeout(hold, holdTime);
        // Captured where pressed, so the media beneath (its zoom) still sees the press through.
        pressed.setPointerCapture(event.pointerId);
        event.currentTarget.style.transition = "none";
        event.currentTarget.dataset.dragging = "";
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
        if (Math.abs(dx) >= tapDistance || Math.abs(dy) >= tapDistance)
          clearTimeout(holding.current);
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
        clearTimeout(holding.current);
        const { dx, dy, vx, vy, target } = current;
        if (Math.abs(dx) < tapDistance && Math.abs(dy) < tapDistance) {
          drag.current = null;
          settle();
          return onTap?.(target);
        }
        dragged.current = true;
        const threshold = event.currentTarget.offsetWidth / 3;
        const direction = lean(dx, dy);
        const vertical = direction === "up" || direction === "down";
        const distance = vertical ? Math.abs(dy) : Math.abs(dx);
        const speed = vertical ? (direction === "up" ? -vy : vy) : direction === "left" ? -vx : vx;
        if (!direction || (distance < threshold && !(speed > flick && distance > 40))) {
          drag.current = null;
          return settle();
        }
        const leaving = onSwipe?.(direction);
        drag.current = null;
        if (!leaving) settle();
      }}
      onPointerCancel={() => {
        clearTimeout(holding.current);
        if (!drag.current) return;
        drag.current = null;
        settle();
      }}
      // The click a drag's release may send is not a tap.
      onClickCapture={(event) => {
        if (!dragged.current || event.detail === 0) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
      {(view || playing) && (
        <Group
          className={view ? classes.cardControls : classes.videoAudio}
          gap="xs"
          wrap="nowrap"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {view}
          {audioOptions && (
            <SegmentedControl
              aria-label="Comparison Audio"
              size="xs"
              value={audioSide}
              onChange={setAudioSide}
              data={Array.from({ length: audioOptions }, (_, index) => ({
                label: `Audio ${letter(index)}`,
                value: String(index),
              }))}
            />
          )}
          {sound}
        </Group>
      )}
      {play && <VideoPlayButton play={play} />}
      {!depth &&
        (Object.entries(hints) as [Direction, string][]).map(([direction, hint]) => (
          <span key={direction} className={classes.hint} data-hint={direction} aria-hidden>
            {hint}
          </span>
        ))}
    </Paper>
  );
}
