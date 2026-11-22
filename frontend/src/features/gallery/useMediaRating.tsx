import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  type InfiniteData,
  type Query,
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { post } from "../../api";
import type { MediaItem, Rating } from "../../types";
import { layerAbove } from "../../ui/popupClicks";
import { queueQuery } from "../generation/Queue";
import { galleryKey } from "./queries";

/** Caches that hold media records: gallery pages (the reference picker's too) and the queue. */
const holdsMedia = (query: Query) =>
  [galleryKey[0], queueQuery.queryKey[0]].includes(String(query.queryKey[0]));
const ratingsKey = ["ratings"];
/** A gallery list's rating filter (its key's filters, position 3): Liked or Disliked. */
const listRating = (query: Query) =>
  String(query.queryKey[0]) === "gallery"
    ? (query.queryKey[3] as { rating?: string } | undefined)?.rating || ""
    : "";
type Pages = InfiniteData<{ items: MediaItem[] }>;

/** Sets `rating` on every listed media record in a cached response, keeping unchanged parts. */
function withRating(value: unknown, ids: Set<string>, rating: Rating | null): unknown {
  if (Array.isArray(value)) {
    const next = value.map((entry) => withRating(entry, ids, rating));
    return next.some((entry, index) => entry !== value[index]) ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  let changed: Record<string, unknown> | null = null;
  if (typeof record.id === "string" && ids.has(record.id) && "url" in record)
    if ((record.rating ?? null) !== rating) {
      const { rating: _rating, ...rest } = record;
      changed = rating ? { ...rest, rating } : rest;
    }
  for (const [key, entry] of Object.entries(record)) {
    if (!entry || typeof entry !== "object") continue;
    const next = withRating(entry, ids, rating);
    if (next !== entry) (changed ??= { ...record })[key] = next;
  }
  return changed ?? value;
}

interface RatingChange {
  ids: string[];
  /** Liked, disliked, or null to take a rating back. */
  rating: Rating | null;
  /** The issue Report Issue names with its dislike, for the taste profile. */
  issue?: string;
}

/**
 * Likes, dislikes or clears items at once in every cached view and rolls back if the server
 * refuses. It removes items from rating filters or lists that hide dislikes as needed, then
 * refreshes listings whose membership or order can change.
 */
export function useRatings() {
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ratingsKey,
    mutationFn: async ({ ids, rating, issue }: RatingChange) => {
      for (let offset = 0; offset < ids.length; offset += 500)
        await post("/api/gallery/favorite", {
          ids: ids.slice(offset, offset + 500),
          rating,
          ...(issue && { issue }),
        });
    },
    onMutate: async ({ ids, rating }) => {
      await cache.cancelQueries({ predicate: holdsMedia });
      const previous = cache.getQueriesData({ predicate: holdsMedia });
      const wanted = new Set(ids);
      cache.setQueriesData({ predicate: holdsMedia }, (data) => withRating(data, wanted, rating));
      cache.setQueriesData<Pages>(
        {
          queryKey: galleryKey,
          predicate: (query) => {
            const filter = listRating(query);
            if (filter) return filter !== rating;
            const showsDisliked = query.queryKey.at(-1) === "disliked" && !query.queryKey[4];
            return !showsDisliked && rating === "disliked";
          },
        },
        (data) =>
          data?.pages
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => !wanted.has(item.id)),
                })),
              }
            : data,
      );
      return previous;
    },
    onError: (_error, _change, previous) =>
      previous?.forEach(([key, data]) => cache.setQueryData(key, data)),
    onSettled: (_data, _error, { rating }) =>
      void cache.invalidateQueries({
        predicate: (query) =>
          Boolean(listRating(query)) ||
          (query.queryKey[0] === galleryKey[0] &&
            ["liked", "disliked"].includes(String(query.queryKey.at(-1)))) ||
          (rating !== "liked" && String(query.queryKey[0]) === "gallery"),
      }),
  });
}

/**
 * A dislike leaves a brief Undo beside the gallery. Earlier ones stay under Disliked.
 */
export function showDisliked(
  count: number,
  undo: () => void,
  owner = document.activeElement?.closest<HTMLElement>('[role="dialog"]'),
) {
  const notification = notifications.show({
    autoClose: 8000,
    position: "top-right",
    role: "status",
    withCloseButton: false,
    message: (
      <Group gap="xs" wrap="nowrap">
        <Text size="sm">{count === 1 ? "Disliked" : `${count} disliked`}</Text>
        <Button
          size="compact-sm"
          variant="subtle"
          onClick={() => {
            notifications.hide(notification);
            undo();
            if (owner?.isConnected && !layerAbove(owner)) owner.focus({ preventScroll: true });
          }}
        >
          Undo
        </Button>
      </Group>
    ),
  });
}

/** One item's Like and Dislike toggles, pending while a change to that item is. */
export function useMediaRating(item: MediaItem) {
  const ratings = useRatings();
  const pending = useIsMutating({
    mutationKey: ratingsKey,
    predicate: (mutation) =>
      (mutation.state.variables as RatingChange | undefined)?.ids.includes(item.id) ?? false,
  });
  const rate = (rating: Rating) => {
    const was = item.rating ?? null;
    const next = was === rating ? null : rating;
    const change = { ids: [item.id], rating: next };
    if (next !== "disliked") return ratings.mutate(change);
    const owner = document.activeElement?.closest<HTMLElement>('[role="dialog"]');
    void ratings.mutateAsync(change).then(
      () => showDisliked(1, () => ratings.mutate({ ids: change.ids, rating: was }), owner),
      () => {},
    );
  };
  return {
    isPending: pending > 0,
    like: () => rate("liked"),
    dislike: () => rate("disliked"),
  };
}
