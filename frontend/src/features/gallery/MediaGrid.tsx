import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { MediaItem } from "../../types";
import { MediaTile } from "./MediaTile";
import type { VersionGroup } from "./versions";
import type { GallerySelection } from "./useGallerySelection";
import { galleryGap, useGalleryLayout, useHoldToSelect } from "./useGalleryLayout";

export interface GalleryViewProps {
  items: MediaItem[];
  open: (item: MediaItem) => void;
  selection: GallerySelection;
  focusItem: string | null;
  caption: "hover" | "pinned" | "none";
  detail: (item: MediaItem) => string;
  chatTitle: (id: string) => string | undefined;
  renderActions: (
    item: MediaItem,
    opened: boolean,
    onOpenedChange: (opened: boolean) => void,
  ) => ReactNode;
  onSelectionMenu: (x: number, y: number) => void;
  onTryAgain: (item: MediaItem) => void;
  /** Each tile's versions, by its latest item; Grid shows one tile per group. */
  versions?: Map<string, VersionGroup>;
}

/**
 * Focuses a mounted tile, or the run stack holding it, now; returns false while virtualisation
 * has yet to render it.
 */
export function focusTile(host: HTMLElement | null, id: string) {
  const value = CSS.escape(id);
  const button =
    host?.querySelector<HTMLButtonElement>(`[data-media-id="${value}"]:not([data-media-group])`) ||
    host?.querySelector<HTMLButtonElement>(`[data-media-group~="${value}"]`);
  if (!button) return false;
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: "nearest" });
  return true;
}

const arrows: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** A virtualised masonry of every loaded item, or of each version group's latest. */
export function MediaGrid({
  items,
  open,
  selection,
  focusItem,
  caption,
  detail,
  renderActions,
  onSelectionMenu,
  onTryAgain,
  versions,
}: GalleryViewProps) {
  const { columns, host, width, cell } = useGalleryLayout();
  // The version each tile shows while flipping, by the tile's latest item.
  const [shown, setShown] = useState<Record<string, number>>({});
  const pendingFocus = useRef<string | null>(null);
  const [menuItem, setMenuItem] = useState<string | null>(null);
  const hold = useHoldToSelect(items, selection);
  const dimensions = items.map((item) => `${item.id}:${item.width}:${item.height}`).join("|");
  const virtual = useWindowVirtualizer({
    count: width ? items.length : 0,
    lanes: columns,
    gap: galleryGap,
    estimateSize: (index) => (cell * (items[index].height || 1024)) / (items[index].width || 1024),
    getItemKey: (index) => items[index].id,
    overscan: 2,
    scrollMargin: host.current?.offsetTop || 0,
  });
  useLayoutEffect(() => virtual.measure(), [width, columns, dimensions, virtual]);
  useLayoutEffect(() => {
    if (pendingFocus.current && focusTile(host.current, pendingFocus.current))
      pendingFocus.current = null;
  });
  useLayoutEffect(() => {
    if (!focusItem || !width) return;
    const index = items.findIndex((item) => item.id === focusItem);
    if (index < 0) return;
    pendingFocus.current = focusItem;
    virtual.scrollToIndex(index, { align: "auto" });
    if (focusTile(host.current, focusItem)) pendingFocus.current = null;
  }, [focusItem, width, virtual]);
  return (
    <div
      ref={host}
      {...hold.handlers}
      style={{ height: virtual.getTotalSize(), position: "relative" }}
    >
      {virtual.getVirtualItems().map((placement) => {
        const latest = items[placement.index];
        const group = versions?.get(latest.id);
        const version = selection.selecting ? undefined : shown[latest.id];
        const item = (version !== undefined && group?.[version]) || latest;
        return (
          <MediaTile
            key={latest.id}
            item={item}
            group={[latest]}
            versions={group}
            version={version}
            onVersion={(index) =>
              setShown(({ [latest.id]: _, ...rest }) =>
                index === undefined ? rest : { ...rest, [latest.id]: index },
              )
            }
            selection={selection}
            hold={hold}
            caption={caption}
            detail={detail(item)}
            style={{
              position: "absolute",
              top: 0,
              left: placement.lane * (cell + galleryGap),
              width: cell,
              height: placement.size,
              transform: `translateY(${placement.start - virtual.options.scrollMargin}px)`,
            }}
            onOpen={() => open(item)}
            onMenu={() => setMenuItem(item.id)}
            onSelectionMenu={onSelectionMenu}
            onTryAgain={onTryAgain}
            actions={renderActions(item, menuItem === item.id, (opened) =>
              setMenuItem(opened ? item.id : null),
            )}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const direction = arrows[event.key];
              const next = direction && items[placement.index + direction];
              if (!next) return;
              event.preventDefault();
              pendingFocus.current = next.id;
              virtual.scrollToIndex(placement.index + direction, { align: "auto" });
              // Mounted neighbours can receive focus without waiting for a scroll render.
              if (focusTile(host.current, next.id)) pendingFocus.current = null;
            }}
          />
        );
      })}
    </div>
  );
}
