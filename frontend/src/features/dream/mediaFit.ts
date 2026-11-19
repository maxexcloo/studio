import { useLayoutEffect, useRef, useState } from "react";

/** The share of a picture's width or height a fill may crop before it shows whole instead. */
const cropLimit = 0.15;

/**
 * Whether media of shape `ratio` (width ÷ height) fills a box of shape `box`, cropping a little;
 * media that doesn't shows whole over a blurred copy of itself.
 */
export const covers = (ratio: number, box: number) =>
  Math.min(ratio / box, box / ratio) >= 1 - cropLimit;

/**
 * Whether a comparison's two sides of shape `ratio` waste less of a box of shape `box` next to each
 * other (each side `box / 2`) than one above the other (each `box * 2`).
 */
export const besideFits = (ratio: number, box: number) => ratio <= box;

/**
 * The shape (width ÷ height) of the element `ref` points at, 0 until measured. It follows real
 * changes, such as turning the phone, but not the few percent a toolbar or keyboard moves it, so
 * layouts decided from it hold steady.
 */
export function useBoxShape<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => {
      // The content box, inside any padding.
      const style = getComputedStyle(element);
      const width =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height =
        element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const next = width / Math.max(1, height);
      setBox((previous) => (previous && Math.abs(next / previous - 1) < 0.1 ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, box };
}
