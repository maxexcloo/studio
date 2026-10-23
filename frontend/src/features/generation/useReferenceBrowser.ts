import { useRef, useState } from "react";
import { emptyGalleryFilters, type GalleryFilterValues } from "../gallery/GalleryFilters";

interface ReferenceBrowserState {
  chosenSlot: string | null;
  query: string;
  source: "gallery" | "uploads";
  filters: GalleryFilterValues;
  starred: boolean;
}

// Owned by the editor so closing or remounting the picker keeps its browsing position.
export function useReferenceBrowser() {
  const [state, setState] = useState<ReferenceBrowserState>({
    chosenSlot: null,
    query: "",
    source: "gallery",
    filters: emptyGalleryFilters,
    starred: false,
  });
  const scroll = useRef(0);
  return { state, setState, scroll };
}
export type ReferenceBrowser = ReturnType<typeof useReferenceBrowser>;
