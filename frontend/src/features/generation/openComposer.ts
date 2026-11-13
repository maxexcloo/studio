import { useLocation, useNavigate } from "react-router";
import type { MediaKind } from "../../types";

/** Navigation state asking the gallery composer to open and take focus (`ComposerDock`). */
export interface OpenComposerState {
  openComposer?: boolean;
}

/**
 * Every action that stages a draft opens the composer through this: going to the page for `kind`
 * closes what was over it (Library, Settings, another mode), then the composer opens there with its
 * prompt focused, or on phones the Generate sheet comes up with the keyboard down. Callers close
 * their own viewer or menu first.
 */
export function useOpenComposer() {
  const navigate = useNavigate();
  const location = useLocation();
  return (kind: MediaKind) => {
    const pathname = kind === "video" ? "/video" : "/images";
    const here = location.pathname === pathname;
    const search = new URLSearchParams(here ? location.search : "");
    search.set("compose", "1");
    navigate(
      { pathname, search: `?${search}` },
      { replace: here, state: { openComposer: true } satisfies OpenComposerState },
    );
  };
}
