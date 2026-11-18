import { useRef, useState } from "react";

import { type GalleryFilterValues, emptyGalleryFilters } from "../gallery/GalleryFilters";
import type { ReferenceTarget } from "./references";

interface ReferenceBrowserState {
  tab: "gallery" | "uploads" | "characters" | "outfits" | "scenes";
  target: ReferenceTarget | null;
  query: string;
  filters: GalleryFilterValues;
  /** Collapses each version chain into its original, as the gallery's Originals Only does. */
  originalsOnly: boolean;
}

// Owned by the editor so closing or remounting the picker keeps its browsing position.
export function useReferenceBrowser() {
  const [state, setState] = useState<ReferenceBrowserState>({
    tab: "gallery",
    target: null,
    query: "",
    filters: emptyGalleryFilters,
    originalsOnly: false,
  });
  const scroll = useRef(0);
  return { state, setState, scroll };
}
export type ReferenceBrowser = ReturnType<typeof useReferenceBrowser>;
