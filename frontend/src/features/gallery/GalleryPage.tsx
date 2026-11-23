import { Alert, Button, Group, Stack, Tooltip, VisuallyHidden } from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import {
  type InfiniteData,
  focusManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Location,
  Navigate,
  type NavigateFunction,
  type NavigateOptions,
  type To,
  useLocation,
  useNavigate,
} from "react-router";

import type { GallerySort } from "../../../../shared/gallery-sort";
import { terminalStatuses } from "../../../../shared/queue";
import type { MediaItem, MediaKind, QueueJob } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { ViewMenu } from "../../ui/ViewMenu";
import { useRemembered } from "../auth/useRemembered";
import { comparisonMembersQuery } from "../compare/queries";
import { chipProps, iconChipProps } from "../generation/chip";
import { ComposerDock } from "../generation/ComposerDock";
import { useGenerationActions } from "../generation/GenerationProvider";
import type { OpenComposerState } from "../generation/openComposer";
import { queueQuery } from "../generation/Queue";
import { preferencesQuery } from "../settings/accountPreferences";
import { ChatSetPicker } from "./ChatSetPicker";
import { ShowToggles, emptyGalleryFilters } from "./GalleryFilters";
import { GalleryImport, droppedFiles, useGalleryUpload } from "./GalleryImport";
import { GallerySelectionBar } from "./GallerySelectionBar";
import { GalleryToolbar } from "./GalleryToolbar";
import { MediaGrid } from "./MediaGrid";
import { mediaDay, mediaDetail, mediaTitle } from "./mediaLabels";
import { currentMedia, mediaIdentity, reconcileViewerItems } from "./mediaSource";
import { MediaTileActions } from "./MediaTileActions";
import { MediaViewer } from "./MediaViewer";
import { MorePages } from "./MorePages";
import {
  type GalleryDate,
  type GalleryPageParam,
  type GalleryResultsPage,
  galleryArrivalsQuery,
  galleryKey,
  galleryListingKey,
  galleryPage,
  galleryQuery,
  galleryTimelineQuery,
  galleryViewCountsQuery,
  viewerItemQuery,
} from "./queries";
import { useSavedViews } from "./SavedViews";
import {
  type SimilarStrictness,
  similarChipLabels,
  similarStrictnessOptions,
  useSimilarStrictness,
} from "./similarStrictness";
import { useGalleryDeparture } from "./useGalleryDeparture";
import { useGallerySelection } from "./useGallerySelection";
import { usePendingRating, useRate } from "./useMediaRating";
import { useTryAgain } from "./useTryAgain";
import {
  type GalleryState,
  galleryKind,
  galleryPath,
  galleryRouteView,
  galleryViewPath,
  viewerItemId,
  viewerPath,
  viewerPathId,
} from "./viewerLink";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import classes from "./GalleryPage.module.css";

type PageState = GalleryState &
  OpenComposerState & {
    compose?: boolean;
    /** Arrived from another mode: the gallery opens on its home view, not Uploads. */
    home?: boolean;
    reviewQuery?: string;
    viewer?: boolean;
    viewFrom?: string;
  };
