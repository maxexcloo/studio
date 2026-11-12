import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { Button, Title } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import type { MediaItem } from "../../types";
import { dayHeading, mediaDay } from "./mediaLabels";
import classes from "./MediaGrid.module.css";
import { MediaTile } from "./MediaTile";
import type { VersionGroup } from "./versions";
import type { GallerySelection } from "./useGallerySelection";
import { useGalleryLayout, useHoldToSelect, useScrollAnchor } from "./useGalleryLayout";

export interface GalleryViewProps {
  items: MediaItem[];
  /** The search, filters and mode the items answer: new results lay out afresh. */
  results: string;
  /** Opens an item in the viewer; `run`, a job id, keeps its flipping to that run's results. */
  open: (item: MediaItem, run?: string) => void;
  selection: GallerySelection;
  focusItem: string | null;
  caption: "hover" | "pinned" | "none";
  detail: (item: MediaItem) => string;
  renderActions: (
    item: MediaItem,
    opened: boolean,
    onOpenedChange: (opened: boolean) => void,
  ) => ReactNode;
  onSelectionMenu: (x: number, y: number) => void;
  onTryAgain: (item: MediaItem) => void;
  /** Each tile's versions, by its original; Grid shows one tile per group. */
  versions?: Map<string, VersionGroup>;
  /** Items in time order: Grid heads each day and adds the date scrubber. */
  byDay?: boolean;
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

/** Where each tile sits and each day starts, in the grid's own coordinates. */
interface GridLayout {
  tiles: { top: number; left: number; height: number }[];
  /** Each day's first tile and where its heading sits; one undated section when not by day. */
  sections: { day: string; first: number; top: number }[];
  height: number;
}
// A day heading's height, and the space above each day after the first.
const headingHeight = 36;
const sectionSpace = 12;

/** A layout being built, with each lane's next free top. */
type Building = GridLayout & { lanes: number[] };

/**
 * Adds `items` to a masonry of `columns` lanes: each tile joins the shortest lane. With `byDay`,
 * each day starts below the last one's longest lane, under its heading.
 */
function place(
  layout: Building,
  items: MediaItem[],
  columns: number,
  cell: number,
  gap: number,
  byDay: boolean,
) {
  for (const item of items) {
    const index = layout.tiles.length;
    const day = byDay ? mediaDay(item) : "";
    // An undated item stays in the day before it.
    if (!index || (day && day !== layout.sections.at(-1)!.day)) {
      const top = index ? Math.max(...layout.lanes) - gap + sectionSpace : 0;
      layout.sections.push({ day, first: index, top });
      layout.lanes = Array(columns).fill(top + (day ? headingHeight : 0));
    }
    const lane = layout.lanes.indexOf(Math.min(...layout.lanes));
    const height = (cell * (item.height || 1024)) / (item.width || 1024);
    layout.tiles.push({ top: layout.lanes[lane], left: lane * (cell + gap), height });
    layout.lanes[lane] += height + gap;
  }
  layout.height = layout.tiles.length ? Math.max(...layout.lanes) - gap : 0;
  return layout;
}

const layOut = (
  items: MediaItem[],
  columns: number,
  cell: number,
  gap: number,
  byDay: boolean,
): Building =>
  place({ tiles: [], sections: [], height: 0, lanes: [] }, items, columns, cell, gap, byDay);

/**
 * The items to show: new work arriving at the start waits above the grid while its top is out of
 * view or the page is being scrolled, so nothing moves under the person (a browser keeps scrolling
 * past a position set mid-gesture), and shows once the top is in view and scrolling has stopped, or
 * at once from `release` (the "N New" button). Other changes show at once.
 */
function useHeldNewWork(items: MediaItem[], host: RefObject<HTMLDivElement | null>) {
  const [settled, setSettled] = useState(true);
  const [releasing, setReleasing] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const atTop = () => (host.current?.getBoundingClientRect().top ?? 0) >= 0;
    const update = () => {
      setSettled(false);
      clearTimeout(timer);
      // Settled: the grid's top in view and no scrolling for a moment.
      timer = setTimeout(() => setSettled(atTop()), 600);
    };
    setSettled(atTop());
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", update);
    };
  }, [host]);
  const first = useRef<string | undefined>(undefined);
  const open = settled || releasing;
  const start = open
    ? 0
    : Math.max(
        0,
        items.findIndex((item) => item.id === first.current),
      );
  const shown = useMemo(() => (start ? items.slice(start) : items), [items, start]);
  first.current = shown[0]?.id;
  if (releasing && !start) setReleasing(false);
  return {
    items: shown,
    held: start,
    release: () => {
      window.scrollTo({ top: 0 });
      setReleasing(true);
    },
  };
}

