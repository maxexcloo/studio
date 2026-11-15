import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { post } from "../../api";
import type { ReferenceAsset } from "../../types";

/**
 * Edit's Use as Character, Use as Outfit and Use as Scene open their Library section with
 * `cardFrom` (a gallery image's ID) in the route state; this takes the image as a reference asset
 * and hands it to `start`, which opens a new card with it.
 */
export function useCardFrom(start: (asset: ReferenceAsset) => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { cardFrom?: string } | null)?.cardFrom;
  const take = useMutation({
    mutationFn: (galleryItemId: string) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", { galleryItemId }),
    onSuccess: ({ asset }) => start(asset),
  });
  const started = useRef("");
  useEffect(() => {
    if (!from || started.current === from) return;
    started.current = from;
    take.mutate(from);
    // The image is taken; a reload or Back opens the section without starting another card.
    navigate(location, { replace: true, state: { ...location.state, cardFrom: undefined } });
  }, [from]);
  return take;
}
