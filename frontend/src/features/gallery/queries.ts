import { infiniteQueryOptions } from "@tanstack/react-query";

import { api } from "../../api";
import type { MediaItem, MediaKind } from "../../types";
import { type GalleryFilterValues, appendGalleryFilters } from "./GalleryFilters";

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
  similar?: string;
  strictness?: string;
  setId?: string;
}
export function galleryPage(listing: GalleryListing, cursor: string, limit = 60) {
  const params = new URLSearchParams({
    limit: String(limit),
    cursor,
    q: listing.search,
    type: listing.kind,
  });
  appendGalleryFilters(params, listing.filters);
  if (listing.similar) {
    params.set("similar", listing.similar);
    params.set("strictness", listing.strictness || "");
  }
  if (listing.setId) params.set("set", listing.setId);
  return api<GalleryResultsPage>(`/api/gallery?${params}`);
}
/** A gallery listing a page at a time; `limit` sizes each page after the first. */
export const galleryQuery = (
  listing: GalleryListing,
  limit: (cursor: string) => number = () => 60,
) =>
  infiniteQueryOptions({
    // The kind stays third: GalleryPage keeps results only while it matches.
    queryKey: [
      ...galleryKey,
      listing.search,
      listing.kind,
      listing.filters,
      listing.similar ? [listing.similar, listing.strictness] : null,
      listing.setId || null,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam }) => galleryPage(listing, pageParam, limit(pageParam)),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
