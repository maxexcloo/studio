import React from 'react';
import type { GalleryItem } from './types';

/**
 * Selecting several gallery items, the same on a phone and a computer: a
 * phone starts from a long press or More and taps tiles in and out; a
 * computer Ctrl/Cmd-clicks and Shift-clicks ranges, or starts from Select.
 * Both bars offer the same bulk actions (itemActions.ts).
 */
export type GallerySelection = {
  selecting: boolean;
  selected: Set<string>;
  /** What is selected and still loaded, in gallery order. */
  selectedItems: GalleryItem[];
  /** Finished, failed and in-progress items (in-progress ones only for Stop). */
  selectable: GalleryItem[];
  allSelected: boolean;
  start: (ids?: string[]) => void;
  end: () => void;
  toggle: (item: GalleryItem) => void;
  /** Everything loaded, or nothing once all of it is. */
  toggleAll: () => void;
  selectAll: () => void;
  /** Every failed item loaded, for Retry or Delete. */
  selectFailed: () => void;
  failedCount: number;
  /** Every queued or running item loaded, for a bulk Stop. */
  selectRunning: () => void;
  runningCount: number;
  /** A tile's click: true when selection took it, so the viewer stays shut. */
  click: (item: GalleryItem, event: React.MouseEvent) => boolean;
  /** A tile's context menu, where the gallery offers one. */
  menu?: (item: GalleryItem, event: React.MouseEvent | React.KeyboardEvent) => void;
};

export const GallerySelectionContext = React.createContext<GallerySelection | null>(null);

const isSelectable = (item: GalleryItem) => item.status === 'done' || item.status === 'error' || item.status === 'pending';
const isFinished = (item: GalleryItem) => item.status === 'done' || item.status === 'error';

/** One selection for the gallery; a change of `resetKey` (layout, space, mode, search) ends it. */
export function useGallerySelection(items: GalleryItem[], resetKey: string): GallerySelection {
  const [selection, setSelection] = React.useState<Set<string> | null>(null);
  const anchor = React.useRef<string | null>(null);
  React.useEffect(() => { setSelection(null); anchor.current = null; }, [resetKey]);
  const selectable = React.useMemo(() => items.filter(isSelectable), [items]);
  // Polls and filters can remove selected items; never act on an invisible item.
  React.useEffect(() => {
    const ids = new Set(selectable.map((item) => item.id));
    setSelection((current) => current && [...current].some((id) => !ids.has(id)) ? new Set([...current].filter((id) => ids.has(id))) : current);
  }, [selectable]);
  return React.useMemo(() => {
    const selectedItems = selection ? selectable.filter((item) => selection.has(item.id)) : [];
    // Select All takes what has finished; in-progress jobs join only through Select In Progress or a tap.
    const finished = selectable.filter(isFinished);
    const allSelected = finished.length > 0 && finished.every((item) => selection?.has(item.id));
    const selectAll = () => setSelection(new Set(finished.map((item) => item.id)));
    const running = selectable.filter((item) => item.status === 'pending');
    const failed = selectable.filter((item) => item.status === 'error');
    const toggle = (item: GalleryItem) => {
      if (!isSelectable(item)) return;
      anchor.current = item.id;
      setSelection((current) => {
        const next = new Set(current || []);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
    };
    return {
      selecting: selection !== null,
      selected: selection || new Set<string>(),
      selectedItems,
      selectable,
      allSelected,
      start: (ids = []) => { setSelection(new Set(ids)); anchor.current = ids.at(-1) ?? null; },
      end: () => { setSelection(null); anchor.current = null; },
      toggle,
      toggleAll: () => (allSelected ? setSelection(new Set()) : selectAll()),
      selectAll,
      selectFailed: () => setSelection(new Set(failed.map((item) => item.id))),
      failedCount: failed.length,
      selectRunning: () => setSelection(new Set(running.map((item) => item.id))),
      runningCount: running.length,
      click: (item, event) => {
        if (!selection && !event.ctrlKey && !event.metaKey && !event.shiftKey) { anchor.current = item.id; return false; }
        if (!isSelectable(item)) return true;
        const from = selectable.findIndex((entry) => entry.id === anchor.current);
        if (!event.shiftKey || from < 0) { toggle(item); return true; }
        const to = selectable.findIndex((entry) => entry.id === item.id);
        setSelection((current) => {
          const next = new Set(current || []);
          selectable.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((entry) => next.add(entry.id));
          return next;
        });
        return true;
      },
    };
  }, [selectable, selection]);
}
