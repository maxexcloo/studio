import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import type { MediaItem } from "../../types";

/**
 * Selection acts on loaded records, including across virtualised rows. A group (a run in Runs)
 * toggles together. As in a file manager, Shift selects from the last clicked item to the group in
 * loaded order, replacing the selection, and Shift with Ctrl or Cmd adds the range to it. The
 * result stays the same object until the selection or the items change, so tiles skip renders.
 * `selectMatching` (Select All and the like) covers every match of the search and filters: while
 * `more.complete` is false it has `more.load` load the rest first. A new search or filter empties
 * the selection without ending it.
 */
export function useGallerySelection(
  items: MediaItem[],
  resetKey: string,
  more: { complete: boolean; load: () => Promise<boolean> },
) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<{ match: (item: MediaItem) => boolean } | null>(null);
  const anchor = useRef<string | null>(null);
  const ids = useMemo(() => items.map((item) => item.id).join("\n"), [items]);
  useEffect(() => {
    setSelected((current) => current && new Set());
    setPending(null);
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
  // Once every match has loaded, the waiting quick select applies to all of them.
  useEffect(() => {
    if (!pending || !more.complete) return;
    setSelected(new Set(items.filter(pending.match).map((item) => item.id)));
    setPending(null);
  }, [pending, more.complete, items]);
  // The latest loader, so a new one doesn't make a new selection object and rerender every tile.
  const load = useRef(more.load);
  load.current = more.load;
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
      /** Whether every match of the search and filters is selected. */
      all: more.complete && items.length > 0 && items.every((item) => selected?.has(item.id)),
      items,
      /** Whether a quick select is waiting for the rest of the matches to load. */
      loading: pending !== null,
      start: () => setSelected((current) => current || new Set()),
      end: () => {
        setSelected(null);
        setPending(null);
        anchor.current = null;
      },
      toggle,
      /** Select None: empties the selection without ending it. */
      clear: () => {
        setSelected(new Set());
        setPending(null);
        anchor.current = null;
      },
      select: (match: (item: MediaItem) => boolean) =>
        setSelected(new Set(items.filter(match).map((item) => item.id))),
      selectMatching: (match: (item: MediaItem) => boolean) => {
        setSelected((current) => current || new Set());
        setPending({ match });
        void load.current().then((loaded) => loaded || setPending(null));
      },
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
        const range = items.slice(start, end + 1).map((entry) => entry.id);
        const adding = event.ctrlKey || event.metaKey;
        setSelected((current) => new Set([...(adding ? current || [] : []), ...range]));
        return true;
      },
    };
  }, [selected, items, pending, more.complete]);
}
export type GallerySelection = ReturnType<typeof useGallerySelection>;
