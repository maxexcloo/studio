import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  type InfiniteData,
  type Query,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";

import { post } from "../../api";
import type { MediaItem, Rating } from "../../types";
import { layerAbove } from "../../ui/popupClicks";
import { queueQuery } from "../generation/Queue";
import { galleryItemQuery, galleryKey } from "./queries";

/** Caches that hold media records, including results opened directly in the viewer. */
const mediaQueries = new Set<string>([
  galleryKey[0],
  galleryItemQuery("").queryKey[0],
  queueQuery.queryKey[0],
  "comparison",
]);
const holdsMedia = (query: Query) => mediaQueries.has(String(query.queryKey[0]));
const ratingsKey = ["ratings"];
/** A gallery list's rating filter (its key's filters, position 3): Liked or Disliked. */
const listRating = (query: Query) =>
  String(query.queryKey[0]) === "gallery"
    ? (query.queryKey[3] as { rating?: string } | undefined)?.rating || ""
    : "";
type Pages = InfiniteData<{ items: MediaItem[]; totalApprox: number }>;
type SavedRating = { was: Rating | null; dream?: { state: string } };

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
      let restores = false;
      for (let offset = 0; offset < ids.length; offset += 500) {
        const result = await post<{ items: SavedRating[] }>("/api/gallery/favorite", {
          ids: ids.slice(offset, offset + 500),
          rating,
          ...(issue && { issue }),
        });
        restores ||=
          rating !== "disliked" &&
          result.items.some(
            (item) =>
              item.was === "disliked" ||
              item.dream?.state === "discarded" ||
              (rating === "liked" && item.dream?.state === "unseen"),
          );
      }
      return restores;
    },
    onMutate: async ({ ids, rating }) => {
      const wanted = new Set(ids);
      // Only reads that hold these items, or the gallery's first-page reads that merge into its
      // listing, could undo the change; other reads and page loads carry on.
      await cache.cancelQueries({
        predicate: (query) =>
          holdsMedia(query) &&
          (query.queryKey[1] === "refresh" ||
            withRating(query.state.data, wanted, rating) !== query.state.data),
      });
      const previous = cache.getQueriesData({ predicate: holdsMedia });
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
        (data) => {
          if (!data?.pages) return data;
          const removed = new Set(
            data.pages.flatMap(({ items }) =>
              items.filter((item) => wanted.has(item.id)).map(({ id }) => id),
            ),
          );
          if (!removed.size) return data;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              totalApprox: Math.max(0, page.totalApprox - removed.size),
              items: page.items.filter((item) => !removed.has(item.id)),
            })),
          };
        },
      );
      return previous.flatMap(([key, data]) => {
        const optimistic = cache.getQueryData(key);
        return optimistic === data ? [] : [{ key, data, optimistic }];
      });
    },
    onError: (_error, _change, previous) =>
      previous?.forEach(({ key, data, optimistic }) => {
        if (cache.getQueryData(key) === optimistic) cache.setQueryData(key, data);
        else void cache.invalidateQueries({ queryKey: key, exact: true });
      }),
    onSettled: (restores, error, { rating }) =>
      void cache.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === galleryKey[0] &&
          Boolean(query.queryKey[3] && typeof query.queryKey[3] === "object") &&
          (Boolean(error) ||
            Boolean(restores) ||
            Boolean(listRating(query)) ||
            ["liked", "disliked"].includes(String(query.queryKey.at(-1))) ||
            (rating === "disliked" && Boolean(query.queryKey[4]))),
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
    priority: 1,
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

const changing = (id?: string) => ({
  mutationKey: ratingsKey,
  status: "pending" as const,
  predicate: (mutation: { state: { variables: unknown } }) =>
    Boolean(id && (mutation.state.variables as RatingChange | undefined)?.ids.includes(id)),
});

/** The shown viewer can outlive the gallery row that supplied its rating. */
export function usePendingRating(id?: string) {
  return useMutationState({
    filters: changing(id),
    select: (mutation) => (mutation.state.variables as RatingChange).rating,
  }).at(-1);
}

/** One item's Like and Dislike toggles. */
export function useMediaRating(item: MediaItem) {
  const cache = useQueryClient();
  const ratings = useRatings();
  const rate = (rating: Rating) => {
    if (cache.isMutating(changing(item.id))) return;
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
    like: () => rate("liked"),
    dislike: () => rate("disliked"),
  };
}
