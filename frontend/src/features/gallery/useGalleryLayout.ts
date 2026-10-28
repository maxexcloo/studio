import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage, useLongPress, useMediaQuery } from "@mantine/hooks";
import { useMantineTheme } from "@mantine/core";
import type { MediaItem } from "../../types";
import { easing } from "../../theme";
import { useMotionDuration } from "../../ui/Appearance";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import type { GallerySelection } from "./useGallerySelection";

/** The point a zoom holds still: the tile under it and where on that tile it fell. */
interface ZoomAnchor {
  id: string;
  x: number;
  y: number;
  fraction: number;
  columns: number;
  scale: number;
}
// One gallery shows at a time, so a zoom from the toolbar or a gesture leaves its anchor here for
// the view that lays out the new columns.
let zoomAnchor: ZoomAnchor | null = null;

/** The tile under a viewport point, or the nearest one, as the anchor for a change of columns. */
function anchorAt(x: number, y: number, columns: number, scale: number): ZoomAnchor | null {
  let best: { tile: HTMLElement; rect: DOMRect; away: number } | null = null;
  for (const tile of document.querySelectorAll<HTMLElement>("[data-gallery-view] [data-media-id]")) {
    const rect = tile.getBoundingClientRect();
    const away = Math.hypot(
      Math.max(rect.left - x, 0, x - rect.right),
      Math.max(rect.top - y, 0, y - rect.bottom),
    );
    if (!best || away < best.away) best = { tile, rect, away };
  }
  if (!best) return null;
  const { rect } = best;
  const fraction = Math.min(Math.max((y - rect.top) / rect.height, 0), 1);
  const id = best.tile.dataset.mediaId!;
  return { id, x, y: rect.top + fraction * rect.height, fraction, columns, scale };
}

/**
 * Grid and Runs share one column count: two on phones, three or five wider, until zoomed. Each
 * account remembers its zoom, separately for phones and wider screens.
 */
export function useGalleryColumns() {
  const phone = usePhone();
  const { breakpoints } = useMantineTheme();
  const compact = useMediaQuery(`(max-width: ${breakpoints.lg})`, false, {
    getInitialValueInEffect: false,
  });
  const [saved, setSaved] = useRemembered<number | null>(
    phone ? "gallery-columns-phone" : "gallery-columns",
    null,
  );
  const [min, max] = phone ? [1, 4] : [2, 8];
  const columns = Math.min(Math.max(saved ?? (phone ? 2 : compact ? 3 : 5), min), max);
  /** Changes the columns, holding the tile under `point` (the viewport's centre) in place. */
  const zoomTo = useCallback(
    (next: number, point?: { x: number; y: number }) => {
      const target = Math.min(Math.max(next, min), max);
      if (target === columns) return;
      zoomAnchor = anchorAt(
        point?.x ?? window.innerWidth / 2,
        point?.y ?? window.innerHeight / 2,
        target,
        columns / target,
      );
      setSaved(target);
    },
    [columns, min, max, setSaved],
  );
  return { columns, min, max, zoomTo };
}

/**
 * Grid and Runs share one column count and the measured width of their host. Pinching on phones
 * and Ctrl/Cmd+scroll (a trackpad pinch included) on desktop step between column counts. After a
 * zoom, `anchor` puts the tile under the fingers or pointer back where it was: the view passes
 * where a tile now sits (`start` and `size`, in window scroll coordinates).
 */
