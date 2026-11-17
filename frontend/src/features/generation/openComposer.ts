import { useLocation, useNavigate } from "react-router";

import type { MediaKind } from "../../types";
import { type GalleryState, galleryKind, galleryPath } from "../gallery/viewerLink";

/** Navigation state asking the gallery composer to open and take focus (`ComposerDock`). */
export interface OpenComposerState {
  openComposer?: boolean;
}

/**
 * Every action that stages a draft opens the composer through this: going to the page for `kind`
 * closes what was over it (Library, Settings, another mode, the gallery viewer), then the composer
 * opens there with its prompt focused, or on phones the Generate sheet comes up with the keyboard
 * down. Callers close their own viewer or menu first.
 */
export function useOpenComposer() {
  const navigate = useNavigate();
  const location = useLocation();
  return (kind: MediaKind) => {
    const here = galleryKind(location.pathname) === kind;
    const { set, similar } = (here && (location.state as GalleryState | null)) || {};
    navigate(galleryPath(kind), {
      replace: here,
      state: { set, similar, openComposer: true } satisfies GalleryState & OpenComposerState,
    });
  };
}
