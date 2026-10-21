import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { apiJson } from './api';
import { sortGalleryItems } from './gallery';
import type { GalleryItem, Mode } from './types';
import { emptySearch, galleryQuery, searchActive, searchFilterKeys, type GallerySearch } from './favorites';

type GalleryPage = {
  items?: GalleryItem[];
  outputs?: GalleryItem[];
  nextCursor?: string;
  hasMore?: boolean;
  revision?: number;
  totalApprox?: number;
};

type GalleryDelta = {
  revision: number;
  reset?: boolean;
  upserts?: GalleryItem[];
  removes?: string[];
};

type GalleryState = {
  itemsById: Record<string, GalleryItem>;
  sortedIds: string[];
  revision: number;
  nextCursor: string;
  hasMore: boolean;
  loaded: boolean;
  totalApprox: number;
  /** Emptied by a crossing to another list, not by a first load. */
  crossing?: boolean;
};

type GalleryAction =
  | { type: "reset"; page: GalleryPage }
  | { type: "append"; page: GalleryPage }
  | { type: "upsert"; items: GalleryItem[]; revision?: number }
  | { type: "remove"; keys: string[]; revision?: number }
  | { type: "removeWhere"; predicate: (item: GalleryItem) => boolean; revision?: number }
  | { type: "patch"; update: (item: GalleryItem) => GalleryItem; revision?: number }
  | { type: "replace"; items: GalleryItem[]; revision?: number }
  | { type: "loaded" }
  | { type: "clear" }
  | { type: "cross"; restore: GalleryState | null };

const initialState: GalleryState = {
  itemsById: {},
  sortedIds: [],
  revision: 0,
  nextCursor: "",
  hasMore: false,
  loaded: false,
  totalApprox: 0,
};

function itemKey(item: GalleryItem) {
  return item.id || item.url || item.outputName || item.filename;
}

/** Field by field, so a big preview string is compared in place rather than serialised with the whole item. */
function sameItem(a?: GalleryItem, b?: GalleryItem) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof GalleryItem)[];
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return true;
    return typeof left === "object" && typeof right === "object" && JSON.stringify(left) === JSON.stringify(right);
  });
}

/** Whether an update can move an item in the sorted order (see sortGalleryItems). */
function sortFieldsChanged(a: GalleryItem, b: GalleryItem) {
  return a.createdAt !== b.createdAt || a.index !== b.index || a.jobId !== b.jobId || a.id !== b.id;
}

function orderedIds(itemsById: Record<string, GalleryItem>) {
  return sortGalleryItems(Object.values(itemsById)).map(itemKey).filter(Boolean);
}

function mergeItems(current: Record<string, GalleryItem>, items: GalleryItem[]) {
  let changed = false;
  const next = { ...current };
  for (const item of items) {
    const key = itemKey(item);
    if (!key) continue;
    if (sameItem(next[key], item)) continue;
    next[key] = item;
    changed = true;
  }
  return changed ? next : current;
}

/** The same state object when the revision did not move, so React skips the re-render. */
function withRevision(state: GalleryState, revision?: number) {
  const next = Number(revision || state.revision);
  return next === state.revision ? state : { ...state, revision: next };
}

