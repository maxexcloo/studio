import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { LayoutGrid, Layers, SquareCheck } from "lucide-react";
import { useDebouncedValue, useLocalStorage } from "@mantine/hooks";
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
import {
  GalleryFilterToolbar,
  appendGalleryFilters,
  emptyGalleryFilters,
  galleryFacetsQuery,
  hasGalleryFilters,
} from "./GalleryFilters";
import { usePhone } from "../../ui/usePhone";
import { chipProps, iconChipProps } from "../generation/chip";
import classes from "./GalleryPage.module.css";

interface Page {
  items: MediaItem[];
  nextCursor: string;
  hasMore: boolean;
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
  const [view, setView] = useLocalStorage<"grid" | "runs">({
    key: "studio-gallery-view",
    defaultValue: "grid",
    getInitialValueInEffect: false,
  });
  const [starred, setStarred] = useState(false);
  const [allVersions, setAllVersions] = useLocalStorage({
    key: "studio-gallery-all-versions",
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  const [filters, setFilters] = useState(emptyGalleryFilters);
  const hasFilters = starred || hasGalleryFilters(filters);
  const [pagingFailed, setPagingFailed] = useState(false);
  useEffect(() => setPagingFailed(false), [search, kind, starred, filters]);
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
  // Grid shows each version chain as one tile, its original; Runs and All Versions show all.
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
  const selection = useGallerySelection(items, JSON.stringify([kind, search, starred, filters]));
  const tryAgain = useTryAgain(loaded);
  const facets = useQuery({ ...galleryFacetsQuery(kind), enabled: view === "runs" });
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
        <GalleryFilterToolbar
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          value={filters}
          onChange={setFilters}
          starred={starred}
          onStarredChange={setStarred}
          allVersions={allVersions}
          onAllVersionsChange={view === "grid" ? setAllVersions : undefined}
          leading={
            <SegmentedControl
              aria-label="Gallery View"
              size="sm"
              classNames={{
                root: classes.view,
                control: classes.viewControl,
                label: classes.viewControl,
              }}
              radius="xl"
              value={view}
              onChange={(value) => setView(value as "grid" | "runs")}
              data={[
                { value: "grid", label: <ViewLabel icon={<LayoutGrid size={15} />} text="Grid" /> },
                { value: "runs", label: <ViewLabel icon={<Layers size={15} />} text="Runs" /> },
              ]}
            />
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
            open={(item) => {
              setFocusItem(null);
              setSelected(item);
            }}
            selection={selection}
            caption={phone ? (captions ? "pinned" : "none") : "hover"}
            detail={(item) => mediaDetail(item, profiles)}
            chatTitle={(id) => facets.data?.chats.find((chat) => chat.value === id)?.label}
            onSelectionMenu={(x, y) => setMenu({ x, y })}
            onTryAgain={(item) => tryAgain([item.jobId || ""]).then(() => undefined)}
            renderActions={(item, opened, onOpenedChange) => (
              <MediaTileActions item={item} opened={opened} onOpenedChange={onOpenedChange} />
            )}
          />
        </div>
      ) : (
        <EmptyState fill>
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

function ViewLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Center inline className={classes.viewLabel}>
      {icon}
      <span>{text}</span>
    </Center>
  );
}
