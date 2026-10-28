import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
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
  /** Each tile's versions, by its original; Grid shows one tile per group. */
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

/** A virtualised masonry of every loaded item, or of each version group's original. */
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
  // The version each tile shows while flipping, by the tile's original.
  const [shown, setShown] = useState<Record<string, number>>({});
  const pendingFocus = useRef<string | null>(null);
  const [menuItem, setMenuItem] = useState<string | null>(null);
  const hold = useHoldToSelect(items, selection);
  const dimensions = useMemo(
    () => items.map((item) => `${item.id}:${item.width}:${item.height}`).join("|"),
    [items],
  );
  const virtual = useWindowVirtualizer({
    count: width ? items.length : 0,
    lanes: columns,
    gap: galleryGap,
    estimateSize: (index) => (cell * (items[index].height || 1024)) / (items[index].width || 1024),
    getItemKey: (index) => items[index].id,
    overscan: 2,
    scrollMargin: host.current?.offsetTop || 0,
    // Scrolling renders in React's own time instead of synchronously inside each scroll event.
    useFlushSync: false,
  });
  const onArrow = useCallback(
    (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = arrows[event.key];
      const next = direction && items[index + direction];
      if (!next) return;
      event.preventDefault();
      pendingFocus.current = next.id;
      virtual.scrollToIndex(index + direction, { align: "auto" });
      // Mounted neighbours can receive focus without waiting for a scroll render.
      if (focusTile(host.current, next.id)) pendingFocus.current = null;
    },
    [items, virtual, host],
  );
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
        const original = items[placement.index];
        return (
          <GridCell
            key={original.id}
            original={original}
            index={placement.index}
            left={placement.lane * (cell + galleryGap)}
            top={placement.start - virtual.options.scrollMargin}
            width={cell}
            height={placement.size}
            versions={versions?.get(original.id)}
            version={selection.selecting ? undefined : shown[original.id]}
            setShown={setShown}
            menuItem={menuItem}
            setMenuItem={setMenuItem}
            onArrow={onArrow}
            open={open}
            selection={selection}
            hold={hold}
            caption={caption}
            detail={detail}
            renderActions={renderActions}
            onSelectionMenu={onSelectionMenu}
            onTryAgain={onTryAgain}
          />
        );
      })}
    </div>
  );
}

/**
 * One placed tile. Memoised: a scroll changes which tiles are placed, not the tiles themselves, so
 * only those entering the window render. Every prop is a value or a stable callback.
 */
const GridCell = memo(function GridCell({
  original,
  index,
  left,
  top,
  width,
  height,
  versions,
  version,
  setShown,
  menuItem,
  setMenuItem,
  onArrow,
  open,
  detail,
  renderActions,
  ...tile
}: Pick<
  GalleryViewProps,
  "open" | "selection" | "caption" | "detail" | "renderActions" | "onSelectionMenu" | "onTryAgain"
> & {
  original: MediaItem;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  versions?: VersionGroup;
  version?: number;
  setShown: Dispatch<SetStateAction<Record<string, number>>>;
  menuItem: string | null;
  setMenuItem: (id: string | null) => void;
  onArrow: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void;
  hold: ReturnType<typeof useHoldToSelect>;
}) {
  const item = (version !== undefined && versions?.[version]) || original;
  return (
    <MediaTile
      {...tile}
      item={item}
      group={[original]}
      versions={versions}
      version={version}
      onVersion={(index) =>
        setShown(({ [original.id]: _, ...rest }) =>
          index === undefined ? rest : { ...rest, [original.id]: index },
        )
      }
      detail={detail(item)}
      style={{
        position: "absolute",
        top: 0,
        left,
        width,
        height,
        transform: `translateY(${top}px)`,
      }}
      onOpen={() => open(item)}
      onMenu={() => setMenuItem(item.id)}
      actions={renderActions(item, menuItem === item.id, (opened) =>
        setMenuItem(opened ? item.id : null),
      )}
      onKeyDown={(event) => onArrow(index, event)}
    />
  );
});
