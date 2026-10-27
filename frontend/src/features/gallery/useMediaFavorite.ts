import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { post } from "../../api";
import type { MediaItem } from "../../types";

/** Caches that hold media records: gallery pages, the reference picker, Chats and the queue. */
const mediaCaches = new Set(["gallery", "reference-gallery", "session", "queue"]);
const holdsMedia = (query: Query) => mediaCaches.has(String(query.queryKey[0]));
/** Lists filtered to starred items (key position 3 in both list keys), which a change alters. */
const starredList = (query: Query) =>
  ["gallery", "reference-gallery"].includes(String(query.queryKey[0])) &&
  query.queryKey[3] === true;

/** Sets `favorite` on every listed media record in a cached response, keeping unchanged parts. */
function withFavorite(value: unknown, ids: Set<string>, favorite: boolean): unknown {
  if (Array.isArray(value)) {
    const next = value.map((entry) => withFavorite(entry, ids, favorite));
    return next.some((entry, index) => entry !== value[index]) ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  let changed: Record<string, unknown> | null = null;
  if (typeof record.id === "string" && ids.has(record.id) && "url" in record)
    if (Boolean(record.favorite) !== favorite) changed = { ...record, favorite };
  for (const [key, entry] of Object.entries(record)) {
    if (!entry || typeof entry !== "object") continue;
    const next = withFavorite(entry, ids, favorite);
    if (next !== entry) (changed ??= { ...record })[key] = next;
  }
  return changed ?? value;
}

/**
 * Stars or unstars items at once in every cached view and rolls back if the server refuses. Only
 * starred-filtered lists refetch afterwards; the rest already show the change.
 */
export function useFavorites() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, favorite }: { ids: string[]; favorite: boolean }) => {
      for (let offset = 0; offset < ids.length; offset += 500)
        await post("/api/gallery/favorite", { ids: ids.slice(offset, offset + 500), favorite });
    },
    onMutate: async ({ ids, favorite }) => {
      await cache.cancelQueries({ predicate: holdsMedia });
      const previous = cache.getQueriesData({ predicate: holdsMedia });
      const wanted = new Set(ids);
      cache.setQueriesData({ predicate: holdsMedia }, (data) =>
        withFavorite(data, wanted, favorite),
      );
      return previous;
    },
    onError: (_error, _change, previous) =>
      previous?.forEach(([key, data]) => cache.setQueryData(key, data)),
    onSettled: () => void cache.invalidateQueries({ predicate: starredList }),
  });
}

/** One item's Star toggle. */
export function useMediaFavorite(item: MediaItem) {
  const favorites = useFavorites();
  return {
    isPending: favorites.isPending,
    mutate: () => favorites.mutate({ ids: [item.id], favorite: !item.favorite }),
  };
}
