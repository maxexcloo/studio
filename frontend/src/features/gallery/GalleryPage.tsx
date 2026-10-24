import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Button, Stack, Text, Tooltip, VisuallyHidden } from "@mantine/core";
import { SquareCheck } from "lucide-react";
import { useDebouncedValue } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { useGenerationActions } from "../generation/GenerationProvider";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { MediaGrid } from "./MediaGrid";
import { MediaTileActions } from "./MediaTileActions";
import { MediaViewer } from "./MediaViewer";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { ComposerDock } from "../generation/ComposerDock";
import { GallerySelectionBar } from "./GallerySelectionBar";
import { useGallerySelection } from "./useGallerySelection";
import {
  GalleryFilterToolbar,
  appendGalleryFilters,
  emptyGalleryFilters,
  hasGalleryFilters,
} from "./GalleryFilters";
interface Page {
  items: MediaItem[];
  nextCursor: string;
  hasMore: boolean;
}
export function GalleryPage() {
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const kind = useLocation().pathname === "/video" ? "video" : "image";
  const { changeKind } = useGenerationActions();
  useEffect(() => {
    changeKind(kind);
  }, [kind, changeKind]);
  const [starred, setStarred] = useState(false);
  const [filters, setFilters] = useState(emptyGalleryFilters);
  const hasFilters = starred || hasGalleryFilters(filters);
  const [pagingFailed, setPagingFailed] = useState(false);
  useEffect(() => setPagingFailed(false), [search, kind, starred, filters]);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const loadTrigger = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const gallery = useInfiniteQuery({
    queryKey: ["gallery", search, kind, starred, filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: "60",
        cursor: pageParam,
        q: search,
        type: kind,
        favorites: starred ? "1" : "0",
      });
      appendGalleryFilters(params, filters);
      return api<Page>(`/api/gallery?${params}`);
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    refetchInterval: 3000,
  });
  useEffect(() => {
    const trigger = loadTrigger.current;
    if (
      !trigger ||
      !gallery.hasNextPage ||
      gallery.isFetching ||
      pagingFailed ||
      gallery.isFetchNextPageError ||
      selected
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void gallery
            .fetchNextPage()
            .then((result) => setPagingFailed(result.isFetchNextPageError));
        }
      },
      { rootMargin: "800px" },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [
    gallery.hasNextPage,
    gallery.isFetching,
    gallery.isFetchNextPageError,
    pagingFailed,
    gallery.fetchNextPage,
    selected,
  ]);
  const items = gallery.data?.pages.flatMap((page) => page.items) || [];
  const selection = useGallerySelection(items, JSON.stringify([kind, search, starred, filters]));
  const selectionButton = useRef<HTMLButtonElement>(null);
  function doneSelecting() {
    selection.end();
    requestAnimationFrame(() => selectionButton.current?.focus());
  }
  return (
    <Stack
      gap="sm"
      className="studio-gallery-page"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          !(event.target as Element).closest('[role="dialog"]') &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a" &&
          !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          selection.selectAll();
        }
      }}
    >
      <VisuallyHidden component="h1">{kind === "video" ? "Videos" : "Images"}</VisuallyHidden>
      {selection.selecting ? (
        <GallerySelectionBar selection={{ ...selection, end: doneSelecting }} />
      ) : (
        <GalleryFilterToolbar
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          value={filters}
          onChange={setFilters}
          starred={starred}
          onStarredChange={setStarred}
          actions={
            !selection.selecting && (
              <Tooltip label="Select Items">
                <ActionIcon
                  ref={selectionButton}
                  aria-label="Select Items"
                  variant="subtle"
                  color="gray"
                  size={44}
                  ml="auto"
                  disabled={!selection.selectable.length}
                  onClick={selection.start}
                >
                  <SquareCheck size={19} />
                </ActionIcon>
              </Tooltip>
            )
          }
        />
      )}
      {gallery.isPending ? (
        <LoadingState fill label="Loading Gallery" />
      ) : gallery.error && !gallery.data ? (
        <Alert color="red" title="Couldn’t Load the Gallery">
          {gallery.error.message}
          <Button variant="subtle" onClick={() => void gallery.refetch()}>
            Try Again
          </Button>
        </Alert>
      ) : items.length ? (
        <MediaGrid
          items={items}
          focusItem={focusItem}
          open={(item) => {
            setFocusItem(null);
            setSelected(item);
          }}
          selection={selection}
          renderActions={(item, opened, onOpenedChange) => (
            <MediaTileActions
              item={item}
              opened={opened}
              onOpenedChange={onOpenedChange}
              onSelect={() => {
                selection.start();
                selection.toggle(item);
              }}
            />
          )}
        />
      ) : (
        <EmptyState fill title={kind === "video" ? "No Videos" : "No Images"}>
          {search || hasFilters ? "Try another search or clear your filters." : undefined}
        </EmptyState>
      )}
      {gallery.hasNextPage && (
        <Stack gap="xs">
          <div ref={loadTrigger} aria-hidden="true" />
          {pagingFailed && (
            <Text size="sm" c="red">
              More results could not be loaded. Try again.
            </Text>
          )}
          <Button
            variant="default"
            loading={gallery.isFetchingNextPage}
            onClick={() =>
              void gallery
                .fetchNextPage()
                .then((result) => setPagingFailed(result.isFetchNextPageError))
            }
          >
            Load More
          </Button>
        </Stack>
      )}
      {!selection.selecting && <ComposerDock />}
      {selected && (
        <MediaViewer
          item={items.find((i) => i.id === selected.id) || selected}
          items={items}
          navigate={setSelected}
          onReturnFocus={(item) => setFocusItem(item.id)}
          close={() => setSelected(null)}
        />
      )}
    </Stack>
  );
}
