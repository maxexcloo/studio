import {
  ActionIcon,
  Alert,
  Button,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SetStateAction, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { dreamCardCounts } from "../../../../shared/dream";
import { post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { usePhone } from "../../ui/usePhone";
import { ViewMenu } from "../../ui/ViewMenu";
import { useRemembered } from "../auth/useRemembered";
import { reviewSuggestionCount } from "../gallery/usePrefetchResultSuggestions";
import { DiscardedDreams } from "./DiscardedDreams";
import { DreamAllocation } from "./DreamAllocation";
import { DreamDeck, type Judgement } from "./DreamDeck";
import { DreamHistory } from "./DreamHistory";
import { DreamProjects } from "./DreamProjects";
import { lockedByAdministrator, useDreamSettings } from "./DreamSettings";
import { DreamWeek } from "./DreamWeek";
import {
  type Dream,
  type DreamItem,
  type DreamMedia,
  discardedQuery,
  dreamQuery,
  dreamQuota,
  historyQuery,
  libraryReviewQuery,
} from "./queries";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import classes from "./DreamPage.module.css";

/** The Dream deck once every card is judged or while Dream is off. */
function Empty({ dream }: { dream: Dream }) {
  const save = useDreamSettings();
  if (!dream.settings.enabled)
    return (
      <EmptyState
        fill
        action={
          dream.locked.includes("enabled") ? (
            <Text size="xs">{lockedByAdministrator}</Text>
          ) : (
            <Stack align="center" gap="sm">
              <Button
                leftSection={<icons.resume size={16} />}
                loading={save.isPending}
                onClick={() => save.mutate({ enabled: true })}
              >
                Turn On
              </Button>
              {save.error && (
                <Alert color="red" title="Couldn't Turn On Dream">
                  {save.error.message}
                </Alert>
              )}
            </Stack>
          )
        }
      >
        Dream Is Off
      </EmptyState>
    );
  if (dream.status === "paused")
    return (
      <EmptyState
        fill
        action={
          <Button
            leftSection={<icons.resume size={16} />}
            loading={save.isPending}
            onClick={() => save.mutate({ paused: false })}
          >
            Resume
          </Button>
        }
      >
        Dream Is Paused
      </EmptyState>
    );
  const quota = dreamQuota(dream);
  return (
    <EmptyState
      fill
      action={
        <Stack gap={4} fz="xs">
          <span>{dream.reason || "Dream works when the queue is free."}</span>
          {quota && <span>{quota}</span>}
        </Stack>
      }
    >
      Nothing New Yet
    </EmptyState>
  );
}

const views = [
  [
    { value: "dream", label: "Dream" },
    { value: "library", label: "Library" },
    { value: "projects", label: "Projects" },
    { value: "week", label: "This Week" },
  ],
  [
    { value: "discarded", label: "Discards" },
    { value: "history", label: "History" },
  ],
] as const;
const mediaLabels = { image: "Images", video: "Videos" };

function useLibraryReview(seed: string, media: DreamMedia, decided: Set<string>, enabled: boolean) {
  const query = useInfiniteQuery({ ...libraryReviewQuery(seed, media), enabled });
  const items = useMemo(
    () =>
      query.data?.pages.flatMap((page) => page.items.filter(({ id }) => !decided.has(id))) ?? [],
    [decided, query.data],
  );
  const lastPage = query.data?.pages.at(-1);
  const remaining = (lastPage ? lastPage.remaining - lastPage.items.length : 0) + items.length;
  return { query, items, remaining };
}

/** Dream's unseen results and comparisons, Library review, and their related views. */
export function DreamPage() {
  const phone = usePhone();
  const [media, setMedia] = useRemembered<DreamMedia>("dream-media", "image");
  const [seed] = useState(() => crypto.randomUUID());
  const [dreamDecided, setDreamDecided] = useState<Set<string>>(() => new Set());
  const [libraryDecided, setLibraryDecided] = useState<Set<string>>(() => new Set());
  const [returned, setReturned] = useState<DreamItem[]>([]);
  const [histories, setHistories] = useState<Partial<Record<string, Judgement[]>>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  const params = useParams();
  const param = params.projectId ? "projects" : params.view;
  const { value: view, label: viewLabel } =
    views.flat().find(({ value }) => value === param) ?? views[0][0];
  if (view !== "projects" && creatingProject) setCreatingProject(false);
  const navigate = useNavigate();
  const reviewing = view === "library";
  const imageReview = useLibraryReview(seed, "image", libraryDecided, reviewing);
  const videoReview = useLibraryReview(seed, "video", libraryDecided, reviewing);
  const reviews = { image: imageReview, video: videoReview };
  const { query: library, items: libraryItems } = reviews[media];
  const visited = useRef(false);
  useEffect(() => {
    if (reviewing || visited.current) return;
    visited.current = true;
    void post("/api/dream/visit")
      .then(() => client.invalidateQueries({ queryKey: dreamQuery.queryKey, exact: true }))
      .catch(() => undefined);
  }, [client, reviewing]);
  const data = dream.data;
  const deckUnseen = data?.settings.enabled
    ? [
        ...data.unseen,
        ...returned.filter((item) => !data.unseen.some((listed) => listed.id === item.id)),
      ].filter((item) => !dreamDecided.has(item.id))
    : [];
  const count = data && dreamCardCounts(deckUnseen, data.settings);
  // The media selector counts what each media holds in this view: waiting cards, History's
  // entries or Discards.
  const activity = {
    image: useQuery({ ...historyQuery("image"), enabled: view === "history" }).data,
    video: useQuery({ ...historyQuery("video"), enabled: view === "history" }).data,
  };
  const discards = {
    image: useInfiniteQuery({ ...discardedQuery("image"), enabled: view === "discarded" }).data,
    video: useInfiniteQuery({ ...discardedQuery("video"), enabled: view === "discarded" }).data,
  };
  const counted = (kind: DreamMedia) =>
    view === "history"
      ? activity[kind]?.items.length
      : view === "discarded"
        ? discards[kind]?.pages[0]?.total
        : reviewing
          ? reviews[kind].remaining
          : count?.[kind === "image" ? "images" : "videos"];

  useEffect(() => {
    if (
      reviewing &&
      libraryItems.length <= reviewSuggestionCount &&
      library.hasNextPage &&
      !library.isFetchingNextPage &&
      !library.isFetchNextPageError
    )
      void library.fetchNextPage();
  }, [
    reviewing,
    libraryItems.length,
    library.hasNextPage,
    library.isFetchingNextPage,
    library.isFetchNextPageError,
    library.fetchNextPage,
  ]);
  const deckKey = `${view}:${media}`;
  const history = histories[deckKey] ?? [];
  const setHistory = (update: SetStateAction<Judgement[]>) =>
    setHistories((previous) => ({
      ...previous,
      [deckKey]: typeof update === "function" ? update(previous[deckKey] ?? []) : update,
    }));
  const waitingId = useId();
  const waiting =
    count && `${plural(count.images, "image")} and ${plural(count.videos, "video")} waiting`;
  const selector = view !== "projects" && view !== "week" && (
    <SegmentedControl
      aria-label="Dream Media"
      size={phone ? "xs" : undefined}
      value={media}
      onChange={(value) => setMedia(value as DreamMedia)}
      data={(["image", "video"] as const).map((kind) => ({
        value: kind,
        label: (
          <span className={classes.count} data-label={`${mediaLabels[kind]} (00)`}>
            <span>
              {counted(kind) === undefined
                ? mediaLabels[kind]
                : `${mediaLabels[kind]} (${counted(kind)})`}
            </span>
          </span>
        ),
      }))}
    />
  );
  return (
    <div className={classes.page}>
      <VisuallyHidden component="h1">{viewLabel}</VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group
          role="group"
          aria-label="Dream Toolbar"
          gap="xs"
          mih={44}
          wrap={phone ? "wrap" : "nowrap"}
        >
          <ViewMenu
            label="Dream View"
            value={view}
            groups={views}
            describedBy={waiting ? waitingId : undefined}
            onChange={(name) => navigate(name === "dream" ? "/dream" : `/dream/${name}`)}
          />
          {waiting && <VisuallyHidden id={waitingId}>{waiting}</VisuallyHidden>}
          {selector}
          <Group gap={4} wrap="nowrap" ml="auto">
            {view === "projects" && (
              <Button
                size="compact-sm"
                variant="default"
                leftSection={<icons.add size={14} />}
                onClick={() => setCreatingProject(true)}
              >
                New Project
              </Button>
            )}
            {data?.settings.enabled && (
              <Tooltip label={data.settings.paused ? "Resume Dream" : "Pause Dream"}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={data.settings.paused ? "Resume Dream" : "Pause Dream"}
                  loading={save.isPending}
                  onClick={() => save.mutate({ paused: !data.settings.paused })}
                >
                  {data.settings.paused ? <icons.resume size={18} /> : <icons.pause size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            {data && <DreamAllocation dream={data} />}
          </Group>
        </Group>
      </div>
      {view === "discarded" ? (
        <DiscardedDreams key={media} media={media} />
      ) : view === "history" ? (
        <DreamHistory media={media} />
      ) : view === "week" ? (
        <ScrollArea flex={1} mih={0} classNames={{ viewport: classes.workspace }}>
          <DreamWeek />
        </ScrollArea>
      ) : view === "projects" ? (
        <ScrollArea flex={1} mih={0} classNames={{ viewport: classes.workspace }}>
          <Stack flex={1} gap="lg" pb="md">
            <DreamProjects
              creating={creatingProject}
              onCloseCreate={() => setCreatingProject(false)}
            />
          </Stack>
        </ScrollArea>
      ) : !reviewing && dream.isPending ? (
        <LoadingState fill label="Loading Dream" />
      ) : !reviewing && dream.isError ? (
        <Alert color="red" title="Couldn't Load Dream">
          {dream.error.message}
        </Alert>
      ) : (
        <DreamDeck
          key={deckKey}
          media={media}
          items={deckUnseen}
          setDecided={reviewing ? setLibraryDecided : setDreamDecided}
          history={history}
          setHistory={setHistory}
          returnItems={(items) =>
            setReturned((previous) => [
              ...previous.filter((item) => !items.some((restored) => restored.id === item.id)),
              ...items,
            ])
          }
          libraryItems={reviewing ? libraryItems : undefined}
          libraryWaiting={
            reviewing &&
            (library.isPending ||
              library.isFetchingNextPage ||
              (library.hasNextPage && !library.isFetchNextPageError))
          }
          empty={
            reviewing ? (
              library.isError ? (
                <Alert color="red" title="Couldn't Load the Library">
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={() =>
                      void (library.hasNextPage ? library.fetchNextPage() : library.refetch())
                    }
                  >
                    Retry
                  </Button>
                </Alert>
              ) : (
                <EmptyState fill>Library Review Complete</EmptyState>
              )
            ) : (
              <Empty dream={data!} />
            )
          }
        />
      )}
    </div>
  );
}
