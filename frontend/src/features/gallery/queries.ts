import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { GallerySort } from "../../../../shared/gallery-sort";
import { api } from "../../api";
import type { MediaItem, MediaKind } from "../../types";
import { type GalleryFilterValues, appendGalleryFilters } from "./GalleryFilters";
import { isResultNumber } from "./viewerLink";

/** Every gallery listing's key starts with this, so invalidating it refreshes them all. */
export const galleryKey = ["gallery"] as const;
export interface GalleryResultsPage {
  items: MediaItem[];
  nextCursor: string;
  hasMore: boolean;
  /** How many items match, across every page. */
  totalApprox: number;
}
/** What a gallery listing shows; equal listings share their pages. */
export interface GalleryListing {
  search: string;
  kind: MediaKind;
  filters: GalleryFilterValues;
  sort?: GallerySort;
  similar?: string;
  strictness?: string;
  setId?: string;
  /** One MCP chat's results (its conversation id), or one turn of it. */
  chat?: string;
  turn?: string;
}
export type GalleryQuickSelect = "all" | "failed";

export function galleryPage(
  listing: GalleryListing,
  cursor: string,
  signal?: AbortSignal,
  selection?: GalleryQuickSelect,
) {
  const params = new URLSearchParams({
    limit: "60",
    cursor,
    q: listing.search,
    type: listing.kind,
  });
  appendGalleryFilters(params, listing.filters);
  if (listing.sort && listing.sort !== "newest") params.set("sort", listing.sort);
  if (listing.similar) {
    params.set("similar", listing.similar);
    params.set("strictness", listing.strictness || "");
  }
  if (listing.setId) params.set("set", listing.setId);
  if (listing.chat) params.set("chat", listing.chat);
  if (listing.chat && listing.turn) params.set("turn", listing.turn);
  if (selection) params.set("select", selection);
  return api<GalleryResultsPage>(`/api/gallery?${params}`, { signal });
}
export const galleryQuery = (listing: GalleryListing) =>
  infiniteQueryOptions({
    // The kind stays third: GalleryPage keeps results only while it matches.
    queryKey: [
      ...galleryKey,
      listing.search,
      listing.kind,
      listing.filters,
      listing.similar ? [listing.similar, listing.strictness] : null,
      listing.setId || null,
      listing.chat ? [listing.chat, listing.turn || null] : null,
      listing.sort || "newest",
    ],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => galleryPage(listing, pageParam, signal),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });

/** One gallery item in full: gallery pages leave out its prompt's thinking, which Details reads here. */
export const galleryItemQuery = (id: string) =>
  queryOptions({
    queryKey: ["gallery-item", id],
    queryFn: () => api<{ item: MediaItem }>(`/api/gallery/items/${encodeURIComponent(id)}`),
    retry: false,
  });

/** Resolves an account's result number without changing the media-ID API used by Details. */
export const viewerItemQuery = (id: string) =>
  isResultNumber(id)
    ? queryOptions({
        queryKey: [...galleryKey, "result", id],
        queryFn: () => api<{ item: MediaItem }>(`/api/gallery/results/${id}`),
        retry: false,
      })
    : galleryItemQuery(id);
