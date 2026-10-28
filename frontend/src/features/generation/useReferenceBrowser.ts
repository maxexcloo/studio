import { useRef, useState } from "react";
import { emptyGalleryFilters, type GalleryFilterValues } from "../gallery/GalleryFilters";
import type { ReferenceTarget } from "./references";

interface ReferenceBrowserState {
  target: ReferenceTarget | null;
  query: string;
  filters: GalleryFilterValues;
  starred: boolean;
  uploads: boolean;
}

// Owned by the editor so closing or remounting the picker keeps its browsing position.
export function useReferenceBrowser() {
  const [state, setState] = useState<ReferenceBrowserState>({
    target: null,
    query: "",
    filters: emptyGalleryFilters,
    starred: false,
    uploads: false,
  });
  const scroll = useRef(0);
  return { state, setState, scroll };
}
export type ReferenceBrowser = ReturnType<typeof useReferenceBrowser>;