function galleryReducer(state: GalleryState, action: GalleryAction): GalleryState {
  if (action.type === "loaded") return { ...state, loaded: true };
  if (action.type === "clear") return initialState;
  if (action.type === "cross") return action.restore || { ...initialState, crossing: true };
  if (action.type === "reset") {
    const pageItems = action.page.items || action.page.outputs || [];
    // Keep the existing object for an unchanged item, so memoised tiles skip re-rendering.
    const pageItemsById: Record<string, GalleryItem> = {};
    for (const item of pageItems) {
      const key = itemKey(item);
      if (key) pageItemsById[key] = sameItem(state.itemsById[key], item) ? state.itemsById[key] : item;
    }
    const optimisticItems = Object.values(state.itemsById).filter((item) => {
      const key = itemKey(item);
      return item.optimistic && item.status === "pending" && key && !pageItemsById[key];
    });
    const merged = mergeItems(pageItemsById, optimisticItems);
    const keys = Object.keys(merged);
    const unchanged = keys.length === Object.keys(state.itemsById).length && keys.every((key) => merged[key] === state.itemsById[key]);
    const itemsById = unchanged ? state.itemsById : merged;
    const next: GalleryState = {
      itemsById,
      sortedIds: unchanged ? state.sortedIds : orderedIds(itemsById),
      revision: Number(action.page.revision || state.revision),
      nextCursor: action.page.nextCursor || "",
      hasMore: Boolean(action.page.hasMore),
      loaded: true,
      totalApprox: Math.max(Number(action.page.totalApprox || pageItems.length || 0), Object.keys(itemsById).length),
    };
    const same = (Object.keys(next) as (keyof GalleryState)[]).every((key) => next[key] === state[key]);
    return same ? state : next;
  }
  if (action.type === "append") {
    const pageItems = action.page.items || action.page.outputs || [];
    const itemsById = mergeItems(state.itemsById, pageItems);
    return {
      ...state,
      itemsById,
      sortedIds: itemsById === state.itemsById ? state.sortedIds : orderedIds(itemsById),
      revision: Number(action.page.revision || state.revision),
      nextCursor: action.page.nextCursor || "",
      hasMore: Boolean(action.page.hasMore),
      loaded: true,
      totalApprox: Number(action.page.totalApprox || state.totalApprox),
    };
  }
  if (action.type === "replace") {
    const itemsById = mergeItems({}, action.items);
    return { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), loaded: true, totalApprox: action.items.length };
  }
  if (action.type === "upsert") {
    const itemsById = mergeItems(state.itemsById, action.items);
    // An empty delta must not hand React a new state object: that re-renders the whole app every poll.
    if (itemsById === state.itemsById) return withRevision(state, action.revision);
    const reorder = action.items.some((item) => {
      const previous = state.itemsById[itemKey(item)];
      return !previous || sortFieldsChanged(previous, item);
    });
    return {
      ...state,
      itemsById,
      sortedIds: reorder ? orderedIds(itemsById) : state.sortedIds,
      revision: Number(action.revision || state.revision),
      totalApprox: Math.max(state.totalApprox, Object.keys(itemsById).length),
    };
  }
  if (action.type === "remove") {
    const removeSet = new Set(action.keys);
    let changed = false;
    let removed = 0;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      if (removeSet.has(key) || removeSet.has(item.id) || removeSet.has(item.url) || (item.jobId && removeSet.has(item.jobId))) {
        delete itemsById[key];
        changed = true;
        removed += 1;
      }
    }
    return changed
      ? { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), totalApprox: Math.max(0, state.totalApprox - removed) }
      : withRevision(state, action.revision);
  }
  if (action.type === "removeWhere") {
    let changed = false;
    let removed = 0;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      if (!action.predicate(item)) continue;
      delete itemsById[key];
      changed = true;
      removed += 1;
    }
    return changed
      ? { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), totalApprox: Math.max(0, state.totalApprox - removed) }
      : withRevision(state, action.revision);
  }
  if (action.type === "patch") {
    let changed = false;
    let reorder = false;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      const updated = action.update(item);
      if (sameItem(item, updated)) continue;
      const updatedKey = itemKey(updated) || key;
      if (updatedKey !== key) delete itemsById[key];
      itemsById[updatedKey] = updated;
      changed = true;
      // Progress and previews change every tick during a run; they never move an item.
      reorder ||= updatedKey !== key || sortFieldsChanged(item, updated);
    }
    return changed
      ? { ...state, itemsById, sortedIds: reorder ? orderedIds(itemsById) : state.sortedIds, revision: Number(action.revision || state.revision) }
      : withRevision(state, action.revision);
  }
  return state;
}

