import { Alert, ScrollArea, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type GallerySort, gallerySortGroups } from "../../../../shared/gallery-sort";
import type { MediaItem } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SortMenu } from "../../ui/SortMenu";
import {
  GalleryFilterPanel,
  type GalleryFilterValues,
  ShowToggles,
  emptyGalleryFilters,
  useActiveFilters,
} from "../gallery/GalleryFilters";
import { useWindowSpan } from "../gallery/MediaGrid";
import { useMediaPreview } from "../gallery/MediaPreview";
import { MorePages } from "../gallery/MorePages";
import { versionGroups } from "../gallery/versions";
import { PickerGrid, PickerHeader, PickerTile } from "./Picker";
import { queueQuery } from "./Queue";
import { galleryReferenceType, useGalleryImages } from "./references";
import type { ReferenceBrowser } from "./useReferenceBrowser";

type Tab = ReferenceBrowser["state"]["tab"];

/** The gallery's images, all or uploaded. */
export const galleryTabs: { value: Tab; label: string }[] = [
  { value: "gallery", label: "Gallery" },
  { value: "uploads", label: "Uploads" },
];

/**
 * The gallery's images to choose from, as the References sheet and the card editors show them: the
 * picker header, any notice under it, and paged, virtualised tiles that keep their scroll place
 * in `browser`. `onLayer` hears while a preview is open.
 * Render inside a flex column that bounds its height.
 */
