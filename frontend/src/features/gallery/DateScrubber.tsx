import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { dayHeading } from "./mediaLabels";
import type { GalleryDate } from "./queries";

import classes from "./MediaGrid.module.css";

export interface GallerySection {
  day: string;
  top: number;
}
const noDates: GalleryDate[] = [];
const clamp = (fraction: number) => Math.min(Math.max(fraction, 0), 1);
const dateLabel = (day: string) => (day ? dayHeading(day) : "Undated");
const topInset = (grid: HTMLElement) => parseFloat(getComputedStyle(grid).scrollMarginTop) || 0;

/** Scrub the date index without reading media until a jump is committed. Ordinary scrolling follows the visible day. */
export function DateScrubber({
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
  const handled = useRef<string | undefined>(undefined);
  const indices = useMemo(() => new Map(timeline.map(({ day }, i) => [day, i])), [timeline]);
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
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", scroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [visible, indexed, sections, height, host, indices, timeline.length]);

  if (!visible) return null;
  const fromPointer = (clientY: number) => {
    const { top, height } = track.current!.getBoundingClientRect();
    return clamp((clientY - top) / height);
  };
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
  const pendingIndex = seekPending && jumpDay !== undefined ? indices.get(jumpDay) : undefined;
  const pendingPosition =
    pendingIndex === undefined ? position.fraction : (pendingIndex + 0.5) / timeline.length;
  const fraction = indexed && drag !== null ? drag : pendingPosition;
  const previewing = indexed && (drag !== null || pendingIndex !== undefined);
  const day = previewing ? timeline[indexAt(fraction)].day : position.day;
  const label = dateLabel(day);
  return (
    <div
      ref={track}
      className={classes.scrubber}
      data-active={active || drag !== null || focus || undefined}
      data-indexed={indexed || undefined}
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
        if (indexed) dragTo(fromPointer(event.clientY));
        else setDrag(position.fraction);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          dragTo(fromPointer(event.clientY));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if (indexed) {
          const fraction = fromPointer(event.clientY);
          const index = indexAt(fraction);
          showDate(timeline[index], fraction * timeline.length - index);
        }
        setDrag(null);
      }}
      onLostPointerCapture={() => setDrag(null)}
    >
      {indexed && drag === null && (
        <>
          <span className={classes.endpoint} aria-hidden>
            {dateLabel(timeline[0].day)}
          </span>
          <span className={classes.endpoint} aria-hidden>
            {dateLabel(timeline.at(-1)!.day)}
          </span>
        </>
      )}
      <div
        className={classes.thumb}
        style={{ top: `calc(${fraction} * (100% - var(--scrubber-thumb)))` }}
      >
        {(drag !== null || (focus && !indexed)) && <span className={classes.date}>{label}</span>}
      </div>
    </div>
  );
}
