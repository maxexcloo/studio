import { useLayoutEffect, useRef, useState } from "react";
import { useLocalStorage, useLongPress, useMediaQuery } from "@mantine/hooks";
import { useMantineTheme } from "@mantine/core";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import type { GallerySelection } from "./useGallerySelection";

export const galleryGap = 8;

/** Grid and Runs share one column count and the measured width of their host. */
export function useGalleryLayout() {
  const phone = usePhone();
  const { breakpoints } = useMantineTheme();
  const compact = useMediaQuery(`(max-width: ${breakpoints.lg})`, false, {
    getInitialValueInEffect: false,
  });
  const columns = phone ? 2 : compact ? 3 : 5;
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
  const cell = (width - galleryGap * (columns - 1)) / columns;
  return { phone, columns, host, width, cell };
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
 * movement cancellation. `held` marks the tile whose release must not also open it.
 */
export function useHoldToSelect(items: MediaItem[], selection: GallerySelection | undefined) {
  const phone = usePhone();
  const held = useRef<string | null>(null);
  const handlers = useLongPress(
    (event) => {
      if (!phone || !selection) return;
      const element = (event.target as Element).closest<HTMLElement>("[data-media-id]");
      const ids = element?.dataset.mediaGroup?.split(" ") || [element?.dataset.mediaId];
      const group = items.filter((item) => ids.includes(item.id));
      if (!group.length) return;
      held.current = element!.dataset.mediaId!;
      if (!selection.selecting) selection.start();
      selection.toggle(group);
    },
    {
      events: ["touch"],
      cancelOnMove: true,
      onStart: () => {
        held.current = null;
      },
    },
  );
  /** True, once, for the click that ends a hold on `id`. */
  function consumeHold(id: string) {
    if (held.current !== id) return false;
    held.current = null;
    return true;
  }
  return { handlers, held, consumeHold };
}
