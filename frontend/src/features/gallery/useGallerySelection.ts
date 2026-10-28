import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { MediaItem } from "../../types";

/**
 * Selection acts on loaded records, including across virtualised rows. A group (a run in Runs)
 * toggles together; Shift extends from the last toggled item to the group in loaded order. The
 * result stays the same object until the selection or the items change, so tiles skip renders.
 */
export function useGallerySelection(items: MediaItem[], resetKey: string) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const anchor = useRef<string | null>(null);
  const ids = useMemo(() => items.map((item) => item.id).join("\n"), [items]);
  useEffect(() => {
    setSelected(null);
    anchor.current = null;
  }, [resetKey]);
  useEffect(() => {
    const visible = new Set(items.map((item) => item.id));
    setSelected((current) =>
      current && [...current].some((id) => !visible.has(id))
        ? new Set([...current].filter((id) => visible.has(id)))
        : current,
    );
  }, [ids]);
  return useMemo(() => {
    function toggle(group: MediaItem[]) {
      anchor.current = group[group.length - 1]?.id ?? null;
      setSelected((current) => {
        const next = new Set(current || []);
        const on = !group.every((item) => next.has(item.id));
        for (const item of group) {
          if (on) next.add(item.id);
          else next.delete(item.id);
        }
        return next;
      });
    }
    return {
      selecting: selected !== null,
      selected: selected || new Set<string>(),
      selectedItems: selected ? items.filter((item) => selected.has(item.id)) : [],
      items,
      start: () => setSelected((current) => current || new Set()),
      end: () => {
        setSelected(null);
        anchor.current = null;
      },
      toggle,
      select: (match: (item: MediaItem) => boolean) =>
        setSelected(new Set(items.filter(match).map((item) => item.id))),
      retain: (ids: string[]) => setSelected(new Set(ids)),
      /** Handles a tile click when it selects; returns false when the tile should open instead. */
      click: (group: MediaItem[], event: MouseEvent | KeyboardEvent) => {
        const modified = event.ctrlKey || event.metaKey || event.shiftKey;
        if (!selected && !modified) {
          anchor.current = group[0]?.id ?? null;
          return false;
        }
        const from = items.findIndex((entry) => entry.id === anchor.current);
        if (!event.shiftKey || from < 0) {
          toggle(group);
          return true;
        }
        const indexes = group.map((item) => items.indexOf(item));
        const start = Math.min(from, ...indexes),
          end = Math.max(from, ...indexes);
        setSelected(
          (current) =>
            new Set([...(current || []), ...items.slice(start, end + 1).map((entry) => entry.id)]),
        );
        return true;
      },
    };
  }, [selected, items]);
}
export type GallerySelection = ReturnType<typeof useGallerySelection>;
