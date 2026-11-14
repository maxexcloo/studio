import { SegmentedControl, type SegmentedControlProps } from "@mantine/core";
import { useEffect, useRef, useState } from "react";

import classes from "./ScrollingSegments.module.css";

// Wide enough to clear the edge fade, so the chosen choice sits fully in view.
const margin = 28;

/**
 * A SegmentedControl that scrolls sideways when it is wider than its room: no scrollbar, a fade
 * at each edge hiding choices, and the chosen one scrolled into view on open and on change. The
 * strip around the control scrolls, never the control itself: Mantine measures where its
 * highlight goes, and inside a scrolled control it would land off by the scroll and clip.
 * `className` styles the strip.
 */
export function ScrollingSegments({ className, value, ...props }: SegmentedControlProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = () => {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  };
  useEffect(() => {
    const element = strip.current!;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    const element = strip.current;
    const chosen = element?.querySelector("[data-active]");
    if (!element || !chosen) return;
    const box = element.getBoundingClientRect();
    const target = chosen.getBoundingClientRect();
    const offset =
      target.left < box.left + margin
        ? target.left - box.left - margin
        : target.right > box.right - margin
          ? target.right - box.right + margin
          : 0;
    const still = !opened.current || matchMedia("(prefers-reduced-motion: reduce)").matches;
    opened.current = true;
    if (offset) element.scrollBy({ left: offset, behavior: still ? "instant" : "smooth" });
  }, [value]);
  return (
    <div
      ref={strip}
      className={`${classes.strip} ${className ?? ""}`}
      data-fade-start={edges.start || undefined}
      data-fade-end={edges.end || undefined}
      onScroll={measure}
    >
      <SegmentedControl value={value} {...props} />
    </div>
  );
}
