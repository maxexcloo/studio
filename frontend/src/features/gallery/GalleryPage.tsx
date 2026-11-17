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
import { ArrowUp, LayoutGrid, Rows3, SquareCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Location, Navigate, useLocation, useNavigate, useParams } from "react-router";

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
import { GalleryImport, droppedFiles, useGalleryUpload } from "./GalleryImport";
import { GallerySelectionBar } from "./GallerySelectionBar";
import { GalleryToolbar } from "./GalleryToolbar";
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
import {
  type GalleryState,
  galleryKind,
  galleryPath,
  viewerItemId,
  viewerPath,
} from "./viewerLink";

import classes from "./GalleryPage.module.css";

type PageState = GalleryState & OpenComposerState & { compose?: boolean; viewer?: boolean };

/**
 * Links already shared (in chats too) carried the viewer's item and the gallery's state as query
 * parameters, and Videos once lived at /video; they move to the item's path and history state.
 * The installed app's share target still arrives as `?compose=1&shared=<id>`.
 */
function cleanLocation(location: Location) {
  const params = new URLSearchParams(location.search);
  const base = location.pathname === "/video" ? "/videos" : location.pathname;
  const item = params.get("item");
  const state: PageState = { ...location.state };
  for (const name of ["chat", "q", "set", "shared", "show", "similar", "turn"] as const) {
    const value = params.get(name);
    if (value) state[name] = value;
  }
  if (params.get("compose") === "1") state.compose = true;
  return {
    pathname: item
      ? `${galleryPath(galleryKind(base) || "image")}/${encodeURIComponent(item)}`
      : base,
    state,
  };
}

export function GalleryPage() {
  const location = useLocation();
  if (location.search || location.pathname === "/video") {
    const { pathname, state } = cleanLocation(location);
    return <Navigate to={pathname} state={state} replace />;
  }
  return <Gallery />;
}

