import { useQueryClient } from "@tanstack/react-query";

import { post } from "../../api";
import type { MediaItem } from "../../types";
import { queueQuery } from "../generation/Queue";
import { galleryKey } from "./queries";
import { useItemMutation } from "./useItemMutation";

/** A video edit backend/gallery/video-edits.js saves as a new version of the clip. */
export type VideoEdit = { kind: "reverse" | "loop" | "smooth" | "slow" };

/** Edit › a video edit; the original stays and the edited clip joins its versions. */
export function useVideoEdit(item: MediaItem) {
  const cache = useQueryClient();
  return useItemMutation(item.id, "video-edit", {
    mutationFn: (edit: VideoEdit) =>
      post<{ id: string }>("/api/gallery/video-edit", { galleryItemId: item.id, ...edit }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: galleryKey });
      void cache.invalidateQueries({ queryKey: queueQuery.queryKey });
    },
  });
}
