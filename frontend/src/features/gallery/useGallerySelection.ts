import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { MediaItem } from "../../types";

const finished = (item: MediaItem) => item.status === "done" || item.status === "error";

/** Selection acts only on loaded, visible finished records, including across virtualised rows. */
export function useGallerySelection(items: MediaItem[], resetKey: string) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const anchor = useRef<string | null>(null);
  const selectable = items.filter(finished);
  const ids = selectable.map((item) => item.id).join("\n");
  useEffect(() => {
    setSelected(null);
    anchor.current = null;
  }, [resetKey]);
  useEffect(() => {
    const visible = new Set(selectable.map((item) => item.id));
    setSelected((current) =>
      current && [...current].some((id) => !visible.has(id))
        ? new Set([...current].filter((id) => visible.has(id)))
        : current,
    );
  }, [ids]);
  const selectedItems = selectable.filter((item) => selected?.has(item.id));
  const allSelected = selectable.length > 0 && selectable.every((item) => selected?.has(item.id));
  function toggle(item: MediaItem) {
    if (!finished(item)) return;
    anchor.current = item.id;
    setSelected((current) => {
      const next = new Set(current || []);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }
  return {
    selecting: selected !== null,
    selected: selected || new Set<string>(),
    selectedItems,
    selectable,
    allSelected,
    start: () => setSelected(new Set()),
    end: () => {
      setSelected(null);
      anchor.current = null;
    },
    toggle,
    toggleAll: () => setSelected(new Set(allSelected ? [] : selectable.map((item) => item.id))),
    selectAll: () => setSelected(new Set(selectable.map((item) => item.id))),
    retain: (ids: string[]) => setSelected(new Set(ids)),
    click: (item: MediaItem, event: MouseEvent) => {
      if (!selected && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        anchor.current = item.id;
        return false;
      }
      if (!finished(item)) return true;
      const from = selectable.findIndex((entry) => entry.id === anchor.current);
      if (!event.shiftKey || from < 0) {
        toggle(item);
        return true;
      }
      const to = selectable.findIndex((entry) => entry.id === item.id);
      setSelected(
        (current) =>
          new Set([
            ...(current || []),
            ...selectable
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .map((entry) => entry.id),
          ]),
      );
      return true;
    },
  };
}
export type GallerySelection = ReturnType<typeof useGallerySelection>;
