import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { GalleryVertical, LayoutGrid, Layers, SquareCheck } from "lucide-react";
import { useDebouncedValue } from "@mantine/hooks";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router";
import { useGenerationActions } from "../generation/GenerationProvider";
import { queueQuery, terminal } from "../generation/Queue";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { MediaGrid } from "./MediaGrid";
import { RunsView } from "./RunsView";
import { MediaTileActions } from "./MediaTileActions";
import { MediaViewer } from "./MediaViewer";
import { currentMedia } from "./mediaSource";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { ComposerDock } from "../generation/ComposerDock";
import { GallerySelectionBar } from "./GallerySelectionBar";
import { useGallerySelection } from "./useGallerySelection";
import { useTileCaptions } from "./useGalleryLayout";
import { useTryAgain } from "./useTryAgain";
import { useVersionGroups } from "./versions";
import { mediaDetail } from "./mediaLabels";
import { appendGalleryFilters, emptyGalleryFilters, galleryFacetsQuery } from "./GalleryFilters";
import { GalleryToolbar } from "./GalleryToolbar";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { chipProps, iconChipProps } from "../generation/chip";
import classes from "./GalleryPage.module.css";

interface Page {
  items: MediaItem[];
  nextCursor: string;
  hasMore: boolean;
  /** How many items match, across every page. */
  totalApprox: number;
}
export function GalleryPage() {
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const kind = useLocation().pathname === "/video" ? "video" : "image";
  const { changeKind, profiles } = useGenerationActions();
  useEffect(() => {
    changeKind(kind);
  }, [kind, changeKind]);
  const phone = usePhone();
  const [captions] = useTileCaptions();
  const [view, setView] = useRemembered<"grid" | "runs">("gallery-view", "grid");
  const [allVersions, setAllVersions] = useRemembered("gallery-all-versions", true);
  const [filters, setFilters] = useRemembered("gallery-filters", emptyGalleryFilters);
  const [pagingFailed, setPagingFailed] = useState(false);
  useEffect(() => setPagingFailed(false), [search, kind, filters]);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const loadTrigger = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  // A caption tag in Details links here as ?q=<tag>: it becomes the search and closes the viewer.
  const [params, setParams] = useSearchParams();
  const linkedQuery = params.get("q");
  useEffect(() => {
    if (linkedQuery === null) return;
    setQuery(linkedQuery);
    setSelected(null);
    setParams(
      (next) => {
        next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [linkedQuery, setParams]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const client = useQueryClient();
  // Queue changes (new, finished or failed work) refresh the gallery at once; only active work
  // polls, for live previews. An idle gallery never polls.
  const jobs = useQuery({
    ...queueQuery,
    select: (data) => ({
      key: data.jobs.map((job) => `${job.id}:${job.status}`).join(),
      active: data.jobs.some((job) => !terminal.has(job.status)),
    }),
  }).data;
  const gallery = useInfiniteQuery({
    queryKey: ["gallery", search, kind, filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "60", cursor: pageParam, q: search, type: kind });
      appendGalleryFilters(params, filters);
      return api<Page>(`/api/gallery?${params}`);
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    // Search and filter changes keep the current results until the new ones arrive; switching
    // between Images and Videos never shows the other mode's results.
    placeholderData: (previous, query) => (query?.queryKey[2] === kind ? previous : undefined),
    refetchInterval: jobs?.active ? 3000 : false,
  });
  const seenJobs = useRef(jobs?.key);
  useEffect(() => {
    if (seenJobs.current === jobs?.key) return;
    seenJobs.current = jobs?.key;
    void client.invalidateQueries({ queryKey: ["gallery"] });
  }, [jobs?.key, client]);
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
  const loaded = useMemo(
    () => gallery.data?.pages.flatMap((page) => page.items) || [],
    [gallery.data],
  );
  // Every generation shows by default; turning All Versions off collapses each version chain into
  // one Grid tile showing its original. Runs always shows all.
  const groups = useVersionGroups(loaded);
  const grouped = view === "grid" && !allVersions;
  const versions = useMemo(
    () => (grouped ? new Map(groups.map((group) => [group[0].id, group])) : undefined),
    [grouped, groups],
  );
  const items = useMemo(
    () => (versions ? [...versions.values()].map((group) => group[0]) : loaded),
    [versions, loaded],
  );
  const selection = useGallerySelection(items, JSON.stringify([kind, search, filters]));
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(emptyGalleryFilters) || grouped;
  const clearFilters = () => {
    setFilters(emptyGalleryFilters);
    setAllVersions(true);
  };
  const tryAgain = useTryAgain(loaded);
  const facets = useQuery({ ...galleryFacetsQuery(kind), enabled: view === "runs" });
  // Stable, so the views' memoised tiles render only when their own item changes.
  const openItem = useCallback((item: MediaItem) => {
    setFocusItem(null);
    setSelected(item);
  }, []);
  const detail = useCallback((item: MediaItem) => mediaDetail(item, profiles), [profiles]);
  const chatTitle = useCallback(
    (id: string) => facets.data?.chats.find((chat) => chat.value === id)?.label,
    [facets.data],
  );
  const openSelectionMenu = useCallback((x: number, y: number) => setMenu({ x, y }), []);
  const tryAgainItem = useCallback(
    (item: MediaItem) => tryAgain([item.jobId || ""]).then(() => undefined),
    [tryAgain],
  );
  const selectionButton = useRef<HTMLButtonElement>(null);
  function doneSelecting() {
    selection.end();
    setMenu(null);
    requestAnimationFrame(() => selectionButton.current?.focus());
  }
  const View = view === "runs" ? RunsView : MediaGrid;
  return (
    <Stack
      gap="sm"
      className={classes.page}
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          !(event.target as Element).closest('[role="dialog"]') &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a" &&
          !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          selection.select(() => true);
        }
      }}
    >
      <VisuallyHidden component="h1">{kind === "video" ? "Videos" : "Images"}</VisuallyHidden>
      {selection.selecting ? (
        <GallerySelectionBar
          selection={{ ...selection, end: doneSelecting }}
          tryAgain={tryAgain}
          menu={menu}
          onMenuClose={() => setMenu(null)}
        />
      ) : (
        <GalleryToolbar
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          value={filters}
          onChange={setFilters}
          count={gallery.data?.pages.at(-1)?.totalApprox}
          extraChips={
            grouped
              ? [{ key: "versions", label: "Grouped Versions", remove: () => setAllVersions(true) }]
              : []
          }
          view={
            <Group gap={6} wrap="nowrap">
              <SegmentedControl
                aria-label="Gallery View"
                size="xs"
                radius="xl"
                value={view}
                onChange={(value) => setView(value as "grid" | "runs")}
                data={[
                  {
                    value: "grid",
                    label: <ViewLabel icon={<LayoutGrid size={14} />} text="Grid" />,
                  },
                  { value: "runs", label: <ViewLabel icon={<Layers size={14} />} text="Runs" /> },
                ]}
              />
              {view === "grid" && (
                <Button
                  {...chipProps}
                  aria-label="All Versions"
                  aria-pressed={allVersions}
                  variant={allVersions ? "light" : "default"}
                  leftSection={<GalleryVertical size={15} />}
                  onClick={() => setAllVersions(!allVersions)}
                >
                  All Versions
                </Button>
              )}
            </Group>
          }
          actions={
            <Tooltip label="Select Items" disabled={!phone}>
              <Button
                {...(phone ? iconChipProps : chipProps)}
                ref={selectionButton}
                aria-label="Select Items"
                leftSection={phone ? undefined : <SquareCheck size={15} />}
                disabled={!items.length}
                onClick={selection.start}
              >
                {phone ? <SquareCheck size={16} /> : "Select"}
              </Button>
            </Tooltip>
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
        <div className={classes.results} data-stale={gallery.isPlaceholderData || undefined}>
          <View
            items={items}
            versions={versions}
            focusItem={focusItem}
            open={openItem}
            selection={selection}
            caption={phone ? (captions ? "pinned" : "none") : "hover"}
            detail={detail}
            chatTitle={chatTitle}
            onSelectionMenu={openSelectionMenu}
            onTryAgain={tryAgainItem}
            renderActions={renderTileActions}
          />
        </div>
      ) : (
        <EmptyState
          fill
          action={
            hasFilters && (
              <Button variant="default" onClick={clearFilters}>
                Clear Filters
              </Button>
            )
          }
        >
          {search || hasFilters ? "No Matches" : kind === "video" ? "No Videos" : "No Images"}
        </EmptyState>
      )}
      {gallery.hasNextPage && (
        <Center mih={44}>
          <div ref={loadTrigger} aria-hidden="true" />
          {pagingFailed ? (
            <Stack gap={4} align="center">
              <Text size="sm" c="dimmed">
                More results couldn’t be loaded.
              </Text>
              <Button
                variant="default"
                radius="xl"
                loading={gallery.isFetchingNextPage}
                onClick={() =>
                  void gallery
                    .fetchNextPage()
                    .then((result) => setPagingFailed(result.isFetchNextPageError))
                }
              >
                Try Again
              </Button>
            </Stack>
          ) : (
            gallery.isFetchingNextPage && (
              <Loader size="sm" color="gray" aria-label="Loading More" />
            )
          )}
        </Center>
      )}
      {!selection.selecting && <ComposerDock />}
      {selected && (
        <MediaViewer
          item={currentMedia(loaded, selected)}
          items={
            versions
              ? [...versions.values()].map(
                  (group) => group.find((version) => version.id === selected.id) || group[0],
                )
              : items
          }
          navigate={setSelected}
          onReturnFocus={(item) => setFocusItem(item.id)}
          close={() => setSelected(null)}
        />
      )}
    </Stack>
  );
}

function renderTileActions(
  item: MediaItem,
  opened: boolean,
  onOpenedChange: (opened: boolean) => void,
) {
  return <MediaTileActions item={item} opened={opened} onOpenedChange={onOpenedChange} />;
}

function ViewLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Center inline className={classes.viewLabel}>
      {icon}
      <span>{text}</span>
    </Center>
  );
}
