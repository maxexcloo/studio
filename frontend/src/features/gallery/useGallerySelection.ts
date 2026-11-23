import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { failure } from "../../api";
import type { MediaItem } from "../../types";
import { mediaIdentity } from "./mediaSource";
import type { GalleryQuickSelect } from "./queries";

interface QuickMatches {
  items: MediaItem[];
  match: GalleryQuickSelect;
}

/**
 * Tile and range selection act on loaded records. Quick selects can also keep a snapshot of
 * matching records outside the loaded pages. A scope change empties the selection without ending it.
 */
export function useGallerySelection(
  items: MediaItem[],
  resetKey: string,
  more: {
    ready: boolean;
    complete: boolean;
    load: (match: GalleryQuickSelect, signal: AbortSignal) => Promise<MediaItem[]>;
  },
) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<GalleryQuickSelect | null>(null);
  const [snapshot, setSnapshot] = useState<QuickMatches | null>(null);
  const request = useRef<AbortController | null>(null);
  const anchor = useRef<string | null>(null);
  const ids = useMemo(() => items.map((item) => item.id).join("\n"), [items]);
  useEffect(() => {
    setSelected((current) => current && new Set());
    setSnapshot(null);
    setPending(null);
    anchor.current = null;
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [resetKey]);
  const previousItems = useRef(items);
  useEffect(() => {
    const visible = new Set(items.map((item) => item.id));
    const slots = new Map(items.map((item) => [mediaIdentity(item), item.id]));
    const replacements = new Map(
      previousItems.current.map((item) => [item.id, slots.get(mediaIdentity(item))]),
    );
    previousItems.current = items;
    if (anchor.current) anchor.current = replacements.get(anchor.current) || anchor.current;
    setSelected((current) => {
      if (!current) return current;
      const next = new Set(
        [...current].flatMap((id) =>
          visible.has(id) || !replacements.has(id) ? id : replacements.get(id) || [],
        ),
      );
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
  }, [ids]);
  // The actions read the latest state, so they keep one identity and memoised tiles skip renders.
  const latest = useRef({ items, selected, more });
  latest.current = { items, selected, more };
  const actions = useMemo(() => {
    function cancelQuickSelect() {
      request.current?.abort();
      request.current = null;
      setPending(null);
    }
    function toggle(group: MediaItem[]) {
      cancelQuickSelect();
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
      start: () => setSelected((current) => current || new Set()),
      end: () => {
        setSelected(null);
        setSnapshot(null);
        cancelQuickSelect();
        anchor.current = null;
      },
      toggle,
      /** Select None: empties the selection without ending it. */
      clear: () => {
        setSelected(new Set());
        setSnapshot(null);
        cancelQuickSelect();
        anchor.current = null;
      },
      select: (match: (item: MediaItem) => boolean) => {
        cancelQuickSelect();
        setSnapshot(null);
        setSelected(new Set(latest.current.items.filter(match).map((item) => item.id)));
      },
      selectMatching: async (match: GalleryQuickSelect) => {
        const { items, more } = latest.current;
        if (!more.ready || request.current) return;
        const matches = (item: MediaItem) => match === "all" || item.status === "failed";
        if (more.complete) {
          setSnapshot(null);
          setSelected(new Set(items.filter(matches).map((item) => item.id)));
          return;
        }
        setSelected((current) => current || new Set());
        const controller = new AbortController();
        request.current = controller;
        setPending(match);
        try {
          const matchesInScope = await more.load(match, controller.signal);
          if (controller.signal.aborted) return;
          setSnapshot({ items: matchesInScope, match });
          setSelected(new Set(matchesInScope.filter(matches).map((item) => item.id)));
        } catch (error) {
          if (!controller.signal.aborted) failure(error);
        } finally {
          if (request.current === controller) cancelQuickSelect();
        }
      },
      retain: (ids: string[]) => setSelected(new Set(ids)),
      /** Handles a tile click when it selects; returns false when the tile should open instead. */
      click: (group: MediaItem[], event: MouseEvent | KeyboardEvent) => {
        const { items, selected } = latest.current;
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
        cancelQuickSelect();
        setSelected((current) => new Set([...(adding ? current || [] : []), ...range]));
        return true;
      },
    };
  }, []);
  return useMemo(() => {
    const loaded = new Map(items.map((item) => [item.id, item]));
    const selectedItems = [];
    if (selected) {
      const seen = new Set<string>();
      for (const item of [...(snapshot?.items || []), ...items])
        if (selected.has(item.id) && !seen.has(item.id)) {
          seen.add(item.id);
          selectedItems.push(loaded.get(item.id) || item);
        }
    }
    const known = more.complete ? items : snapshot?.match === "all" ? snapshot.items : undefined;
    return {
      ...actions,
      actions,
      scope: resetKey,
      selecting: selected !== null,
      selected: selected || new Set<string>(),
      selectedItems,
      all: Boolean(known?.length && known.every((item) => selected?.has(item.id))),
      noFailed:
        known !== undefined &&
        !known.some((item) => (loaded.get(item.id) || item).status === "failed"),
      quickReady: more.ready,
      pending,
    };
  }, [actions, selected, items, pending, snapshot, more.complete, more.ready, resetKey]);
}
export type GallerySelection = ReturnType<typeof useGallerySelection>;
export type SelectionActions = GallerySelection["actions"];
