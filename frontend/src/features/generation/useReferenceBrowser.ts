import { useRef, useState } from "react";
import { emptyGalleryFilters, type GalleryFilterValues } from "../gallery/GalleryFilters";
import type { ReferenceTarget } from "./references";

interface ReferenceBrowserState {
  tab: "gallery" | "characters";
  target: ReferenceTarget | null;
  query: string;
  filters: GalleryFilterValues;
}

// Owned by the editor so closing or remounting the picker keeps its browsing position.
export function useReferenceBrowser() {
  const [state, setState] = useState<ReferenceBrowserState>({
    tab: "gallery",
    target: null,
    query: "",
    filters: emptyGalleryFilters,
  });
  const scroll = useRef(0);
  return { state, setState, scroll };
}
export type ReferenceBrowser = ReturnType<typeof useReferenceBrowser>;
