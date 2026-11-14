import { ActionIcon, Alert, ScrollArea, Text, getDefaultZIndex } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "../../api";
import type { MediaItem } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import {
  GalleryFilterPanel,
  emptyGalleryFilters,
  useActiveFilters,
} from "../gallery/GalleryFilters";
import { useImagePreview } from "../gallery/ImagePreview";
import { useWindowSpan } from "../gallery/MediaGrid";
import { MorePages } from "../gallery/MorePages";
import { PickerGrid, PickerHeader, PickerTile } from "./Picker";
import { galleryReferenceType, useGalleryImages } from "./references";
import type { ReferenceBrowser } from "./useReferenceBrowser";

type Tab = ReferenceBrowser["state"]["tab"];

/** The gallery's images, all, starred or uploaded. */
export const galleryTabs: { value: Tab; label: string }[] = [
  { value: "gallery", label: "Gallery" },
  { value: "starred", label: "Starred" },
  { value: "uploads", label: "Uploads" },
];

/**
 * The gallery's images to choose from, as the References sheet and the card editors show them: the
 * picker header (the gallery's tabs and any `more` after them, search, Filter ▾ and `actions`),
 * then the tiles, each with a Preview, paged and virtualised as they scroll in the room they are
 * given, keeping their place in `browser`. An upload's tile deletes it, asking first; `onLayer`
 * hears while that or a preview is open.
 * Render inside a flex column that bounds its height.
 */
export function GalleryChoices({
  label,
  more = [],
  browser,
  enabled,
  actions,
  tile,
  onDeleted,
  onLayer,
}: {
  /** Names the picker and its grid, such as "References". */
  label: string;
  more?: { value: Tab; label: string }[][];
  browser: ReferenceBrowser;
  enabled: boolean;
  actions?: ReactNode;
  /** Each image's tile: its accessible label, from `name`, whether it is chosen and what a tap does. */
  tile: (
    item: MediaItem,
    name: string,
  ) => { label: string; selected: boolean; disabled: boolean; onToggle: () => void };
  onDeleted: (id: string) => void;
  onLayer?: (open: boolean) => void;
}) {
  const tabs = [galleryTabs, ...more];
  const { query, filters } = browser.state;
  const tab = tabs.flat().some((item) => item.value === browser.state.tab)
    ? browser.state.tab
    : "gallery";
  const searched = galleryTabs.find((item) => item.value === tab)?.label;
  const uploads = tab === "uploads";
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  const activeFilters = useActiveFilters({
    kind: "image",
    value: filters,
    onChange: (filters) => browse({ filters }),
  });
  const [search] = useDebouncedValue(query, 250);
  // Starred and Uploads are the gallery's own filters, set by the tab.
  const { listing, items } = useGalleryImages(
    search,
    { ...filters, starred: tab === "starred", uploads },
    enabled,
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const client = useQueryClient();
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (id: string) => api(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async (_result, id) => {
      onDeleted(id);
      await client.invalidateQueries({ queryKey: ["gallery"] });
      setDeleteId(null);
    },
  });
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
  const rowCount = Math.ceil(items.length / columns);
  const span = useWindowSpan(grid, rowCount * pitch, viewport);
  // Until a tile is measured, the first page shows.
  const first = pitch ? Math.max(0, Math.floor(span.top / pitch)) : 0;
  const last = pitch ? Math.min(rowCount, Math.ceil(span.bottom / pitch)) : 60 / columns;
  const shown = items.slice(first * columns, last * columns);
  const restoreScroll = useRef(true);
  useLayoutEffect(() => {
    if (!viewport) restoreScroll.current = true;
    else if (restoreScroll.current && items.length && pitch) {
      viewport.scrollTop = browser.scroll.current;
      restoreScroll.current = false;
    }
  }, [viewport, items.length, pitch, browser.scroll]);
  const preview = useImagePreview();
  const layered = deleteId !== null || preview.opened;
  useEffect(() => onLayer?.(layered), [layered, onLayer]);
  const name = (item: MediaItem, index: number) =>
    item.uploaded ? `Upload ${index + 1}` : item.prompt || "Result";
  const image = (item: MediaItem, index: number) => ({
    src: item.url,
    thumbnailUrl: item.thumbnailUrl,
    alt: name(item, index),
  });
  const morePages = (
    <MorePages
      listing={listing}
      results={JSON.stringify([search, filters, tab])}
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
        onClearFilters={() => browse({ filters: emptyGalleryFilters })}
        actions={actions}
        filters={
          <GalleryFilterPanel
            kind="image"
            value={filters}
            onChange={(filters) => browse({ filters })}
          />
        }
      />
      {/* Loading and empty states fill the space under the header, centred in it. */}
      {listing.isPending ? (
        <LoadingState fill label="Loading Images" />
      ) : listing.error && !listing.data ? (
        <Alert color="red">{listing.error.message}</Alert>
      ) : !items.length ? (
        <EmptyState
          fill
          action={
            <>
              {uploads && (
                <Text size="xs">
                  {search ? "No matching uploads." : "Upload, paste or drop images."}
                </Text>
              )}
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
            {shown.map((item, offset) => {
              const index = first * columns + offset;
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
                    image: image(item, index),
                    open: () => preview.open(items.map(image), index),
                  }}
                  action={
                    item.uploaded && (
                      <ActionIcon
                        variant="default"
                        color="red"
                        aria-label={`Delete Upload ${index + 1}`}
                        onClick={() => {
                          deletion.reset();
                          setDeleteId(item.id);
                        }}
                      >
                        <icons.delete size={14} />
                      </ActionIcon>
                    )
                  }
                />
              );
            })}
          </PickerGrid>
          {morePages}
        </ScrollArea.Autosize>
      )}
      {preview.element}
      <ConfirmDialog
        opened={deleteId !== null}
        title="Delete Upload"
        action="Delete Upload"
        pending={deletion.isPending}
        error={deletion.error?.message}
        // Above the References popover and the card editors over it.
        zIndex={getDefaultZIndex("overlay") + 1}
        onConfirm={() => deleteId && deletion.mutate(deleteId)}
        onClose={() => !deletion.isPending && setDeleteId(null)}
      >
        Delete this upload? References using it will need another image.
      </ConfirmDialog>
    </>
  );
}