function Gallery() {
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const location = useLocation();
  const routerNavigate = useNavigate();
  const kind = galleryKind(location.pathname) || "image";
  const base = galleryPath(kind);
  const state = location.state as PageState | null;
  const { changeKind, profiles } = useGenerationActions();
  useEffect(() => {
    changeKind(kind);
  }, [kind, changeKind]);
  const phone = usePhone();
  const [captions] = useTileCaptions();
  const [view, setView] = useRemembered<"grid" | "runs">("gallery-view", "grid");
  const [originalsOnly, setOriginalsOnly] = useRemembered("gallery-originals-only", false);
  const [filters, setFilters] = useRemembered("gallery-filters", emptyGalleryFilters);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  // The run (a job or result set, `runKey`) whose results the viewer flips through; unset, it
  // flips through the whole gallery.
  const [run, setRun] = useState<string>();
  // A caption tag in Details links here with `q`: it becomes the search and closes the viewer.
  const linkedQuery = state?.q;
  // The viewer's item (`/images/<id>`): opening one adds a history entry, so Back closes it, and
  // flipping through items replaces it.
  const itemId = useParams().id || "";
  // A set link shows that MCP result set alone until its chip is removed.
  const setId = state?.set || "";
  // An MCP result link shows that chat's turn, or the whole chat (`show` "chat"), until its chip
  // is removed.
  const chat = state?.chat || "";
  const chatTurn = state?.turn || "";
  const turn = state?.show === "chat" ? "" : chatTurn;
  // Similar shows the gallery ranked by likeness to that image, within the filters, until its
  // chip is removed.
  const similar = state?.similar || "";
  const [strictness, setStrictness] = useSimilarStrictness();
  // Stable, so the views' memoised tiles and the composer render only when their own state
  // changes: the location changes with every step through the viewer.
  const latest = useRef({ location, state });
  latest.current = { location, state };
  const dropState = useCallback(
    (name: keyof PageState, replace = true) => {
      // Drops in one commit (the share target's `openComposer` and `shared`) build on each other.
      latest.current.state = { ...latest.current.state, [name]: undefined };
      void routerNavigate(latest.current.location.pathname, {
        replace,
        state: latest.current.state,
      });
    },
    [routerNavigate],
  );
  const removeSimilar = useCallback(() => dropState("similar", false), [dropState]);
  useEffect(() => {
    if (similar) window.scrollTo(0, 0);
  }, [similar]);
  useEffect(() => {
    if (linkedQuery === undefined) return;
    setQuery(linkedQuery);
    dropState("q");
  }, [linkedQuery, dropState]);
  // `useOpenComposer`'s request to open the composer and focus its prompt is taken once, so a
  // reload doesn't repeat it; `compose` keeps the composer open through a reload until it closes.
  const [opening, setOpening] = useState("");
  const openRequest = state?.openComposer ? location.key : "";
  useEffect(() => {
    if (!openRequest) return;
    setOpening(openRequest);
    dropState("openComposer");
  }, [openRequest, dropState]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const client = useQueryClient();
  // Queue changes (new, finished or failed work) refresh the gallery at once; only active work
  // polls, for live previews; an idle gallery waits for the queue's own idle check.
  const jobs = useQuery({
    ...queueQuery,
    select: (data) => ({
      key: data.jobs.map((job) => `${job.id}:${job.status}`).join(),
      active: data.jobs.some((job) => !terminalStatuses.has(job.status)),
      retried: data.jobs
        .filter((job) => job.galleryAt)
        .map((job) => `${job.id}:${job.status}`)
        .join(),
    }),
  }).data;
  const listing = useMemo(
    () => ({ search, kind, filters, similar, strictness, setId, chat, turn }) as const,
    [search, kind, filters, similar, strictness, setId, chat, turn],
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
  const refreshKey = useMemo(
    () => [...galleryKey, "refresh", ...listingKey.slice(1)],
    [listingKey],
  );
  const [incoming, setIncoming] = useState(0);
  const refresh = useQuery({
    queryKey: refreshKey,
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
      // Scrolled into the gallery, new results wait behind New Results rather than pushing down
      // the tiles in view; back at the top they join.
      const fresh = first.items.findIndex((item) => known.has(mediaIdentity(item)));
      const top = document.querySelector("[data-gallery-view]")?.getBoundingClientRect().top;
      if (fresh > 0 && top !== undefined && top < 0) {
        first.items = first.items.slice(fresh);
        setIncoming(fresh);
      } else setIncoming(0);
      client.setQueryData<InfiniteData<GalleryResultsPage, string>>(listingKey, (data) => {
        if (!data) return data;
        const ids = new Set(first.items.map((item) => item.id));
        const replaced = new Set(
          first.items.flatMap((item) =>
            item.jobId && item.index !== undefined ? [`${item.jobId}-${item.index}`] : [],
          ),
        );
        // The fresh head holds every surviving tile of its jobs; the rest were dropped.
        const jobs = new Set(first.items.flatMap((item) => (item.jobId ? [item.jobId] : [])));
        const keep = (item: MediaItem) =>
          !ids.has(item.id) && !replaced.has(item.id) && !(item.jobId && jobs.has(item.jobId));
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
    if (
      client.isFetching({ queryKey: listingKey, exact: true }) ||
      client.isFetching({ queryKey: refreshKey, exact: true })
    ) {
      pendingFirst.current = listingKey;
      return;
    }
    pendingFirst.current = null;
    if (client.getQueryData(listingKey)) void readFirst({ cancelRefetch: false });
  }, [client, listingKey, readFirst, refreshKey]);
  useEffect(
    () => () => {
      pendingFirst.current = null;
    },
    [listingKey],
  );
  // A return or final completion during a read still needs a fresh head once that read settles.
  useEffect(() => {
    if (!gallery.isFetching && !refresh.isFetching && pendingFirst.current === listingKey)
      refreshFirst();
  }, [
    gallery.isFetching,
    gallery.dataUpdatedAt,
    gallery.errorUpdatedAt,
    listingKey,
    refresh.isFetching,
    refresh.dataUpdatedAt,
    refresh.errorUpdatedAt,
    refreshFirst,
  ]);
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
  // Held new results join once the gallery's top is back in view.
  useEffect(() => {
    if (!incoming) return;
    const join = () => {
      const top = document.querySelector("[data-gallery-view]")?.getBoundingClientRect().top;
      if (top === undefined || top >= 0) refreshFirst();
    };
    window.addEventListener("scroll", join, { passive: true });
    return () => window.removeEventListener("scroll", join);
  }, [incoming, refreshFirst]);
  useEffect(() => setIncoming(0), [listingKey]);
  // A retry keeps its original's place, which may lie past the first page: its progress rereads
  // every loaded page.
  const seenRetries = useRef(jobs?.retried);
  useEffect(() => {
    const seen = seenRetries.current;
    seenRetries.current = jobs?.retried;
    if (seen === undefined || seen === jobs?.retried) return;
    void client.invalidateQueries({ queryKey: listingKey, exact: true });
  }, [jobs?.retried, client, listingKey]);
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
  // The address names the shown item by its permanent number, in its own kind's gallery.
  const shownPath = shown && viewerPath(shown);
  useEffect(() => {
    if (!shownPath || shownPath === location.pathname) return;
    void routerNavigate(shownPath, { replace: true, state: location.state });
  }, [shownPath, location.pathname, location.state, routerNavigate]);
  // Every generation shows by default; Originals Only collapses each version chain into one Grid
  // tile showing its original. Runs always shows all.
  const queue = useQuery(queueQuery).data?.jobs;
  const groups = useMemo(() => versionGroups(loaded, queue || []), [loaded, queue]);
  const grouped = view === "grid" && originalsOnly;
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
    JSON.stringify([kind, search, filters, similar, strictness, setId, chat, turn]),
    {
      complete: !gallery.hasNextPage,
      load: loadEveryMatch,
    },
  );
  const hasFilters =
    JSON.stringify(filters) !== JSON.stringify(emptyGalleryFilters) || grouped || Boolean(similar);
  const clearFilters = () => {
    setFilters(emptyGalleryFilters);
    setOriginalsOnly(false);
    removeSimilar();
  };
  // The image ranks first, being most like itself, unless the filters leave it out.
  const similarSource = loaded.find((item) => item.id === similar);
  const tryAgain = useTryAgain(loaded);
  const openItem = useCallback(
    (item: MediaItem, run?: string) => {
      setFocusItem(null);
      setRun(run);
      const { set, similar } = latest.current.state || {};
      void routerNavigate(viewerPath(item), {
        state: { set, similar, viewer: true } satisfies PageState,
      });
    },
    [routerNavigate],
  );
  // The composer's output toggle switches the gallery; the route restores that output's draft.
  const switchKind = useCallback(
    (next: MediaKind) => {
      const { chat, set, show, similar, turn } = latest.current.state || {};
      void routerNavigate(galleryPath(next), {
        state: { chat, set, show, similar, turn } satisfies PageState,
      });
    },
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
      void routerNavigate(viewerPath(item), { replace: true, state: location.state });
    },
    [run, routerNavigate, location.state],
  );
  const closeViewer = useCallback(() => {
    if (state?.viewer) {
      // Closing goes back to the entry the viewer opened from, unless the action that closed it
      // has already gone elsewhere (Similar, Use as Character, Recreate in Composer).
      const entry = window.history.state?.key;
      setTimeout(() => {
        if (window.history.state?.key === entry) void routerNavigate(-1);
      });
      return;
    }
    void routerNavigate(base, { replace: true, state });
  }, [state, base, routerNavigate]);
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
                    remove: () => dropState("set"),
                  },
                ]
              : []),
            ...(chat
              ? [
                  {
                    key: "chat",
                    label: turn ? "This Turn" : "This Chat",
                    remove: () => {
                      dropState("show");
                      dropState("turn");
                      dropState("chat");
                    },
                    ...(chatTurn
                      ? {
                          choice: {
                            label: "Chat Results",
                            value: turn ? "turn" : "chat",
                            options: [
                              { value: "turn", label: "This Turn" },
                              { value: "chat", label: "This Chat" },
                            ],
                            onChange: (value: string) =>
                              void routerNavigate(location.pathname, {
                                replace: true,
                                state: {
                                  ...location.state,
                                  show: value === "chat" ? "chat" : undefined,
                                } satisfies PageState,
                              }),
                          },
                        }
                      : {}),
                  },
                ]
              : []),
            ...(grouped
              ? [
                  {
                    key: "versions",
                    label: "Originals Only",
                    remove: () => setOriginalsOnly(false),
                  },
                ]
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
              {view === "grid" && (
                <Switch
                  label="Originals Only"
                  labelPosition="left"
                  checked={originalsOnly}
                  onChange={(event) => setOriginalsOnly(event.currentTarget.checked)}
                />
              )}
            </>
          }
          actions={
            <>
              <GalleryImport upload={upload} />
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
          {incoming > 0 && (
            <div className={classes.incoming}>
              <Button
                variant="default"
                size="compact-sm"
                radius="xl"
                leftSection={<ArrowUp size={14} />}
                onClick={() => {
                  window.scrollTo({ top: 0 });
                  refreshFirst();
                }}
              >
                {incoming === 1 ? "1 New Result" : `${incoming} New Results`}
              </Button>
            </div>
          )}
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
          compose={!!state?.compose}
          shared={state?.shared || ""}
          opening={opening}
          onDropState={dropState}
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
