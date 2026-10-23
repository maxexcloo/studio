import { useMutation, useQueryClient } from "@tanstack/react-query";
import { failure, post } from "../../api";
import type { MediaItem } from "../../types";

export function useMediaFavorite(item: MediaItem) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => post("/api/gallery/favorite", { ids: [item.id], favorite: !item.favorite }),
    onError: failure,
    onSettled: () =>
      Promise.all(
        ["gallery", "gallery-filters", "session"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}