export function useGalleryLayout() {
  const phone = usePhone();
  const { columns, zoomTo } = useGalleryColumns();
  const motionDuration = useMotionDuration();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = host.current!;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = useRef({ columns, zoomTo });
  zoom.current = { columns, zoomTo };
  useEffect(() => {
    const element = host.current!;
    let wheel = 0;
    let wheelAt = 0;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // A trackpad pinch sends many small deltas and a mouse wheel few large ones; each step takes
      // the same travel, and a pause starts afresh.
      if (event.timeStamp - wheelAt > 300) wheel = 0;
      wheelAt = event.timeStamp;
      wheel += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      if (Math.abs(wheel) < 60) return;
      const step = Math.sign(wheel);
      wheel = 0;
      zoom.current.zoomTo(zoom.current.columns + step, { x: event.clientX, y: event.clientY });
    }
    let pinch: number | null = null;
    const spread = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    function onTouchStart(event: TouchEvent) {
      pinch = event.touches.length === 2 ? spread(event.touches) : null;
    }
    function onTouchMove(event: TouchEvent) {
      if (pinch === null || event.touches.length !== 2) return;
      event.preventDefault();
      const ratio = spread(event.touches) / pinch;
      if (ratio > 0.8 && ratio < 1.25) return;
      pinch = spread(event.touches);
      zoom.current.zoomTo(zoom.current.columns + (ratio > 1 ? -1 : 1), {
        x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
        y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
      });
    }
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinch = null;
    }
    // Safari pinches the page itself unless its gesture events are refused.
    const refuse = (event: Event) => event.preventDefault();
    const listeners = [
      ["wheel", onWheel, { passive: false }],
      ["touchstart", onTouchStart, { passive: true }],
      ["touchmove", onTouchMove, { passive: false }],
      ["touchend", onTouchEnd, { passive: true }],
      ["touchcancel", onTouchEnd, { passive: true }],
      ["gesturestart", refuse, { passive: false }],
    ] as const;
    for (const [type, listener, options] of listeners)
      element.addEventListener(type, listener as EventListener, options);
    return () => {
      for (const [type, listener] of listeners)
        element.removeEventListener(type, listener as EventListener);
    };
  }, []);
  /**
   * Once the new columns are laid out, scrolls the anchored tile back under the point and scales
   * the grid into place around it.
   */
  const anchor = useCallback(
    (locate: (id: string) => { start: number; size: number } | undefined) => {
      const anchored = zoomAnchor;
      if (!anchored || anchored.columns !== columns || !host.current) return;
      zoomAnchor = null;
      const placed = locate(anchored.id);
      if (!placed) return;
      window.scrollTo({ top: placed.start + anchored.fraction * placed.size - anchored.y });
      if (!motionDuration) return;
      const rect = host.current.getBoundingClientRect();
      const transformOrigin = `${anchored.x - rect.left}px ${anchored.y - rect.top}px`;
      host.current.animate(
        [{ transform: `scale(${anchored.scale})`, transformOrigin }, { transformOrigin }],
        { duration: motionDuration, easing: easing.enter },
      );
    },
    [columns, motionDuration],
  );
  // Tiles sit tighter on phones, where every pixel goes to the media.
  const gap = phone ? 4 : 8;
  const cell = (width - gap * (columns - 1)) / columns;
  return { phone, columns, host, width, cell, gap, anchor };
}

/** Phone captions stay hidden unless the Tile Captions preference is on. */
export function useTileCaptions() {
  return useLocalStorage<boolean>({
    key: "studio-tile-captions",
    defaultValue: false,
    getInitialValueInEffect: false,
  });
}

/**
 * Phone hold-to-select over any tile with `data-media-id`, using Mantine's touch gesture with
 * movement cancellation. `held` marks the tile whose release must not also open it. The result
 * stays the same object while `items` and `selection` do, so memoised tiles skip scroll renders.
 */
export function useHoldToSelect(items: MediaItem[], selection: GallerySelection | undefined) {
  const phone = usePhone();
  const held = useRef<string | null>(null);
  const select = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (!phone || !selection) return;
      const element = (event.target as Element).closest<HTMLElement>("[data-media-id]");
      const ids = element?.dataset.mediaGroup?.split(" ") || [element?.dataset.mediaId];
      const group = items.filter((item) => ids.includes(item.id));
      if (!group.length) return;
      held.current = element!.dataset.mediaId!;
      if (!selection.selecting) selection.start();
      selection.toggle(group);
    },
    [phone, selection, items],
  );
  const onStart = useCallback(() => {
    held.current = null;
  }, []);
  const handlers = useLongPress(select, { events: ["touch"], cancelOnMove: true, onStart });
  return useMemo(
    () => ({
      handlers,
      held,
      /** True, once, for the click that ends a hold on `id`. */
      consumeHold(id: string) {
        if (held.current !== id) return false;
        held.current = null;
        return true;
      },
    }),
    [handlers],
  );
}
