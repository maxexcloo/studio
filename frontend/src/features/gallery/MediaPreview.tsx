import { useState } from "react";

import type { MediaItem } from "../../types";
import { MediaViewer } from "./MediaViewer";

/** An image without a gallery record (a card's), as an item the preview shows, named by `name`. */
export const pictureItem = (picture: {
  id: string;
  url: string;
  thumbnailUrl?: string;
  name: string;
  width?: number;
  height?: number;
}): MediaItem => ({
  id: picture.id,
  url: picture.url,
  thumbnailUrl: picture.thumbnailUrl,
  width: picture.width,
  height: picture.height,
  prompt: picture.name,
  type: "image",
  status: "done",
});

/**
 * Items in the bare viewer, to look at rather than work on (references and card images):
 * `open(items, index)` shows them over any dialog, `opened` says while it shows and `element`
 * renders it.
 */
export function useMediaPreview() {
  const [shown, setShown] = useState<{ items: MediaItem[]; id: string } | null>(null);
  const item = shown?.items.find((candidate) => candidate.id === shown.id);
  return {
    open: (items: MediaItem[], index = 0) => setShown({ items, id: items[index].id }),
    opened: Boolean(item),
    element: shown && item && (
      <MediaViewer
        bare
        item={item}
        items={shown.items}
        navigate={(next) => setShown((current) => current && { ...current, id: next.id })}
        close={() => setShown(null)}
      />
    ),
  };
}