export function useGalleryStore({ mode, showFailedItems, search = emptySearch }: { mode: Mode; showFailedItems: boolean; search?: GallerySearch }) {
  const [state, dispatch] = useReducer(galleryReducer, initialState);
  const [loadedKey, setLoadedKey] = useState("");
  const includeFailed = showFailedItems ? "1" : "0";
  // The gallery is searched on the server, which holds all of it; the page only has what it loaded.
  const searchRef = useRef(search);
  searchRef.current = search;
  const searchQuery = () => galleryQuery(searchRef.current);
  // A slower answer to an earlier search must not replace a newer one.
  const loadSeq = useRef(0);
  const searchKey = searchActive(search) ? JSON.stringify([search.q.trim(), search.favorites, ...searchFilterKeys.map((key) => search[key] || [])]) : "";
  const requestKey = JSON.stringify([mode, includeFailed, searchKey]);
  const requestKeyRef = useRef(requestKey);
  const pageSnapshots = useRef(new Map<string, GalleryState>());
  const previousPage = useRef({ key: requestKey, state });
  const restoredPage = useRef<GalleryState | null>(null);
  if (previousPage.current.key === requestKey) previousPage.current.state = state;
  useLayoutEffect(() => {
    if (previousPage.current.key === requestKey) return;
    const previous = previousPage.current;
    if (previous.state.loaded && !JSON.parse(previous.key)[2]) pageSnapshots.current.set(previous.key, previous.state);
    const restored = pageSnapshots.current.get(requestKey);
    restoredPage.current = restored || null;
    previousPage.current = { key: requestKey, state: restored || initialState };
    dispatch({ type: "cross", restore: restored || null });
    setLoadedKey(restored ? requestKey : "");
  }, [requestKey]);
  // Invalidate immediately, including the debounce window and an A → B → A switch.
  if (requestKeyRef.current !== requestKey) {
    requestKeyRef.current = requestKey;
    loadSeq.current += 1;
  }
  const stateRef = useRef(state);
  stateRef.current = state;

  const gallery = useMemo(() => state.sortedIds.map((id) => state.itemsById[id]).filter(Boolean), [state.itemsById, state.sortedIds]);
  const visibleGallery = useMemo(() => gallery.filter((item) => item.type === mode), [gallery, mode]);

  const loadGallery = useCallback(async () => {
    const seq = ++loadSeq.current;
    const restored = restoredPage.current;
    restoredPage.current = null;
    if (restored) {
      const delta = await apiJson<GalleryDelta>(`/api/gallery/delta?since=${restored.revision}&type=${encodeURIComponent(mode)}&includeFailed=${includeFailed}${searchQuery()}`);
      if (seq !== loadSeq.current) return delta;
      if (!delta.reset) {
        if (delta.removes?.length) dispatch({ type: "remove", keys: delta.removes, revision: delta.revision });
        dispatch({ type: "upsert", items: delta.upserts || [], revision: delta.revision });
        setLoadedKey(requestKeyRef.current);
        return delta;
      }
    }
    const page = await apiJson<GalleryPage>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=220&includeFailed=${includeFailed}${searchQuery()}`);
    if (seq !== loadSeq.current) return page;
    dispatch({ type: "reset", page });
    setLoadedKey(requestKeyRef.current);
    return page;
  }, [includeFailed, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new search (or leaving one) reloads the first page; typing waits a beat.
  const loadRef = useRef(loadGallery);
  loadRef.current = loadGallery;
  const lastSearchKey = useRef(searchKey);
  useEffect(() => {
    if (lastSearchKey.current === searchKey) return;
    const typed = lastSearchKey.current.split("\n")[1] === searchKey.split("\n")[1];
    lastSearchKey.current = searchKey;
    const timer = window.setTimeout(() => { loadRef.current().catch(() => null); }, typed ? 140 : 0);
    return () => window.clearTimeout(timer);
  }, [searchKey]);

  // Scroll fires many times near the bottom; one request per cursor at a time.
  const loadingMoreRef = useRef<{ cursor: string; seq: number } | null>(null);
  const loadMoreGalleryItems = useCallback(async () => {
    const seq = loadSeq.current;
    if (!state.hasMore || !state.nextCursor || (loadingMoreRef.current?.cursor === state.nextCursor && loadingMoreRef.current.seq === seq)) return;
    const request = { cursor: state.nextCursor, seq };
    loadingMoreRef.current = request;
    try {
      const page = await apiJson<GalleryPage>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=220&cursor=${encodeURIComponent(state.nextCursor)}&includeFailed=${includeFailed}${searchQuery()}`);
      if (seq === loadSeq.current) dispatch({ type: "append", page });
    } catch {
      // Leave the cursor as it was, so the next scroll or the button tries again.
    } finally {
      if (loadingMoreRef.current === request) loadingMoreRef.current = null;
    }
  }, [includeFailed, mode, state.hasMore, state.nextCursor]);

  const loadGalleryDelta = useCallback(async () => {
    if (!state.revision) return loadGallery();
    const seq = loadSeq.current;
    const delta = await apiJson<GalleryDelta>(`/api/gallery/delta?since=${state.revision}&type=${encodeURIComponent(mode)}&includeFailed=${includeFailed}${searchQuery()}`);
    if (seq !== loadSeq.current) return delta;
    if (delta.reset) return loadGallery();
    if (delta.removes?.length) dispatch({ type: "remove", keys: delta.removes, revision: delta.revision });
    if (delta.upserts?.length) dispatch({ type: "upsert", items: delta.upserts, revision: delta.revision });
    if (!delta.removes?.length && !delta.upserts?.length) dispatch({ type: "upsert", items: [], revision: delta.revision });
    return delta;
  }, [includeFailed, loadGallery, mode, state.revision]);

  const setGallery = useCallback((next: GalleryItem[] | ((current: GalleryItem[]) => GalleryItem[])) => {
    const items = typeof next === "function" ? next(gallery) : next;
    dispatch({ type: "replace", items });
  }, [gallery]);

  const upsertGalleryItems = useCallback((items: GalleryItem[], revision?: number) => dispatch({ type: "upsert", items, revision }), []);
  const removeGalleryItems = useCallback((keys: string[], revision?: number) => dispatch({ type: "remove", keys, revision }), []);
  const removeGalleryItemsWhere = useCallback((predicate: (item: GalleryItem) => boolean, revision?: number) => dispatch({ type: "removeWhere", predicate, revision }), []);
  const patchGalleryItems = useCallback((update: (item: GalleryItem) => GalleryItem, revision?: number) => dispatch({ type: "patch", update, revision }), []);

  return {
    gallery,
    visibleGallery,
    renderedGallery: visibleGallery,
    galleryLoaded: state.loaded && loadedKey === requestKey,
    galleryCrossing: !state.loaded && Boolean(state.crossing),
    hasMoreGallery: state.hasMore,
    galleryTotalApprox: state.totalApprox,
    galleryRevision: state.revision,
    loadGallery,
    loadGalleryDelta,
    loadMoreGalleryItems,
    setGallery,
    upsertGalleryItems,
    removeGalleryItems,
    removeGalleryItemsWhere,
    patchGalleryItems,
  };
}
