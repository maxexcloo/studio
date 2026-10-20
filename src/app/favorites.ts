import React from 'react';
import { ApiError, apiJson } from './api';
import type { GalleryItem } from './types';
import type { ShowToast } from './toast';

/**
 * Stars on images. A star is kept with the image on the server (the gallery's
 * list, or Hidden's encrypted one), shows at once here, and is taken back if
 * the server says no. "Favourites" in the gallery search shows only these.
 */

export type GallerySearch = { q: string; favorites: boolean; lora?: string; model?: string; workflow?: string; size?: string; aspect?: string };
export const emptySearch: GallerySearch = { q: "", favorites: false };

export function searchActive(search?: GallerySearch | null) {
  return Boolean(search && (search.q.trim() || search.favorites || search.model?.trim() || search.workflow?.trim() || search.lora?.trim() || search.size || search.aspect));
}

export function canStar(item: GalleryItem | null | undefined) {
  return Boolean(item && item.status === "done" && item.url && !item.vaultLocked && !item.run);
}

function withStar(item: GalleryItem, favorite: boolean): GalleryItem {
  const { favorite: _favorite, ...rest } = item;
  return favorite ? { ...rest, favorite: true } : rest;
}

type FavoritesOptions = {
  patchGalleryItems: (update: (item: GalleryItem) => GalleryItem) => void;
  removeGalleryItems: (keys: string[]) => void;
  setActive: React.Dispatch<React.SetStateAction<GalleryItem | null>>;
  search: GallerySearch;
  showToast: ShowToast;
};

export function useFavorites({ patchGalleryItems, removeGalleryItems, setActive, search, showToast }: FavoritesOptions) {
  const latest = React.useRef({ patchGalleryItems, removeGalleryItems, setActive, search, showToast });
  latest.current = { patchGalleryItems, removeGalleryItems, setActive, search, showToast };
  // Stable, so memoised tiles do not redraw when anything else changes.
  return React.useCallback(async (items: GalleryItem[], favorite: boolean) => {
    const targets = items.filter(canStar);
    if (!targets.length) return;
    const ids = new Set(targets.map((item) => item.id));
    const apply = (value: boolean) => {
      latest.current.patchGalleryItems((item) => (ids.has(item.id) ? withStar(item, value) : item));
      latest.current.setActive((current) => (current && ids.has(current.id) ? withStar(current, value) : current));
    };
    apply(favorite);
    // Its URL as well as its id: the server finds a record by either, so a copy whose id differs (a run's, an older client's) still matches.
    const keysOf = (list: GalleryItem[]) => [...new Set(list.flatMap((item) => [item.id, item.url]).filter((key): key is string => Boolean(key)))];
    const post = (url: string, list: GalleryItem[]) => list.length
      ? apiJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: keysOf(list), favorite }) })
      : Promise.resolve(null);
    try {
      await Promise.all([
        post("/api/gallery/favorite", targets.filter((item) => !item.privateVault)),
        post("/api/hidden/favorite", targets.filter((item) => item.privateVault))
      ]);
      // Showing only favourites: an image unstarred there leaves the list. The
      // gallery's list is the server's filtered page, so it goes from it; Hidden
      // keeps its whole list here and filters in memory, so it stays in it.
      const leaving = targets.filter((item) => !item.privateVault).map((item) => item.id);
      if (!favorite && latest.current.search.favorites && leaving.length) latest.current.removeGalleryItems(leaving);
    } catch (error) {
      apply(!favorite);
      latest.current.showToast(starError(error), "error");
      console.warn("[Studio] Star not saved", error);
    }
  }, []);
}

/** What went wrong, with the server's status, so a report says which request failed and why. */
export function starError(error: unknown) {
  const detail = error instanceof ApiError ? `${error.message} (HTTP ${error.status}${error.reason ? `, ${error.reason}` : ""})`
    : error instanceof Error ? error.message : String(error || "");
  return detail ? `Couldn’t save the star: ${detail}` : "Couldn’t save the star";
}

/** Starring from any tile, without threading props through the masonry. */
export const FavoriteContext = React.createContext<((items: GalleryItem[], favorite: boolean) => void) | null>(null);
