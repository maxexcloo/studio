import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import type { CardKind } from "../../../../shared/characters";
import { post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";

/** What a chat called a result's character, outfit or scene, which a new card starts with. */
export interface CardNamed {
  name: string;
  description?: string;
}

/**
 * Edit's Use as Character, Use as Outfit and Use as Scene open their Library section with
 * `cardFrom` (a gallery image's ID) and any `cardNamed` in the route state (useStartCard); this
 * takes the image as a reference asset and hands it to `start`, which opens a new card with it.
 */
export function useCardFrom(start: (asset: ReferenceAsset, named?: CardNamed) => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { cardFrom?: string; cardNamed?: CardNamed } | null;
  const from = state?.cardFrom;
  // The name travels with the call: the route state is cleared before the image is taken.
  const take = useMutation({
    mutationFn: ({ galleryItemId }: { galleryItemId: string; named?: CardNamed }) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", { galleryItemId }),
    onSuccess: ({ asset }, { named }) => start(asset, named),
  });
  const started = useRef("");
  useEffect(() => {
    if (!from || started.current === from) return;
    started.current = from;
    take.mutate({ galleryItemId: from, named: state?.cardNamed });
    // The image is taken; a reload or Back opens the section without starting another card.
    navigate(location, {
      replace: true,
      state: { ...location.state, cardFrom: undefined, cardNamed: undefined },
    });
  }, [from]);
  return take;
}

/**
 * Opens `kind`'s Library section over the gallery with a new card started from `item`'s image,
 * named and described as the chat that made it said (its result set's `context`).
 */
export function useStartCard() {
  const location = useLocation();
  const navigate = useNavigate();
  return (kind: CardKind, item: MediaItem) =>
    navigate(`/library#${kind}`, {
      state: {
        // The gallery under Library, without its viewer.
        backgroundLocation: location.state?.backgroundLocation || {
          ...location,
          search: location.search.replace(/[?&]item=[^&]*/, "").replace(/^&/, "?"),
        },
        cardFrom: item.id,
        cardNamed: item.resultSet?.context?.[cardNoun[kind]],
      },
    });
}

const cardNoun = { characters: "character", outfits: "outfit", scenes: "scene" } as const;
