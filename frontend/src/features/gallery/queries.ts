import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { GallerySort } from "../../../../shared/gallery-sort";
import { api } from "../../api";
import type { MediaItem, MediaKind } from "../../types";
import {
  type GalleryFilterValues,
  appendGalleryFilters,
  emptyGalleryFilters,
} from "./GalleryFilters";
import { isResultNumber } from "./viewerLink";

/** Every gallery listing's key starts with this, so invalidating it refreshes them all. */
export const galleryKey = ["gallery"] as const;
interface GalleryChatSet {
  id: string;
  title: string | null;
  series: string | null;
  notes: string | null;
  count: number;
  at: number | null;
}

export const galleryChatSetsQuery = (type: MediaKind, chat: string, turn: string) =>
  queryOptions({
    queryKey: [...galleryKey, "chat-sets", type, chat, turn],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ type, chat });
      if (turn) params.set("turn", turn);
      return api<{ sets: GalleryChatSet[] }>(`/api/gallery/chat-sets?${params}`, { signal });
    },
    staleTime: 30_000,
  });

export interface GalleryResultsPage {
  items: MediaItem[];
  nextCursor: string;
  previousCursor?: string;
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
export type GalleryReviewRating = "all" | "unrated" | "liked" | "disliked";

export interface GalleryDate {
  day: string;
  count: number;
  cursor: string;
}

export interface GalleryPageParam {
  cursor: string;
  previous?: boolean;
}

function galleryParams(listing: GalleryListing) {
  const params = new URLSearchParams({
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
  return params;
}

export function galleryPage(
  listing: GalleryListing,
  cursor: string,
  signal?: AbortSignal,
  {
    selection,
    windowed,
    previous,
    review,
  }: {
    selection?: GalleryQuickSelect;
    windowed?: boolean;
    previous?: boolean;
    review?: { rating: GalleryReviewRating; since: number };
  } = {},
) {
  const params = galleryParams(listing);
  params.set("limit", "60");
  params.set(previous ? "beforeCursor" : "cursor", cursor);
  if (selection) params.set("select", selection);
  if (windowed) params.set("window", "1");
  if (review) {
    params.set("unreviewed", "1");
    if (review.rating === "unrated") params.set("unrated", "1");
    if (review.since) params.set("since", new Date(review.since).toISOString());
  }
  return api<GalleryResultsPage>(`/api/gallery?${params}`, { signal });
}

export const galleryListingKey = (listing: GalleryListing) =>
  [
    ...galleryKey,
    listing.search,
    // The kind stays third: GalleryPage keeps results only while it matches.
    listing.kind,
    listing.filters,
    listing.similar ? [listing.similar, listing.strictness] : null,
    listing.setId || null,
    listing.chat ? [listing.chat, listing.turn || null] : null,
    listing.sort || "newest",
  ] as const;

export const galleryTimelineQuery = (listing: GalleryListing) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return queryOptions({
    queryKey: [...galleryListingKey(listing), "timeline", timeZone],
    queryFn: ({ signal }) => {
      const params = galleryParams(listing);
      params.set("timeZone", timeZone);
      return api<{ days: GalleryDate[] }>(`/api/gallery/timeline?${params}`, { signal });
    },
    staleTime: 60_000,
  });
};

export const galleryArrivalsQuery = (listing: GalleryListing, leftAt: number) =>
  queryOptions({
    queryKey: ["gallery-arrivals", galleryListingKey(listing), leftAt],
    queryFn: async ({ signal }) => {
      const params = galleryParams({ ...listing, sort: "newest" });
      params.set("finished", "1");
      params.set("limit", "1");
      params.set("since", new Date(leftAt + 1).toISOString());
      const results = await api<GalleryResultsPage>(`/api/gallery?${params}`, { signal });
      return results.items.length > 0;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** How many results a listing holds, reading a single item; `unrated` counts Review's. */
async function galleryCount(listing: GalleryListing, signal: AbortSignal, unrated?: boolean) {
  const params = galleryParams(listing);
  params.set("limit", "1");
  if (unrated) {
    params.set("unrated", "1");
    params.set("unreviewed", "1");
  }
  return (await api<GalleryResultsPage>(`/api/gallery?${params}`, { signal })).totalApprox;
}

/** How many results the gallery, Uploads and Review (unrated) each hold, for the view menu. */
export const galleryViewCountsQuery = (kind: MediaKind) =>
  queryOptions({
    queryKey: [...galleryKey, "view-counts", kind],
    queryFn: async ({ signal }) => {
      const count = (uploads: boolean, unrated?: boolean) =>
        galleryCount(
          { search: "", kind, filters: { ...emptyGalleryFilters, uploads } },
          signal,
          unrated,
        );
      const [gallery, uploads, review] = await Promise.all([
        count(false),
        count(true),
        count(false, true),
      ]);
      return { gallery, uploads, review };
    },
    staleTime: 30_000,
  });

/** How many results a saved view's listing holds, for the view menu. */
export const galleryListingCountQuery = (listing: GalleryListing) =>
  queryOptions({
    queryKey: [...galleryListingKey(listing), "count"],
    queryFn: ({ signal }) => galleryCount(listing, signal),
    staleTime: 30_000,
  });

/**
 * The newest finished images Face Check compared with a character card, each with its `identity`,
 * worst match first: off-character ones, then by face similarity, those without a face last.
 */
export const characterResultsQuery = (characterId: string) =>
  queryOptions({
    queryKey: [...galleryKey, "character", characterId],
    queryFn: async ({ signal }) => {
      const params = galleryParams({ search: "", kind: "image", filters: emptyGalleryFilters });
      params.set("character", characterId);
      params.set("finished", "1");
      params.set("limit", "200");
      const { items } = await api<GalleryResultsPage>(`/api/gallery?${params}`, { signal });
      const rank = ({ identity }: MediaItem) => [
        identity?.drifted ? 0 : 1,
        // Similarity runs to 1; no face sorts after every score.
        identity?.score ?? 2,
      ];
      return items.sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        return x[0] - y[0] || x[1] - y[1];
      });
    },
  });

export const galleryReviewQuery = (
  listing: GalleryListing,
  rating: GalleryReviewRating,
  since: number,
) => {
  const reviewed: GalleryListing = {
    ...listing,
    filters: {
      ...listing.filters,
      rating: rating === "liked" || rating === "disliked" ? rating : "",
    },
  };
  return infiniteQueryOptions({
    queryKey: ["gallery-review", galleryListingKey(reviewed), rating, since],
    queryFn: ({ pageParam, signal }) =>
      galleryPage(reviewed, pageParam, signal, { review: { rating, since } }),
    initialPageParam: "",
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    staleTime: Infinity,
    gcTime: 0,
  });
};

export const galleryQuery = (listing: GalleryListing, windowCursor?: string) =>
  infiniteQueryOptions({
    queryKey:
      windowCursor === undefined
        ? galleryListingKey(listing)
        : [...galleryListingKey(listing), "window", windowCursor],
    initialPageParam: { cursor: windowCursor ?? "" } as GalleryPageParam,
    queryFn: ({ pageParam, signal }) =>
      galleryPage(listing, pageParam.cursor, signal, {
        windowed: windowCursor !== undefined,
        previous: pageParam.previous,
      }),
    getNextPageParam: (last) => (last.hasMore ? { cursor: last.nextCursor } : undefined),
    getPreviousPageParam: (first) =>
      first.previousCursor ? { cursor: first.previousCursor, previous: true } : undefined,
  });

/** One gallery item in full: gallery pages leave out its prompt's thinking, which Details reads here. */
export const galleryItemQuery = (id: string) =>
  queryOptions({
    queryKey: ["gallery-item", id],
    queryFn: () => api<{ item: MediaItem }>(`/api/gallery/items/${encodeURIComponent(id)}`),
  });

/** Resolves an account's result number without changing the media-ID API used by Details. */
export const viewerItemQuery = (id: string) =>
  isResultNumber(id)
    ? queryOptions({
        queryKey: [...galleryKey, "result", id],
        queryFn: () => api<{ item: MediaItem }>(`/api/gallery/results/${id}`),
      })
    : galleryItemQuery(id);
