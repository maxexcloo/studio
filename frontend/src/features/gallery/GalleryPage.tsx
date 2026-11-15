import {
  Alert,
  Button,
  Center,
  SegmentedControl,
  Stack,
  Switch,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  type InfiniteData,
  focusManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LayoutGrid, Rows3, SquareCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { terminalStatuses } from "../../../../shared/queue";
import type { MediaItem, MediaKind } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { chipProps, iconChipProps } from "../generation/chip";
import { ComposerDock } from "../generation/ComposerDock";
import { useGenerationActions } from "../generation/GenerationProvider";
import type { OpenComposerState } from "../generation/openComposer";
import { queueQuery } from "../generation/Queue";
import { useTileCaptions } from "../settings/accountPreferences";
import { emptyGalleryFilters } from "./GalleryFilters";
import { GallerySelectionBar } from "./GallerySelectionBar";
import { GalleryToolbar } from "./GalleryToolbar";
import { GalleryUpload, droppedFiles, useGalleryUpload } from "./GalleryUpload";
import { MediaGrid } from "./MediaGrid";
import { mediaDetail, mediaTitle } from "./mediaLabels";
import { currentMedia, mediaIdentity, reconcileViewerItems } from "./mediaSource";
import { MediaTileActions } from "./MediaTileActions";
import { MediaViewer } from "./MediaViewer";
import { MorePages } from "./MorePages";
import {
  type GalleryResultsPage,
  galleryKey,
  galleryPage,
  galleryQuery,
  viewerItemQuery,
} from "./queries";
import { inRunOrder, runKey } from "./resultSets";
import { RunsView } from "./RunsView";
import {
  type SimilarStrictness,
  similarChipLabels,
  similarStrictnessOptions,
  useSimilarStrictness,
} from "./similarStrictness";
import { useGallerySelection } from "./useGallerySelection";
import { useTryAgain } from "./useTryAgain";
import { versionGroups } from "./versions";
import { viewerItemId } from "./viewerLink";

import classes from "./GalleryPage.module.css";

export function GalleryPage() {
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const location = useLocation();
  const routerNavigate = useNavigate();
  const kind = location.pathname === "/video" ? "video" : "image";
  const { changeKind, profiles } = useGenerationActions();
  useEffect(() => {
    changeKind(kind);
  }, [kind, changeKind]);
  const phone = usePhone();
  const [captions] = useTileCaptions();
  const [view, setView] = useRemembered<"grid" | "runs">("gallery-view", "grid");
  const [allVersions, setAllVersions] = useRemembered("gallery-all-versions", true);
  const [filters, setFilters] = useRemembered("gallery-filters", emptyGalleryFilters);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  // The run (a job or result set, `runKey`) whose results the viewer flips through; unset, it
  // flips through the whole gallery.
  const [run, setRun] = useState<string>();
  // A caption tag in Details links here as ?q=<tag>: it becomes the search and closes the viewer.
  const [params, setParams] = useSearchParams();
  const linkedQuery = params.get("q");
  // The viewer's item (?item=<id>): opening one adds a history entry, so Back closes it, and
  // flipping through items replaces it.
  const itemId = params.get("item") || "";
  // A set link (?set=<id>) shows that MCP result set alone until its chip is removed.
  const setId = params.get("set") || "";
  // Similar links here as ?similar=<item id>: the gallery ranked by likeness to that image,
  // within the filters, until its chip is removed.
  const similar = params.get("similar") || "";
  const [strictness, setStrictness] = useSimilarStrictness();
  const removeSimilar = useCallback(
    () =>
      setParams((next) => {
        next.delete("similar");
        return next;
      }),
    [setParams],
  );
  useEffect(() => {
    if (similar) window.scrollTo(0, 0);
  }, [similar]);
  useEffect(() => {
    if (linkedQuery === null) return;
    setQuery(linkedQuery);
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
  // polls, for live previews; an idle gallery waits for the queue's own idle check.
  const jobs = useQuery({
    ...queueQuery,
    select: (data) => ({
      key: data.jobs.map((job) => `${job.id}:${job.status}`).join(),
      active: data.jobs.some((job) => !terminalStatuses.has(job.status)),
    }),
  }).data;
  const listing = useMemo(
    () => ({ search, kind, filters, similar, strictness, setId }) as const,
    [search, kind, filters, similar, strictness, setId],
  );
  // The listing key (as JSON) whose every match a quick select is loading: its later pages,
  // refetches included, then come 500 at a time.
  const everyMatch = useRef("");
  const listingQuery = useMemo(() => {
    const options = galleryQuery(listing, (cursor) =>
      cursor && everyMatch.current === JSON.stringify(options.queryKey) ? 500 : 60,
    );
    return options;
  }, [listing]);
  const listingKey = listingQuery.queryKey;
  const gallery = useInfiniteQuery({
    ...listingQuery,
    // Search and filter changes keep the current results until the new ones arrive; switching
    // between Images and Videos never shows the other mode's results.
    placeholderData: (previous, query) => (query?.queryKey[2] === kind ? previous : undefined),
    // Returning to the tab reads only the first page (below), not every loaded page.
    refetchOnWindowFocus: false,
  });
  // Query ownership deduplicates overlapping signals and cancels reads on account changes or
  // optimistic media mutations. Refreshes keep loaded pages and their continuation cursors.
  const refresh = useQuery({
    queryKey: [...galleryKey, "refresh", ...listingKey.slice(1)],
    enabled: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const held = client.getQueryData<InfiniteData<GalleryResultsPage, string>>(listingKey);
      const known = new Set(held?.pages.flatMap((page) => page.items.map(mediaIdentity)));
      const first = await galleryPage(listing, "", 60, signal);
      // If more than a page arrived while away, bridge to the held results sequentially so no
      // matches disappear between the fresh first page and the old continuation cursor.
      let edge = first;
      while (
        known.size &&
        edge.hasMore &&
        !edge.items.some((item) => known.has(mediaIdentity(item)))
      ) {
        edge = await galleryPage(listing, edge.nextCursor, 60, signal);
        first.items.push(...edge.items);
      }
      if (signal.aborted) return first;
      client.setQueryData<InfiniteData<GalleryResultsPage, string>>(listingKey, (data) => {
        if (!data) return data;
        const ids = new Set(first.items.map((item) => item.id));
        const replaced = new Set(
          first.items.flatMap((item) =>
            item.jobId && item.index !== undefined ? [`${item.jobId}-${item.index}`] : [],
          ),
        );
        const keep = (item: MediaItem) => !ids.has(item.id) && !replaced.has(item.id);
        return {
          ...data,
          pages: data.pages.map((page, index) => ({
            ...page,
            ...(!index && !page.items.length && data.pages.length === 1
              ? { hasMore: first.hasMore, nextCursor: first.nextCursor }
              : {}),
            totalApprox: first.totalApprox,
            items: index ? page.items.filter(keep) : [...first.items, ...page.items.filter(keep)],
          })),
        };
      });
      return first;
    },
  });
  const { refetch: readFirst } = refresh;
  const pendingFirst = useRef<typeof listingKey | null>(null);
  const refreshFirst = useCallback(() => {
    if (client.isFetching({ queryKey: listingKey, exact: true })) {
      pendingFirst.current = listingKey;
      return;
    }
    pendingFirst.current = null;
    if (client.getQueryData(listingKey)) void readFirst({ cancelRefetch: false });
  }, [client, listingKey, readFirst]);
  useEffect(
    () => () => {
      pendingFirst.current = null;
    },
    [listingKey],
  );
  // A final job can finish during pagination: once it settles there may be no active poll left.
  useEffect(() => {
    if (!gallery.isFetching && pendingFirst.current === listingKey) refreshFirst();
  }, [gallery.isFetching, gallery.dataUpdatedAt, gallery.errorUpdatedAt, listingKey, refreshFirst]);
  // Active work's tiles are the newest, on the first page: only it polls, for live previews.
  // Starting or finishing work uses the same first-page read, never a full pagination refetch.
  useEffect(() => {
    if (!jobs?.active) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshFirst();
    }, 3000);
    return () => clearInterval(timer);
  }, [jobs?.active, refreshFirst]);
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) void refreshFirst();
      }),
    [refreshFirst],
  );
  const seenJobs = useRef(jobs?.key);
  useEffect(() => {
    if (seenJobs.current === jobs?.key) return;
    seenJobs.current = jobs?.key;
    void refreshFirst();
  }, [jobs?.key, refreshFirst]);
  const loaded = useMemo(
    () => gallery.data?.pages.flatMap((page) => page.items) || [],
    [gallery.data],
  );
  // A linked item not on a loaded page is read on its own; one that leaves the gallery while
  // shown stays until the viewer moves on.
  const listed = itemId
    ? loaded.find((candidate) => viewerItemId(candidate) === itemId || candidate.id === itemId)
    : undefined;
  const link = useQuery({
    ...viewerItemQuery(itemId),
    enabled: Boolean(itemId && !listed && !gallery.isPending),
  });
  const lastShown = useRef<MediaItem | null>(null);
  const selected =
    listed ||
    link.data?.item ||
    (itemId && lastShown.current && viewerItemId(lastShown.current) === itemId
      ? lastShown.current
      : null);
  const shown = selected && currentMedia(loaded, selected);
  lastShown.current = selected;
  useEffect(() => {
    if (!shown || viewerItemId(shown) === itemId) return;
    setParams(
      (next) => {
        next.set("item", viewerItemId(shown));
        return next;
      },
      { replace: true, state: location.state },
    );
  }, [shown, itemId, setParams, location.state]);
  // Every generation shows by default; turning All Versions off collapses each version chain into
  // one Grid tile showing its original. Runs always shows all.
  const queue = useQuery(queueQuery).data?.jobs;
  const groups = useMemo(() => versionGroups(loaded, queue || []), [loaded, queue]);
  const grouped = view === "grid" && !allVersions;
  const versions = useMemo(
    () => (grouped ? new Map(groups.map((group) => [group[0].id, group])) : undefined),
    [grouped, groups],
  );
  const items = useMemo(
    () => (versions ? [...versions.values()].map((group) => group[0]) : loaded),
    [versions, loaded],
  );
  const candidates = useMemo(
    () =>
      run
        ? inRunOrder(loaded.filter((candidate) => runKey(candidate) === run))
        : versions
          ? [...versions.values()].map(
              (group) => group.find((version) => version.id === shown?.id) || group[0],
            )
          : items,
    [run, loaded, versions, shown?.id, items],
  );
  const viewerOrder = useRef<{
    scope: string;
    items: MediaItem[];
    retained: Map<string, MediaItem>;
    total?: number;
  } | null>(null);
  const viewerScope = JSON.stringify([listingKey, run, grouped]);
  if (!itemId) viewerOrder.current = null;
  else {
    const previous = viewerOrder.current;
    const retained = new Map(previous?.scope === viewerScope ? previous.retained : []);
    // Dislike hides the current tile, but it remains a neighbour until this viewer closes.
    if (shown) retained.set(mediaIdentity(shown), shown);
    for (const candidate of candidates) retained.delete(mediaIdentity(candidate));
    const next =
      previous?.scope === viewerScope
        ? reconcileViewerItems(previous.items, candidates, [...retained.values()])
        : candidates;
    const reset =
      previous?.scope !== viewerScope ||
      !previous.items.length ||
      (shown && !next.some((item) => mediaIdentity(item) === mediaIdentity(shown)));
    viewerOrder.current = {
      scope: viewerScope,
      items: reset ? candidates : next,
      retained,
      total: reset ? gallery.data?.pages.at(-1)?.totalApprox : previous.total,
    };
  }
  const viewerItems = viewerOrder.current?.items || candidates;
  // The query the shown results answer: placeholder results still answer the previous one.
  const [resultsKey, setResultsKey] = useState(() => JSON.stringify(listingKey));
  if (!gallery.isPlaceholderData && resultsKey !== JSON.stringify(listingKey))
    setResultsKey(JSON.stringify(listingKey));
  const loadEveryMatch = useCallback(async () => {
    everyMatch.current = JSON.stringify(listingKey);
    let result = gallery;
    while (result.hasNextPage && !result.isFetchNextPageError)
      result = await result.fetchNextPage({ cancelRefetch: false });
    return !result.hasNextPage;
  }, [listingKey, gallery]);
  const selection = useGallerySelection(
    items,
    JSON.stringify([kind, search, filters, similar, strictness, setId]),
    {
      complete: !gallery.hasNextPage,
      load: loadEveryMatch,
    },
  );
  const hasFilters =
    JSON.stringify(filters) !== JSON.stringify(emptyGalleryFilters) || grouped || Boolean(similar);
  const clearFilters = () => {
    setFilters(emptyGalleryFilters);
    setAllVersions(true);
    removeSimilar();
  };
  // The image ranks first, being most like itself, unless the filters leave it out.
  const similarSource = loaded.find((item) => item.id === similar);
  const tryAgain = useTryAgain(loaded);
  // Stable, so the views' memoised tiles and the composer render only when their own state
  // changes: `setParams` and the search change with every step through the viewer.
  const latest = useRef({ setParams, search: location.search });
  latest.current = { setParams, search: location.search };
  const openItem = useCallback((item: MediaItem, run?: string) => {
    setFocusItem(null);
    setRun(run);
    latest.current.setParams(
      (next) => {
        next.set("item", viewerItemId(item));
        return next;
      },
      { state: { viewer: true } },
    );
  }, []);
  const dropParam = useCallback(
    (name: string) =>
      latest.current.setParams(
        (next) => {
          next.delete(name);
          return next;
        },
        { replace: true },
      ),
    [],
  );
  // The composer's output toggle switches the gallery; the route restores that output's draft.
  const switchKind = useCallback(
    (next: MediaKind) =>
      routerNavigate({
        pathname: next === "video" ? "/video" : "/images",
        search: latest.current.search,
      }),
    [routerNavigate],
  );
  const showCompared = useCallback(
    (id: string) => routerNavigate(`/compare/${id}`),
    [routerNavigate],
  );
  const showItem = useCallback(
    (item: MediaItem) => {
      // Moving to another set's results flips through that set.
      if (run && runKey(item) !== run) setRun(runKey(item));
      setParams(
        (next) => {
          next.set("item", viewerItemId(item));
          return next;
        },
        { replace: true, state: location.state },
      );
    },
    [run, setParams, location.state],
  );
  const closeViewer = useCallback(() => {
    if (location.state?.viewer) {
      // Closing goes back to the entry the viewer opened from, unless the action that closed it
      // has already gone elsewhere (Similar, Use as Character, Recreate in Composer).
      const entry = window.history.state?.key;
      setTimeout(() => {
        if (window.history.state?.key === entry) void routerNavigate(-1);
      });
      return;
    }
    setParams(
      (next) => {
        next.delete("item");
        return next;
      },
      { replace: true, state: location.state },
    );
  }, [location.state, routerNavigate, setParams]);
  // Phones leave out the time, keeping a pinned caption to two lines.
  const detail = useCallback(
    (item: MediaItem) => mediaDetail(item, profiles, !phone),
    [profiles, phone],
  );
  // Phones without captions hold a tile for its menu instead of showing More.
  const hideMore = phone && !captions;
  const renderTileActions = useCallback(
    (item: MediaItem, opened: boolean, onOpenedChange: (opened: boolean) => void) => (
      <MediaTileActions
        item={item}
        opened={opened}
        onOpenedChange={onOpenedChange}
        onSelect={() => selection.toggle([item])}
        hideMore={hideMore}
      />
    ),
    [hideMore, selection],
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
  // New uploads show at once under the Uploads filter.
  const upload = useGalleryUpload(() => setFilters((current) => ({ ...current, uploads: true })));
  // The viewer nearing the last loaded item loads the next page, so navigation carries on.
  const shownIndex = shown && !run ? items.findIndex((item) => item.id === shown.id) : -1;
  const nearEnd = shownIndex >= 0 && items.length - shownIndex <= 3;
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = gallery;
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage();
  }, [nearEnd, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);
  // A ranking has no runs to group: it shows as a grid.
  const View = view === "runs" && !similar ? RunsView : MediaGrid;
  const selectionBar = selection.selecting && (
    <GallerySelectionBar
      selection={{ ...selection, end: doneSelecting }}
      tryAgain={tryAgain}
      menu={menu}
      onMenuClose={() => setMenu(null)}
    />
  );
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
          selection.selectMatching(() => true);
        }
      }}
      // Files or folders dropped on the gallery (not on the composer, which takes references) upload.
      onDragOver={(event) => {
        if (event.defaultPrevented || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (event.defaultPrevented || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        void droppedFiles(event.dataTransfer).then(upload.upload);
      }}
    >
      <VisuallyHidden component="h1">{kind === "video" ? "Videos" : "Images"}</VisuallyHidden>
      {/* The search and filters stay in place while selecting; the selection bar follows them. */}
      <div className={classes.toolbar}>
        <GalleryToolbar
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          value={filters}
          onChange={setFilters}
          count={gallery.data?.pages.at(-1)?.totalApprox}
          extraChips={[
            ...(similar
              ? [
                  {
                    key: "similar",
                    label: `${similarChipLabels[strictness]} ${similarSource ? mediaTitle(similarSource) : "Image"}`,
                    remove: removeSimilar,
                    choice: {
                      label: "Strictness",
                      value: strictness,
                      options: similarStrictnessOptions,
                      onChange: (value: string) => setStrictness(value as SimilarStrictness),
                    },
                  },
                ]
              : []),
            ...(setId
              ? [
                  {
                    key: "set",
                    label: `Set: ${loaded[0]?.resultSet?.title || "Results"}`,
                    remove: () =>
                      setParams(
                        (next) => {
                          next.delete("set");
                          return next;
                        },
                        { replace: true },
                      ),
                  },
                ]
              : []),
            ...(grouped
              ? [{ key: "versions", label: "Grouped Versions", remove: () => setAllVersions(true) }]
              : []),
          ]}
          view={
            <SegmentedControl
              aria-label="Gallery View"
              fullWidth
              size="xs"
              value={view}
              onChange={(value) => setView(value as "grid" | "runs")}
              data={[
                {
                  value: "grid",
                  label: <ViewLabel icon={<LayoutGrid size={14} />} text="Grid" />,
                },
                { value: "runs", label: <ViewLabel icon={<Rows3 size={14} />} text="Runs" /> },
              ]}
            />
          }
          toggles={
            <>
              {view === "grid" && (
                <Switch
                  label="All Versions"
                  labelPosition="left"
                  checked={allVersions}
                  onChange={(event) => setAllVersions(event.currentTarget.checked)}
                />
              )}
              {phone && (
                <Switch
                  label="Disliked"
                  labelPosition="left"
                  checked={filters.rating === "disliked"}
                  onChange={(event) =>
                    setFilters({
                      ...filters,
                      rating: event.currentTarget.checked ? "disliked" : "",
                      uploads: false,
                    })
                  }
                />
              )}
              {kind === "image" && (
                <Switch
                  label="Comparisons"
                  labelPosition="left"
                  checked={filters.comparisons}
                  onChange={(event) =>
                    setFilters({ ...filters, comparisons: event.currentTarget.checked })
                  }
                />
              )}
            </>
          }
          actions={
            <>
              <GalleryUpload upload={upload} />
              {/* Select stays in place, pressed while selecting; pressing it again ends selection. */}
              <Tooltip label="Select Items" disabled={!phone}>
                <Button
                  {...(phone ? iconChipProps : chipProps)}
                  ref={selectionButton}
                  aria-label="Select Items"
                  aria-pressed={selection.selecting}
                  leftSection={phone ? undefined : <SquareCheck size={15} />}
                  disabled={!items.length && !selection.selecting}
                  onClick={selection.selecting ? doneSelecting : selection.start}
                >
                  {phone ? <SquareCheck size={16} /> : "Select"}
                </Button>
              </Tooltip>
            </>
          }
        />
        {!phone && selectionBar}
      </div>
      {phone && selectionBar}
      {itemId &&
        !gallery.isPending &&
        !selected &&
        (link.isError ? (
          <Alert color="red" title="Couldn't Open Result" withCloseButton onClose={closeViewer}>
            {link.error.message}
          </Alert>
        ) : (
          <LoadingState label="Loading Result" />
        ))}
      {gallery.isPending ? (
        <LoadingState fill label="Loading Gallery" />
      ) : gallery.error && !gallery.data ? (
        <Alert color="red" title="Couldn't Load the Gallery">
          <Stack gap="sm" align="flex-start">
            {gallery.error.message}
            <Button variant="subtle" onClick={() => void gallery.refetch()}>
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : items.length ? (
        <div className={classes.results} data-stale={gallery.isPlaceholderData || undefined}>
          <View
            items={items}
            results={resultsKey}
            versions={versions}
            // A similarity ranking isn't in time order.
            byDay={!similar}
            focusItem={focusItem}
            open={openItem}
            selection={selection}
            caption={phone ? (captions ? "pinned" : "none") : "hover"}
            detail={detail}
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
          {similar
            ? "No Similar Images Yet"
            : search || hasFilters
              ? "No Matches"
              : kind === "video"
                ? "No Videos"
                : "No Images"}
        </EmptyState>
      )}
      {refresh.isError && (
        <Alert color="red" title="Couldn't Update the Gallery">
          <Stack gap="sm" align="flex-start">
            {refresh.error.message}
            <Button variant="subtle" loading={refresh.isFetching} onClick={refreshFirst}>
              Retry
            </Button>
          </Stack>
        </Alert>
      )}
      <MorePages listing={gallery} results={JSON.stringify(listingKey)} paused={!!itemId} />
      {!selection.selecting && (
        <ComposerDock
          compose={params.get("compose")}
          shared={params.get("shared") || ""}
          opening={(location.state as OpenComposerState | null)?.openComposer ? location.key : ""}
          onDropParam={dropParam}
          onKindChange={switchKind}
          onCompared={showCompared}
        />
      )}
      {selected && (
        <MediaViewer
          item={shown || selected}
          items={viewerItems}
          related={loaded}
          total={run || versions ? undefined : viewerOrder.current?.total}
          navigate={showItem}
          onReturnFocus={(item) => {
            const visible = new Set(loaded.map((candidate) => candidate.id));
            if (visible.has(item.id)) return setFocusItem(item.id);
            const index = viewerItems.findIndex(
              (candidate) => mediaIdentity(candidate) === mediaIdentity(item),
            );
            const neighbour =
              viewerItems.slice(index + 1).find((candidate) => visible.has(candidate.id)) ||
              viewerItems
                .slice(0, index)
                .reverse()
                .find((candidate) => visible.has(candidate.id));
            setFocusItem(neighbour?.id || null);
          }}
          close={closeViewer}
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