/** A built-in view, or a saved one (`saved:` and its ID). */
type GalleryView = "gallery" | "uploads" | "comparisons" | "review" | `saved:${string}`;
const loadReview = () => import("./GalleryReview");
const loadComparisons = () => import("../compare/ComparisonList");
const GalleryReview = lazy(() =>
  loadReview().then(({ GalleryReview }) => ({ default: GalleryReview })),
);
const ComparisonList = lazy(() =>
  loadComparisons().then(({ ComparisonList }) => ({ default: ComparisonList })),
);
// Review and Comparisons load once the page is idle, so opening them doesn't wait for their code.
(window.requestIdleCallback || setTimeout)(() => {
  void loadReview();
  void loadComparisons();
});

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
  const location = useLocation();
  const state = location.state as PageState | null;
  // Review and Comparisons have their own address and leave the gallery's listing idle.
  const routeView = galleryRouteView(location.pathname);
  const review = routeView === "review";
  const initialQuery = review ? (state?.reviewQuery ?? "") : "";
  const [query, setQueryText] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const searchAfterTyping = useDebouncedCallback(setSearch, 120);
  const setQuery = useCallback(
    (value: string) => {
      setQueryText(value);
      if (value) searchAfterTyping(value);
      else {
        searchAfterTyping.cancel();
        setSearch("");
      }
    },
    [searchAfterTyping],
  );
  // useNavigate changes with the path, so with every viewer step; every target here is absolute.
  const navigate = useNavigate();
  const latestNavigate = useRef(navigate);
  latestNavigate.current = navigate;
  const routerNavigate = useCallback<NavigateFunction>(
    (to: To | number, options?: NavigateOptions) =>
      typeof to === "number" ? latestNavigate.current(to) : latestNavigate.current(to, options),
    [],
  );
  const kind = galleryKind(location.pathname) || "image";
  const { leftAt, acknowledged, acknowledge } = useGalleryDeparture(kind);
  const base = galleryPath(kind);
  const { changeKind, profiles } = useGenerationActions();
  useEffect(() => {
    changeKind(kind);
  }, [kind, changeKind]);
  const phone = usePhone();
  const preferences = useQuery(preferencesQuery).data?.preferences;
  const captions = preferences?.tileCaptions ?? false;
  const [filters, setFilters] = useRemembered("gallery-filters", emptyGalleryFilters);
  const [sort, setSort] = useRemembered<GallerySort>("gallery-sort", "newest");
  const home = state?.home;
  useEffect(() => {
    if (home) setFilters((current) => (current.uploads ? { ...current, uploads: false } : current));
  }, [home, location.key, setFilters]);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  // A caption tag in Details links here with `q`: it becomes the search and closes the viewer.
  const linkedQuery = state?.q;
  // The viewer's item (`/images/<id>`): opening one adds a history entry, so Back closes it, and
  // flipping through items replaces it.
  const itemId = viewerPathId(location.pathname);
  // A set link shows that MCP result set alone until its chip is removed.
  const setId = state?.set || "";
  // An MCP result link shows that chat's turn, or the whole chat (`show` "chat"), until its chip
  // is removed.
  const chat = state?.chat || "";
  const chatTurn = state?.turn || "";
  const turn = state?.show === "chat" ? "" : chatTurn;
  const showWork =
    !filters.uploads && Boolean(chat || setId || (preferences?.galleryWork ?? "none") !== "none");
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
  }, [linkedQuery, dropState, setQuery]);
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
  const selectGalleryJobs = useCallback(
    (data: { jobs: QueueJob[] }) => {
      const foreground = data.jobs.filter(
        (job) => !job.dream && (job.input?.kind ?? job.input?.type ?? "image") === kind,
      );
      return {
        key: foreground.map((job) => `${job.id}:${job.status}`).join(),
        active: foreground.some((job) => !terminalStatuses.has(job.status)),
        retried: foreground
          .filter((job) => job.galleryAt)
          .map((job) => `${job.id}:${job.status}`)
          .join(),
      };
    },
    [kind],
  );
  const jobs = useQuery({
    ...queueQuery,
    select: selectGalleryJobs,
  }).data;
  const listing = useMemo(
    () => ({ search, kind, filters, similar, strictness, setId, chat, turn, sort }) as const,
    [search, kind, filters, similar, strictness, setId, chat, turn, sort],
  );
  const scope = useMemo(() => JSON.stringify(galleryListingKey(listing)), [listing]);
  const byDay = !similar && sort !== "liked" && sort !== "disliked";
  const [jump, setJump] = useState<{ scope: string; date: GalleryDate }>();
  if (jump && jump.scope !== scope) setJump(undefined);
  const jumpDate = jump?.scope === scope && byDay ? jump.date : undefined;
  const date = jumpDate?.cursor ? jumpDate : undefined;
  const jumpToDate = useCallback(
    (date: GalleryDate) => {
      setFocusItem(null);
      setJump({ scope, date });
    },
    [scope],
  );
  const listingQuery = useMemo(() => galleryQuery(listing, date?.cursor), [listing, date?.cursor]);
  const listingKey = listingQuery.queryKey;
  const gallery = useInfiniteQuery({
    ...listingQuery,
    enabled: !routeView,
    // Search and filter changes keep the current results until the new ones arrive; switching
    // between Images and Videos never shows the other mode's results.
    placeholderData: (previous, query) => (query?.queryKey[2] === kind ? previous : undefined),
    // A refetch rereads every loaded page in turn. Returning to the tab or the listing, and queue
    // changes, read only the first page (below).
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  // The tiles only need one page. Let it arrive before requesting summaries of the listing.
  const listingReady =
    !routeView && gallery.isSuccess && !gallery.isPlaceholderData && query === search;
  const arrivals =
    useQuery({
      ...galleryArrivalsQuery(listing, leftAt),
      enabled: listingReady && !!leftAt && !acknowledged && !itemId && !similar,
    }).data && !acknowledged;
  const timeline = useQuery({ ...galleryTimelineQuery(listing), enabled: listingReady && byDay });
  const historical = Boolean(
    date && (gallery.isPlaceholderData || gallery.data?.pages[0]?.previousCursor !== ""),
  );
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
      const held =
        client.getQueryData<InfiniteData<GalleryResultsPage, GalleryPageParam>>(listingKey);
      const known = new Set(held?.pages.flatMap((page) => page.items.map(mediaIdentity)));
      const first = await galleryPage(listing, "", signal);
      // If more than a page arrived while away, bridge to the held results sequentially so no
      // matches disappear between the fresh first page and the old continuation cursor.
      let edge = first;
      while (
        known.size &&
        edge.hasMore &&
        !edge.items.some((item) => known.has(mediaIdentity(item)))
      ) {
        edge = await galleryPage(listing, edge.nextCursor, signal);
        first.items.push(...edge.items);
      }
      if (signal.aborted) return first;
      const cancelled = new Set(
        client
          .getQueryData(queueQuery.queryKey)
          ?.jobs.flatMap((job) => (job.status === "cancelled" ? [job.id] : [])),
      );
      const wasCancelled = (item: MediaItem) =>
        item.status === "pending" && !!item.jobId && cancelled.has(item.jobId);
      if (cancelled.size) first.items = first.items.filter((item) => !wasCancelled(item));
      // The gallery holds new arrivals while scrolled down. An open viewer can navigate to them.
      const fresh = first.items.findIndex((item) => known.has(mediaIdentity(item)));
      const top = document.querySelector("[data-gallery-view]")?.getBoundingClientRect().top;
      const viewing = viewerPathId(latest.current.location.pathname);
      if (!viewing && fresh > 0 && top !== undefined && top < 0) {
        first.items = first.items.slice(fresh);
        setIncoming(fresh);
      } else setIncoming(0);
      client.setQueryData<InfiniteData<GalleryResultsPage, GalleryPageParam>>(
        listingKey,
        (data) => {
          if (!data) return data;
          const slots = new Set(first.items.map(mediaIdentity));
          const completed = new Set(
            first.items.flatMap((item) =>
              item.status === "done" && item.jobId ? [item.jobId] : [],
            ),
          );
          const keep = (item: MediaItem) =>
            !slots.has(mediaIdentity(item)) &&
            !wasCancelled(item) &&
            !(item.status === "pending" && item.jobId && completed.has(item.jobId));
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
        },
      );
      return first;
    },
  });
  const { refetch: readFirst } = refresh;
  const pendingFirst = useRef<typeof listingKey | null>(null);
  const refreshFirst = useCallback(() => {
    // A date jump can skip thousands of items. Never bridge from the newest page to that window.
    if (historical || routeView) return;
    if (
      client.isFetching({ queryKey: listingKey, exact: true }) ||
      client.isFetching({ queryKey: refreshKey, exact: true })
    ) {
      pendingFirst.current = listingKey;
      return;
    }
    pendingFirst.current = null;
    if (client.getQueryData(listingKey)) {
      if (sort === "newest") void readFirst({ cancelRefetch: false });
      else void client.invalidateQueries({ queryKey: listingKey, exact: true });
    }
  }, [client, historical, listingKey, readFirst, refreshKey, routeView, sort]);
  useEffect(
    () => () => {
      pendingFirst.current = null;
    },
    [listingKey],
  );
  // Cached results show at once, then their first page is read again; a first load reads it once.
  useEffect(() => {
    if (client.getQueryData(listingKey)) refreshFirst();
  }, [listingKey]);
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
  // Pending tiles need polling for live previews only while the listing can show them. Other
  // sorts would reread every loaded page, so their tiles change only as the queue does.
  useEffect(() => {
    if (routeView || !showWork || !jobs?.active || sort !== "newest") return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshFirst();
    }, 3000);
    return () => clearInterval(timer);
  }, [routeView, showWork, jobs?.active, refreshFirst, sort]);
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
  // Held new results join when the viewer opens or the gallery's top comes back into view.
  useEffect(() => {
    if (!incoming) return;
    if (itemId) {
      refreshFirst();
      return;
    }
    const join = () => {
      const top = document.querySelector("[data-gallery-view]")?.getBoundingClientRect().top;
      if (top === undefined || top >= 0) refreshFirst();
    };
    window.addEventListener("scroll", join, { passive: true });
    return () => window.removeEventListener("scroll", join);
  }, [incoming, itemId, refreshFirst]);
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
  // A day may disappear after the index was read. Return to the listing if its seek has no items.
  const { refetch: refreshTimeline } = timeline;
  useEffect(() => {
    if (!date || gallery.isPlaceholderData || !gallery.isSuccess || loaded.length) return;
    setJump(undefined);
    void refreshTimeline();
  }, [date, gallery.isPlaceholderData, gallery.isSuccess, loaded.length, refreshTimeline]);
  // A tab left open can begin receiving results on a new local date without ever refocusing.
  const head = gallery.data?.pages[0]?.items.find((item) => item.status === "done");
  const headDay = head && mediaDay(head);
  const observedDay = useRef("");
  useEffect(() => {
    if (!headDay || !byDay || historical || sort !== "newest" || gallery.isPlaceholderData) return;
    const key = JSON.stringify([scope, headDay]);
    const days = timeline.data?.days;
    if (!days || observedDay.current === key) return;
    observedDay.current = key;
    if (!days.some(({ day }) => day === headDay)) void refreshTimeline();
  }, [
    byDay,
    gallery.isPlaceholderData,
    headDay,
    historical,
    refreshTimeline,
    scope,
    sort,
    timeline.data,
  ]);
  // A linked item not on a loaded page is read on its own; one that leaves the gallery while
  // shown stays until the viewer moves on.
  const listed = itemId
    ? loaded.find((candidate) => viewerItemId(candidate) === itemId || candidate.id === itemId)
    : undefined;
  const lastShown = useRef<MediaItem | null>(null);
  const retained =
    itemId &&
    lastShown.current &&
    (viewerItemId(lastShown.current) === itemId || lastShown.current.id === itemId)
      ? lastShown.current
      : null;
  const pendingRating = usePendingRating(listed?.id ?? retained?.id);
  // A dislike may remove the listing immediately. Until the write settles, keep the open item
  // with its new rating rather than reading it back from the server before the write lands.
  const link = useQuery({
    ...viewerItemQuery(itemId),
    enabled: Boolean(itemId && !listed && !gallery.isPending && pendingRating === undefined),
  });
  const selected = listed || (pendingRating === undefined ? link.data?.item : retained) || retained;
  const current = selected && currentMedia(loaded, selected);
  const shown =
    current && pendingRating !== undefined && pendingRating !== (current.rating ?? null)
      ? { ...current, rating: pendingRating ?? undefined }
      : current;
  lastShown.current = shown;
  // The address names the shown item by its permanent number, in its own kind's gallery.
  const shownPath = shown && viewerPath(shown);
  useEffect(() => {
    if (!shownPath || shownPath === location.pathname) return;
    void routerNavigate(shownPath, { replace: true, state: location.state });
  }, [shownPath, location.pathname, location.state, routerNavigate]);
  const viewerOrder = useRef<{
    scope: string;
    items: MediaItem[];
    retained: Map<string, MediaItem>;
    total?: number;
  } | null>(null);
  const listingScope = useMemo(() => JSON.stringify(listingKey), [listingKey]);
  const total = gallery.data?.pages.at(-1)?.totalApprox;
  // Reconciled only when the listing or the shown item changes, not on every gallery render.
  const order = useMemo(() => {
    if (!itemId) return (viewerOrder.current = null);
    const previous = viewerOrder.current;
    const retained = new Map(previous?.scope === listingScope ? previous.retained : []);
    // Dislike hides the current tile, but it remains a neighbour until this viewer closes.
    if (shown) retained.set(mediaIdentity(shown), shown);
    for (const candidate of loaded) retained.delete(mediaIdentity(candidate));
    const next =
      previous?.scope === listingScope
        ? reconcileViewerItems(previous.items, loaded, [...retained.values()])
        : loaded;
    const reset =
      previous?.scope !== listingScope ||
      !previous.items.length ||
      (shown && !next.some((item) => mediaIdentity(item) === mediaIdentity(shown)));
    return (viewerOrder.current = {
      scope: listingScope,
      items: reset ? loaded : next,
      retained,
      total: total ?? (reset ? undefined : previous.total),
    });
  }, [itemId, listingScope, loaded, shown, total]);
  const viewerItems = order?.items || loaded;
  // The query the shown results answer: placeholder results still answer the previous one.
  const [resultsKey, setResultsKey] = useState(listingScope);
  if (!gallery.isPlaceholderData && resultsKey !== listingScope) setResultsKey(listingScope);
  const selection = useGallerySelection(loaded, scope, {
    complete: !gallery.hasNextPage && !gallery.hasPreviousPage,
    ready: Boolean(gallery.data) && !gallery.isPlaceholderData && query === search,
    load: async (match, signal) =>
      (await galleryPage(listing, "", signal, { selection: match })).items,
  });
  const hasFilters =
    JSON.stringify(filters) !== JSON.stringify(emptyGalleryFilters) || Boolean(similar);
  // Liked or Uploads alone already has its own control in the toolbar.
  const toggledOnly =
    !search &&
    !similar &&
    (filters.uploads || filters.rating === "liked") &&
    JSON.stringify({ ...filters, uploads: false, rating: "" }) ===
      JSON.stringify(emptyGalleryFilters);
  const clearFilters = () => {
    setFilters(emptyGalleryFilters);
    removeSimilar();
  };
  // The image ranks first, being most like itself, unless the filters leave it out.
  const similarSource = loaded.find((item) => item.id === similar);
  const tryAgain = useTryAgain(loaded);
  const openItem = useCallback(
    (item: MediaItem) => {
      setFocusItem(null);
      const { chat, set, show, similar, turn } = latest.current.state || {};
      void routerNavigate(viewerPath(item), {
        state: { chat, set, show, similar, turn, viewer: true } satisfies PageState,
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
      void routerNavigate(viewerPath(item), {
        replace: true,
        state,
      });
    },
    [routerNavigate, state],
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
  const detail = useCallback((item: MediaItem) => mediaDetail(item, profiles), [profiles]);
  // Phones without captions hold a tile for its menu instead of showing More.
  const hideMore = phone && !captions;
  const { toggle } = selection;
  const rate = useRate();
  const renderTileActions = useCallback(
    (item: MediaItem, opened: boolean, onOpenedChange: (opened: boolean) => void) => (
      <MediaTileActions
        item={item}
        opened={opened}
        onOpenedChange={onOpenedChange}
        onSelect={() => toggle([item])}
        rate={rate}
        hideMore={hideMore}
      />
    ),
    [hideMore, toggle, rate],
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
  const shownIndex = shown ? loaded.findIndex((item) => item.id === shown.id) : -1;
  const nearEnd = shownIndex >= 0 && loaded.length - shownIndex <= 3;
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = gallery;
  const nearStart = Boolean(date) && shownIndex >= 0 && shownIndex < 3;
  const { hasPreviousPage, isFetchPreviousPageError, fetchPreviousPage } = gallery;
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage();
  }, [nearEnd, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);
  useEffect(() => {
    if (nearStart && hasPreviousPage && !isFetching && !isFetchPreviousPageError)
      void fetchPreviousPage();
  }, [nearStart, hasPreviousPage, isFetching, isFetchPreviousPageError, fetchPreviousPage]);
  const selectionBar = selection.selecting && (
    <GallerySelectionBar
      selection={{ ...selection, end: doneSelecting }}
      tryAgain={tryAgain}
      menu={menu}
      onMenuClose={() => setMenu(null)}
    />
  );
  const page = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const [countsWanted, setCountsWanted] = useState(false);
  const viewScroll = useRef<{ key: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const host = page.current;
    const controls = toolbar.current;
    if (!host || !controls) return;
    const measure = () =>
      host.style.setProperty("--gallery-toolbar-height", `${controls.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls, { box: "border-box" });
    return () => observer.disconnect();
  }, [routeView]);
  useLayoutEffect(() => {
    if (routeView) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const previous = viewScroll.current;
    if (previous?.key !== location.key) return;
    viewScroll.current = null;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: previous.top, behavior: "instant" });
      viewButton.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.key, routeView]);
  const leaveView = () => {
    const entry = window.history.state?.key;
    // An action that stages work in the composer can navigate while leaving Review.
    setTimeout(() => {
      if (window.history.state?.key !== entry) return;
      if (state?.viewFrom) void routerNavigate(-1);
      else void routerNavigate(base, { replace: true });
    });
  };
  const saved = useSavedViews(kind, { search: query, filters, sort }, countsWanted);
  function showView(next: GalleryView) {
    if (next === routeView) return;
    const view = saved.view(next);
    if (view) {
      // A saved view restores its search, filters and sort as the gallery shows them.
      searchAfterTyping.cancel();
      setQueryText(view.search);
      setSearch(view.search);
      setFilters({ ...emptyGalleryFilters, ...view.filters });
      setSort(view.sort);
      if (similar) removeSimilar();
      if (routeView) leaveView();
      return;
    }
    if (next === "review" || next === "comparisons") {
      // Switching between Review and Comparisons keeps the gallery entry that Back returns to.
      if (!routeView) viewScroll.current = { key: location.key, top: window.scrollY };
      void routerNavigate(galleryViewPath(kind, next), {
        replace: Boolean(routeView),
        state: routeView
          ? state
          : ({
              chat,
              set: setId,
              show: state?.show,
              similar,
              turn: chatTurn,
              reviewQuery: query,
              viewFrom: location.key,
            } satisfies PageState),
      });
      return;
    }
    const uploads = next === "uploads";
    // Leaving a saved view leaves its search, filters and sort too.
    if (saved.current) {
      setQuery("");
      setFilters({ ...emptyGalleryFilters, uploads });
      setSort("newest");
    } else if (uploads !== filters.uploads) setFilters({ ...filters, uploads, rating: "" });
    if (routeView) leaveView();
  }
  const counts = useQuery({ ...galleryViewCountsQuery(kind), enabled: countsWanted }).data;
  const comparisons = useQuery({ ...comparisonMembersQuery, enabled: countsWanted }).data
    ?.comparisons.length;
  const view = (
    <ViewMenu<GalleryView>
      label="Gallery View"
      ref={viewButton}
      onOpen={() => setCountsWanted(true)}
      value={
        routeView ??
        (saved.current ? `saved:${saved.current}` : filters.uploads ? "uploads" : "gallery")
      }
      groups={[
        [
          { value: "gallery", label: "Gallery", count: counts?.gallery },
          { value: "uploads", label: "Uploads", count: counts?.uploads },
        ],
        [
          { value: "comparisons", label: "Comparisons", count: comparisons },
          {
            value: "review",
            label: "Review",
            disabled: selection.selecting,
            count: counts?.review,
          },
        ],
        ...(saved.choices.length ? [saved.choices] : []),
      ]}
      actions={routeView ? [] : saved.actions}
      onChange={showView}
    />
  );
  // While a view's code loads, its toolbar and loading state already sit where the view puts them.
  const loadingView = (label: string) => (
    <Stack gap="sm" className={classes.page}>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap">
          {view}
        </Group>
      </div>
      <LoadingState fill label={label} />
    </Stack>
  );
  if (review) {
    return (
      <Suspense fallback={loadingView("Loading Review")}>
        <GalleryReview
          key={kind}
          listing={{ ...listing, search: query, filters: { ...listing.filters, uploads: false } }}
          leftAt={leftAt}
          close={leaveView}
          view={view}
        />
      </Suspense>
    );
  }
  if (routeView === "comparisons") {
    return (
      <Suspense fallback={loadingView("Loading Comparisons")}>
        <ComparisonList view={view} />
      </Suspense>
    );
  }
  return (
    <Stack
      ref={page}
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
          void selection.selectMatching("all");
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
      <VisuallyHidden component="h1">
        {filters.uploads ? "Uploads" : kind === "video" ? "Videos" : "Images"}
      </VisuallyHidden>
      {/* The search and filters stay in place while selecting; the selection bar follows them.
          Phones keep them in sight only while a search, filter or selection applies. */}
      <div
        ref={toolbar}
        className={classes.toolbar}
        data-pinned={
          selection.selecting || Boolean(query || setId || chat) || hasFilters || undefined
        }
      >
        <GalleryToolbar
          view={view}
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          value={filters}
          onChange={setFilters}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            if (similar) removeSimilar();
            window.scrollTo({ top: 0 });
          }}
          count={gallery.data?.pages.at(-1)?.totalApprox}
          chipTools={
            chat && (
              <ChatSetPicker
                kind={kind}
                chat={chat}
                turn={turn}
                setId={setId}
                onChange={(id) => {
                  if ((id || "") === setId) return;
                  void routerNavigate(base, {
                    replace: true,
                    state: { ...latest.current.state, set: id } satisfies PageState,
                  });
                  window.scrollTo({ top: 0 });
                }}
              />
            )
          }
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
                    label: `Set: ${loaded[0]?.resultSet?.id === setId ? loaded[0].resultSet.title || "Results" : "Results"}`,
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
                                  set: undefined,
                                  show: value === "chat" ? "chat" : undefined,
                                } satisfies PageState,
                              }),
                          },
                        }
                      : {}),
                  },
                ]
              : []),
          ]}
          toggles={<ShowToggles kind={kind} value={filters} onChange={setFilters} />}
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
                  leftSection={phone ? undefined : <icons.select size={15} />}
                  disabled={!loaded.length && !selection.selecting}
                  onClick={selection.selecting ? doneSelecting : selection.start}
                >
                  {phone ? <icons.select size={16} /> : "Select"}
                </Button>
              </Tooltip>
            </>
          }
        />
        {selectionBar}
      </div>
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
      ) : loaded.length ? (
        <div className={classes.results} data-stale={gallery.isPlaceholderData || undefined}>
          {(arrivals || (!historical && incoming > 0)) && (
            <div className={classes.incoming}>
              <Button
                variant="default"
                size="compact-sm"
                radius="xl"
                leftSection={<ArrowUp size={14} />}
                onClick={() => {
                  if (arrivals) {
                    acknowledge();
                    setJump(undefined);
                    setSort("newest");
                  }
                  window.scrollTo({ top: 0 });
                  if (sort === "newest" && !historical) refreshFirst();
                }}
              >
                {arrivals ? "Jump to New Results" : "New Results"}
              </Button>
            </div>
          )}
          {date && (
            <MorePages
              direction="previous"
              listing={gallery}
              results={resultsKey}
              paused={!!itemId || !!review || gallery.isPlaceholderData}
            />
          )}
          <MediaGrid
            items={loaded}
            results={resultsKey}
            byDay={byDay}
            timeline={timeline.data?.days}
            onDate={jumpToDate}
            jumpDay={jumpDate?.day}
            seekPending={gallery.isPlaceholderData}
            leadingPage={gallery.data?.pages[0]?.previousCursor}
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
            hasFilters &&
            !toggledOnly && (
              <Button variant="default" onClick={clearFilters}>
                Clear Filters
              </Button>
            )
          }
        >
          {similar
            ? "No Similar Images Yet"
            : toggledOnly
              ? filters.uploads
                ? "No Uploads"
                : `No Liked ${kind === "video" ? "Videos" : "Images"}`
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
      <MorePages listing={gallery} results={listingScope} paused={!!itemId || !!review} />
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
      {saved.dialogs}
      {selected && (
        <MediaViewer
          quiet
          item={shown || selected}
          items={viewerItems}
          related={loaded}
          total={order?.total}
          navigate={showItem}
          follow={openItem}
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
