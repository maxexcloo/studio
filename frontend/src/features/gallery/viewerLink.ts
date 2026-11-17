import type { MediaKind } from "../../types";

/** Generated outputs use their permanent account number; uploads already have short IDs. */
export const viewerItemId = (item: { id: string; number?: number }) =>
  item.number ? String(item.number) : item.id;

export const isResultNumber = (id: string) => /^[1-9]\d{0,8}$/.test(id);

export const galleryPath = (kind: MediaKind) => (kind === "video" ? "/videos" : "/images");

/** The gallery a path shows, with or without an item in its viewer. */
export const galleryKind = (pathname: string): MediaKind | undefined =>
  /^\/images(\/|$)/.test(pathname)
    ? "image"
    : /^\/videos(\/|$)/.test(pathname)
      ? "video"
      : undefined;

/** An item's permanent address: `/images/<id>` or `/videos/<id>`. */
export const viewerPath = (item: { id: string; number?: number; type: MediaKind }) =>
  `${galleryPath(item.type)}/${encodeURIComponent(viewerItemId(item))}`;

/**
 * The gallery's transient state, held in history rather than the address: a result set or
 * Similar ranking shown alone, a search from a caption tag, an image shared to the installed app,
 * or an MCP chat's results: one turn, or the whole chat with `show` "chat".
 */
export interface GalleryState {
  chat?: string;
  q?: string;
  set?: string;
  shared?: string;
  show?: string;
  similar?: string;
  turn?: string;
}