/**
 * The part of the grid within a screen of the viewport, in grid coordinates, in steps so scrolling
 * renders only as tiles come and go. Tiles have known sizes, so nothing is measured.
 */
function useWindowSpan(host: RefObject<HTMLDivElement | null>, height: number) {
  const [span, setSpan] = useState({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const step = 200;
    const update = () => {
      if (!host.current) return;
      const offset = -host.current.getBoundingClientRect().top;
      const top = Math.floor((offset - window.innerHeight) / step) * step;
      const bottom = Math.ceil((offset + 2 * window.innerHeight) / step) * step;
      setSpan((last) => (last.top === top && last.bottom === bottom ? last : { top, bottom }));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [host, height]);
  return span;
}

/** Where the grid starts in window scroll coordinates. */
const gridTop = (host: HTMLElement) => host.getBoundingClientRect().top + window.scrollY;

/**
 * A virtualised masonry of every loaded item, or of each version group's original. `byDay` (the
 * gallery in time order) heads each day and adds the date scrubber.
 */
export function MediaGrid({
  items: all,
  results,
  open,
  selection,
  focusItem,
  caption,
  detail,
  renderActions,
  onSelectionMenu,
  onTryAgain,
  versions,
  byDay = false,
}: GalleryViewProps) {
  const { columns, host, width, cell, gap, anchor } = useGalleryLayout();
  const { items, held, release } = useHeldNewWork(all, host);
  // The version each tile shows while flipping, by the tile's original.
  const [shown, setShown] = useState<Record<string, number>>({});
  const pendingFocus = useRef<string | null>(null);
  const [menuItem, setMenuItem] = useState<string | null>(null);
  // Without captions, phone tiles hide their menu button and open the menu by holding.
  const hold = useHoldToSelect(items, selection, caption === "none" ? setMenuItem : undefined);
  const layout = useMemo(
    () => (width ? layOut(items, columns, cell, gap, byDay) : null),
    [items, columns, cell, gap, byDay, width],
  );
  const span = useWindowSpan(host, layout?.height || 0);
  const places = useMemo(
    () => layout && new Map(layout.tiles.map((tile, index) => [items[index].id, tile.top])),
    [layout],
  );
  useScrollAnchor(host, places, `${columns}:${width}:${byDay}:${results}`);
  /** Scrolls a tile into view only as far as it must, as a focus move does. */
  const scrollToTile = useCallback(
    (index: number) => {
      const tile = layout?.tiles[index];
      if (!tile || !host.current) return;
      const top = gridTop(host.current) + tile.top;
      if (top < window.scrollY) window.scrollTo({ top });
      else if (top + tile.height > window.scrollY + window.innerHeight)
        window.scrollTo({ top: top + tile.height - window.innerHeight });
    },
    [layout, host],
  );
  const onArrow = useCallback(
    (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = arrows[event.key];
      const next = direction && items[index + direction];
      if (!next) return;
      event.preventDefault();
      pendingFocus.current = next.id;
      scrollToTile(index + direction);
      // Mounted neighbours can receive focus without waiting for a scroll render.
      if (focusTile(host.current, next.id)) pendingFocus.current = null;
    },
    [items, scrollToTile, host],
  );
  useLayoutEffect(() => {
    if (!layout) return;
    anchor((id) => {
      const index = items.findIndex(
        (item) => item.id === id || versions?.get(item.id)?.some((version) => version.id === id),
      );
      const tile = layout.tiles[index];
      return tile && host.current
        ? { start: gridTop(host.current) + tile.top, size: tile.height }
        : undefined;
    });
  }, [layout]);
  useLayoutEffect(() => {
    if (pendingFocus.current && focusTile(host.current, pendingFocus.current))
      pendingFocus.current = null;
  });
  // The tile the viewer closed on comes into view once, not again whenever the layout changes
  // (new work, a refresh), which would pull the page back to it.
  const shownFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusItem) return void (shownFocus.current = null);
    if (!layout || shownFocus.current === focusItem) return;
    const index = items.findIndex((item) => item.id === focusItem);
    if (index < 0) return;
    shownFocus.current = focusItem;
    pendingFocus.current = focusItem;
    scrollToTile(index);
    if (focusTile(host.current, focusItem)) pendingFocus.current = null;
  }, [focusItem, layout]);
  const within = (top: number, height: number) => top < span.bottom && top + height > span.top;
  return (
    <>
      {held > 0 && (
        <div className={classes.held}>
          <Button
            size="compact-sm"
            radius="xl"
            leftSection={<ArrowUp size={14} />}
            onClick={release}
          >
            {held} New
          </Button>
        </div>
      )}
      <div
        ref={host}
        data-gallery-view
        {...hold.handlers}
        style={{ height: layout?.height, position: "relative", touchAction: "pan-x pan-y" }}
      >
        {layout?.sections.map(
          (section) =>
            section.day &&
            within(section.top, headingHeight) && (
              <Title
                key={`${section.day}:${section.first}`}
                order={2}
                size="h5"
                className={classes.day}
                style={{ transform: `translateY(${section.top}px)` }}
              >
                {dayHeading(section.day)}
              </Title>
            ),
        )}
        {layout?.tiles.map((tile, index) => {
          if (!within(tile.top, tile.height)) return null;
          const original = items[index];
          return (
            <GridCell
              key={original.id}
              original={original}
              index={index}
              left={tile.left}
              top={tile.top}
              width={cell}
              height={tile.height}
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
      {byDay && layout && <DateScrubber host={host} layout={layout} />}
    </>
  );
}

/**
 * The right-edge date scrubber: its thumb follows the page while it scrolls, and dragging it scrolls
 * the gallery, naming the day under the top of the screen. It shows only once the gallery is a few
 * screens long, and fades while the page is still.
 */
function DateScrubber({
  host,
  layout,
}: {
  host: RefObject<HTMLDivElement | null>;
  layout: GridLayout;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ fraction: 0, day: "" });
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const long =
    layout.sections.some((section) => section.day) && layout.height > 3 * window.innerHeight;
  useEffect(() => {
    if (!long) return;
    let idle = 0;
    const update = () => {
      const range = document.documentElement.scrollHeight - window.innerHeight;
      const offset = window.scrollY - (host.current ? gridTop(host.current) : 0);
      // The last day starting above the middle of the screen.
      const sections = layout.sections;
      let low = 0;
      let high = sections.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (sections[middle].top <= offset + window.innerHeight / 3) low = middle;
        else high = middle - 1;
      }
      const day =
        sections
          .slice(0, low + 1)
          .reverse()
          .find((section) => section.day)?.day || "";
      setPosition({ fraction: range > 0 ? Math.min(window.scrollY / range, 1) : 0, day });
      setActive(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setActive(false), 1500);
    };
    update();
    setActive(false);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.clearTimeout(idle);
    };
  }, [long, layout, host]);
  if (!long) return null;
  const scrollTo = (clientY: number) => {
    const rect = track.current!.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    window.scrollTo({
      top: fraction * (document.documentElement.scrollHeight - window.innerHeight),
    });
  };
  const label = position.day ? dayHeading(position.day) : "";
  return (
    <div
      ref={track}
      className={classes.scrubber}
      data-active={active || dragging || undefined}
      role="scrollbar"
      aria-label="Gallery Dates"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position.fraction * 100)}
      aria-valuetext={label}
    >
      <div
        className={classes.thumb}
        style={{ top: `calc(${position.fraction} * (100% - var(--scrubber-thumb)))` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => dragging && scrollTo(event.clientY)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {dragging && label && <span className={classes.date}>{label}</span>}
      </div>
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
