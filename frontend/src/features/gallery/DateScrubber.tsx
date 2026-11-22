import { type RefObject, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { dayHeading } from "./mediaLabels";
import type { GalleryDate } from "./queries";

import classes from "./MediaGrid.module.css";

export interface GallerySection {
  day: string;
  top: number;
}
const noDates: GalleryDate[] = [];
const countFormat = new Intl.NumberFormat();
const clamp = (fraction: number) => Math.min(Math.max(fraction, 0), 1);
const dateLabel = (day: string) => (day ? dayHeading(day) : "Undated");
const topInset = (grid: HTMLElement) => parseFloat(getComputedStyle(grid).scrollMarginTop) || 0;

function dateDensity(days: GalleryDate[]) {
  if (days.length < 2) return;
  // Average adjacent dates when the history exceeds the number of readable bands.
  const bands = Math.min(days.length, 64);
  const density = Array.from({ length: bands }, (_, index) => {
    const start = Math.floor((index * days.length) / bands);
    const end = Math.floor(((index + 1) * days.length) / bands);
    let count = 0;
    for (let day = start; day < end; day++) count += days[day].count;
    return { start, end, level: Math.log1p(count / (end - start)) };
  });
  const peak = Math.max(...density.map(({ level }) => level), 1);
  const stops = density.map(({ start, end, level }) => {
    const alpha = Math.round(14 + (52 * level) / peak);
    const middle = (50 * (start + end)) / days.length;
    const half = `min(1px, ${(12 * (end - start)) / days.length}%)`;
    const first = `calc(${middle}% - ${half})`;
    const last = `calc(${middle}% + ${half})`;
    const colour = `color-mix(in srgb, var(--mantine-primary-color-filled) ${alpha}%, transparent)`;
    return `transparent ${first}, ${colour} ${first} ${last}, transparent ${last}`;
  });
  return `linear-gradient(${stops.join(", ")})`;
}

/** Scrub the date index without reading media until a jump is committed. Ordinary scrolling follows the visible day. */
export const DateScrubber = memo(function DateScrubber({
  host,
  gridId,
  sections,
  height,
  timeline = noDates,
  onDate,
  jumpDay,
  seekPending,
  results,
}: {
  host: RefObject<HTMLDivElement | null>;
  gridId: string;
  sections: GallerySection[];
  height: number;
  timeline?: GalleryDate[];
  onDate?: (date: GalleryDate) => void;
  jumpDay?: string;
  seekPending?: boolean;
  results: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ fraction: 0, day: "" });
  const [active, setActive] = useState(false);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const pointer = useRef<{ bounds: DOMRect; fraction: number; frame: number } | null>(null);
  const handled = useRef<string | undefined>(undefined);
  const indices = useMemo(() => new Map(timeline.map(({ day }, i) => [day, i])), [timeline]);
  const density = useMemo(() => dateDensity(timeline), [timeline]);
  const indexed = timeline.length > 1 && Boolean(onDate);
  const visible = indexed || (sections.some(({ day }) => day) && height > 3 * window.innerHeight);

  const scrollToSection = (index: number, fraction = 0) => {
    const grid = host.current;
    if (!grid || index < 0) return;
    const top = sections[index].top;
    const end = sections[index + 1]?.top ?? height;
    window.scrollTo({
      top:
        window.scrollY +
        grid.getBoundingClientRect().top -
        topInset(grid) +
        top +
        (end - top) * fraction,
    });
  };

  useLayoutEffect(() => {
    if (jumpDay === undefined || seekPending) {
      handled.current = undefined;
      return;
    }
    const key = JSON.stringify([results, jumpDay]);
    if (handled.current === key || !sections.length) return;
    handled.current = key;
    scrollToSection(
      Math.max(
        sections.findIndex(({ day }) => day === jumpDay),
        0,
      ),
    );
  }, [jumpDay, results, sections, seekPending]);

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    let idle = 0;
    const update = () => {
      frame = 0;
      const grid = host.current;
      if (!grid || !sections.length) return;
      const offset = topInset(grid) - grid.getBoundingClientRect().top + 1;
      let low = 0;
      let high = sections.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (sections[middle].top <= offset) low = middle;
        else high = middle - 1;
      }
      const { day, top } = sections[low];
      const index = indices.get(day);
      const end = sections[low + 1]?.top ?? height;
      const range = document.documentElement.scrollHeight - window.innerHeight;
      const fraction =
        indexed && index !== undefined
          ? (index + clamp((offset - top) / Math.max(end - top, 1))) / timeline.length
          : range > 0
            ? clamp(window.scrollY / range)
            : 0;
      setPosition((previous) =>
        previous.fraction === fraction && previous.day === day ? previous : { fraction, day },
      );
    };
    const scroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
      setActive(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setActive(false), 1500);
    };
    update();
    setActive(false);
    window.addEventListener("scroll", scroll, { passive: true });
    const resize = () => {
      if (pointer.current && track.current)
        pointer.current.bounds = track.current.getBoundingClientRect();
      scroll();
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [visible, indexed, sections, height, host, indices, timeline.length]);

  useEffect(
    () => () => {
      if (pointer.current) window.cancelAnimationFrame(pointer.current.frame);
    },
    [],
  );

  if (!visible) return null;
  const fromPointer = (clientY: number, { top, height }: DOMRect) =>
    clamp((clientY - top) / Math.max(height, 1));
  const indexAt = (fraction: number) =>
    Math.min(Math.floor(fraction * timeline.length), timeline.length - 1);
  const showDate = (date: GalleryDate, fraction = 0) => {
    const loaded = sections.findIndex(({ day }) => day === date.day);
    if (loaded >= 0 && !seekPending) scrollToSection(loaded, fraction);
    else onDate?.(date);
  };
  const dragTo = (fraction: number) => {
    if (!indexed) {
      window.scrollTo({
        top: fraction * (document.documentElement.scrollHeight - window.innerHeight),
      });
    }
    setDrag(fraction);
  };
  const endDrag = () => {
    if (pointer.current) window.cancelAnimationFrame(pointer.current.frame);
    pointer.current = null;
    setDrag(null);
  };
  const pendingIndex = seekPending && jumpDay !== undefined ? indices.get(jumpDay) : undefined;
  const pendingPosition =
    pendingIndex === undefined ? position.fraction : (pendingIndex + 0.5) / timeline.length;
  const fraction = indexed && drag !== null ? drag : pendingPosition;
  const previewing = indexed && (drag !== null || pendingIndex !== undefined);
  const day = previewing ? timeline[indexAt(fraction)].day : position.day;
  const dayIndex = indices.get(day);
  const count = indexed && dayIndex !== undefined ? timeline[dayIndex].count : undefined;
  const label =
    count === undefined
      ? dateLabel(day)
      : `${dateLabel(day)} · ${countFormat.format(count)} ${count === 1 ? "result" : "results"}`;
  return (
    <div
      ref={track}
      className={classes.scrubber}
      data-active={active || drag !== null || focus || pendingIndex !== undefined || undefined}
      data-indexed={indexed || undefined}
      style={indexed ? { backgroundImage: density } : undefined}
      role="scrollbar"
      tabIndex={0}
      aria-label="Gallery Dates"
      aria-controls={gridId}
      aria-busy={pendingIndex !== undefined || undefined}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuetext={label}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onKeyDown={(event) => {
        const direction = { ArrowUp: -1, PageUp: -1, ArrowDown: 1, PageDown: 1 }[event.key];
        if (!direction && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        if (indexed) {
          const current = indices.get(day) ?? indexAt(fraction);
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? timeline.length - 1
                : Math.min(Math.max(current + direction!, 0), timeline.length - 1);
          showDate(timeline[index]);
        } else {
          window.scrollTo({
            top:
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? document.documentElement.scrollHeight
                  : window.scrollY + direction! * window.innerHeight,
          });
        }
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = event.currentTarget.getBoundingClientRect();
        const fraction = indexed ? fromPointer(event.clientY, bounds) : position.fraction;
        pointer.current = { bounds, fraction, frame: 0 };
        setDrag(fraction);
      }}
      onPointerMove={(event) => {
        const gesture = pointer.current;
        if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        gesture.fraction = fromPointer(event.clientY, gesture.bounds);
        gesture.frame ||= window.requestAnimationFrame(() => {
          gesture.frame = 0;
          dragTo(gesture.fraction);
        });
      }}
      onPointerUp={(event) => {
        const gesture = pointer.current;
        if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if (indexed) {
          const fraction = fromPointer(event.clientY, gesture.bounds);
          const index = indexAt(fraction);
          showDate(timeline[index], fraction * timeline.length - index);
        } else if (gesture.frame) {
          dragTo(gesture.fraction);
        }
        endDrag();
      }}
      onLostPointerCapture={endDrag}
    >
      <div
        className={classes.thumb}
        style={{ top: `calc(${fraction} * (100% - var(--scrubber-thumb)))` }}
      >
        {(drag !== null || focus || pendingIndex !== undefined) && (
          <span className={classes.date}>{label}</span>
        )}
      </div>
    </div>
  );
});