export function GalleryChoices({
  label,
  more = [],
  uploadTile,
  browser,
  enabled,
  sorting,
  notice,
  tile,
  onLayer,
}: {
  /** Names the picker and its grid, such as "References". */
  label: string;
  more?: { value: Tab; label: string }[][];
  uploadTile?: ReactNode;
  browser: ReferenceBrowser;
  enabled: boolean;
  sorting?: { value: GallerySort; onChange: (value: GallerySort) => void };
  notice?: ReactNode;
  /** Each image's tile: its accessible label, from `name`, whether it is chosen and what a tap does. */
  tile: (
    item: MediaItem,
    name: string,
  ) => { label: string; selected: boolean; disabled: boolean; onToggle: () => void };
  onLayer?: (open: boolean) => void;
}) {
  const tabs = [galleryTabs, ...more];
  const { query, filters, originalsOnly } = browser.state;
  const tab = tabs.flat().some((item) => item.value === browser.state.tab)
    ? browser.state.tab
    : "gallery";
  const searched = galleryTabs.find((item) => item.value === tab)?.label;
  const uploads = tab === "uploads";
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  // Uploads is the gallery's own filter, set by the tab; uploads have no ratings, comparisons or
  // versions, so the Show filters stay out of it.
  const applied = uploads
    ? { ...filters, rating: "" as const, comparisons: false, uploads }
    : filters;
  const grouped = !uploads && originalsOnly;
  const filterProps = {
    kind: "image" as const,
    value: filters,
    onChange: (filters: GalleryFilterValues) => browse({ filters }),
  };
  // Filter ▾ counts what the tab applies.
  const activeFilters = useActiveFilters({ ...filterProps, value: applied }, [
    ...(applied.rating === "liked"
      ? [
          {
            key: "liked",
            label: "Liked",
            remove: () => browse({ filters: { ...filters, rating: "" } }),
          },
        ]
      : []),
    ...(grouped
      ? [
          {
            key: "versions",
            label: "Originals Only",
            remove: () => browse({ originalsOnly: false }),
          },
        ]
      : []),
  ]);
  const [search] = useDebouncedValue(query, 250);
  const { listing, items: loaded } = useGalleryImages(search, applied, enabled, sorting?.value);
  const queue = useQuery({ ...queueQuery, enabled: grouped }).data?.jobs;
  const items = grouped ? versionGroups(loaded, queue || []).map((group) => group[0]) : loaded;
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Tiles are square in a CSS grid: its columns and one row's height place every row unmeasured.
  const [rows, setRows] = useState({ columns: 1, pitch: 0 });
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const columns = style.gridTemplateColumns.split(" ").length;
      const tile = element.querySelector<HTMLElement>('[role="listitem"]');
      const pitch = tile ? tile.offsetHeight + (parseFloat(style.rowGap) || 0) : 0;
      setRows((last) =>
        last.columns === columns && last.pitch === pitch ? last : { columns, pitch },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  const { columns, pitch } = rows;
  const leadingTile = uploads && uploadTile;
  const leadingCount = leadingTile ? 1 : 0;
  const rowCount = Math.ceil((items.length + leadingCount) / columns);
  const span = useWindowSpan(grid, rowCount * pitch, viewport);
  // Until a tile is measured, the first page shows.
  const first = pitch ? Math.max(0, Math.floor(span.top / pitch)) : 0;
  const last = pitch ? Math.min(rowCount, Math.ceil(span.bottom / pitch)) : 60 / columns;
  const start = Math.max(0, first * columns - leadingCount);
  const shown = items.slice(start, Math.max(0, last * columns - leadingCount));
  const restoreScroll = useRef(true);
  useLayoutEffect(() => {
    if (!viewport) restoreScroll.current = true;
    else if (restoreScroll.current && items.length && pitch) {
      viewport.scrollTop = browser.scroll.current;
      restoreScroll.current = false;
    }
  }, [viewport, items.length, pitch, browser.scroll]);
  const preview = useMediaPreview();
  useEffect(() => onLayer?.(preview.opened), [preview.opened, onLayer]);
  const name = (item: MediaItem, index: number) =>
    item.uploaded ? `Upload ${index + 1}` : item.prompt || "Result";
  const morePages = (
    <MorePages
      listing={listing}
      results={JSON.stringify([search, filters, tab, sorting?.value])}
      root={items.length ? viewport : null}
    />
  );
  return (
    <>
      <PickerHeader
        label={label}
        tabs={tabs}
        tab={tab}
        onTabChange={(tab) => browse({ tab })}
        searched={searched}
        query={query}
        onQueryChange={(query) => browse({ query })}
        filterCount={activeFilters.length}
        onClearFilters={() => browse({ filters: emptyGalleryFilters, originalsOnly: false })}
        actions={
          sorting && (
            <SortMenu
              label={`Sort ${label}`}
              groups={gallerySortGroups}
              value={sorting.value}
              onChange={(value) => {
                browser.scroll.current = 0;
                viewport?.scrollTo({ top: 0 });
                sorting.onChange(value);
              }}
            />
          )
        }
        filters={
          <GalleryFilterPanel
            {...filterProps}
            toggles={
              !uploads && (
                <ShowToggles
                  {...filterProps}
                  originalsOnly={originalsOnly}
                  onOriginalsOnly={(originalsOnly) => browse({ originalsOnly })}
                />
              )
            }
          />
        }
      />
      {notice}
      {/* Loading and empty states fill the space under the header, centred in it. */}
      {listing.isPending && !leadingTile ? (
        <LoadingState fill label="Loading Images" />
      ) : listing.error && !listing.data && !leadingTile ? (
        <Alert color="red">{listing.error.message}</Alert>
      ) : !items.length && !leadingTile ? (
        <EmptyState
          fill
          action={
            <>
              {uploads && !search && <Text size="xs">Upload, paste or drop images.</Text>}
              {morePages}
            </>
          }
        >
          {search ? "No Matches" : "No Images"}
        </EmptyState>
      ) : (
        <ScrollArea.Autosize
          style={{ flex: 1, minHeight: 0 }}
          viewportRef={setViewport}
          onScrollPositionChange={({ y }) => {
            if (!restoreScroll.current) browser.scroll.current = y;
          }}
        >
          <PickerGrid
            label={`${label} Choices`}
            ref={grid}
            style={{
              paddingTop: first * pitch,
              paddingBottom: Math.max(0, rowCount - last) * pitch,
            }}
          >
            {first === 0 && leadingTile}
            {shown.map((item, offset) => {
              const index = start + offset;
              const title = name(item, index);
              return (
                <PickerTile
                  key={item.id}
                  {...tile(item, title)}
                  image={item.thumbnailUrl || item.url}
                  drag={[galleryReferenceType, JSON.stringify({ id: item.id, type: item.type })]}
                  preview={{
                    // A result's prompt names its tile already.
                    label: item.uploaded ? `Preview ${title}` : "Preview",
                    image: { src: item.url, alt: title },
                    open: () => preview.open(items, index),
                  }}
                />
              );
            })}
          </PickerGrid>
          {leadingTile &&
            (listing.isPending ? (
              <LoadingState label="Loading Images" />
            ) : listing.error && !listing.data ? (
              <Alert color="red">{listing.error.message}</Alert>
            ) : !items.length ? (
              <Text size="xs" c="dimmed" mt="sm">
                {search ? "No matching uploads." : "Upload, paste or drop images."}
              </Text>
            ) : null)}
          {morePages}
        </ScrollArea.Autosize>
      )}
      {preview.element}
    </>
  );
}
