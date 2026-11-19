import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, type SetStateAction, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { dreamCardCounts } from "../../../../shared/dream";
import { post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { TasteProfile } from "../taste/TasteProfile";
import { TasteReflection } from "../taste/TasteReflection";
import { DiscardedDreams } from "./DiscardedDreams";
import { DreamDeck, type Judgement } from "./DreamDeck";
import { DreamHistory } from "./DreamHistory";
import { DreamProjects } from "./DreamProjects";
import { lockedByAdministrator, useDreamSettings } from "./DreamSettings";
import {
  type Dream,
  type DreamItem,
  type DreamMedia,
  dreamQuery,
  dreamWhen,
  libraryReviewQuery,
} from "./queries";

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
  return (
    <EmptyState fill action={<Text size="xs">{dreamWhen(dream)}</Text>}>
      Nothing New Yet
    </EmptyState>
  );
}

const views = [
  ["dream", "Dream"],
  ["library", "Library"],
  ["projects", "Projects"],
  ["taste", "Taste"],
  ["history", "History"],
  ["discarded", "Discards"],
] as const;
const mediaLabels = { image: "Images", video: "Videos" };

function useLibraryReview(seed: string, media: DreamMedia, decided: Set<string>, enabled: boolean) {
  const query = useInfiniteQuery({ ...libraryReviewQuery(seed, media), enabled });
  const items =
    query.data?.pages.flatMap((page) => page.items).filter((item) => !decided.has(item.id)) ?? [];
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
  const [undoTarget, setUndoTarget] = useState<HTMLDivElement | null>(null);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  const params = useParams();
  const param = params.projectId ? "projects" : params.view;
  const [view, label] = views.find(([name]) => name === param) ?? views[0];
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
  const pending = {
    image: reviewing ? imageReview.remaining : view === "dream" ? count?.images : undefined,
    video: reviewing ? videoReview.remaining : view === "dream" ? count?.videos : undefined,
  };

  useEffect(() => {
    if (
      reviewing &&
      libraryItems.length < 3 &&
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
  const plural = (number: number, noun: string) => `${number} ${noun}${number === 1 ? "" : "s"}`;
  const waiting =
    count && `${plural(count.images, "image")} and ${plural(count.videos, "video")} waiting`;
  const selector = view !== "projects" && view !== "taste" && (
    <SegmentedControl
      aria-label="Dream Media"
      value={media}
      onChange={(value) => setMedia(value as DreamMedia)}
      data={(["image", "video"] as const).map((kind) => ({
        value: kind,
        label: pending[kind] ? `${mediaLabels[kind]} (${pending[kind]})` : mediaLabels[kind],
      }))}
    />
  );
  return (
    <div className={classes.page}>
      <Group className={classes.toolbar} gap="sm" wrap="nowrap">
        <Menu position="bottom-start">
          <PopupTooltip label="Dream View">
            <Menu.Target>
              <Button
                size="compact-md"
                variant="subtle"
                color="gray"
                aria-label="Dream View"
                aria-describedby={waiting ? waitingId : undefined}
                rightSection={<ChevronDown size={14} />}
              >
                {label}
              </Button>
            </Menu.Target>
          </PopupTooltip>
          {waiting && <VisuallyHidden id={waitingId}>{waiting}</VisuallyHidden>}
          <Menu.Dropdown>
            {views.map(([name, title]) => (
              <Fragment key={name}>
                {name === "history" && <Menu.Divider />}
                <Menu.Item
                  rightSection={view === name ? <Check size={14} /> : undefined}
                  onClick={() => navigate(name === "dream" ? "/dream" : `/dream/${name}`)}
                >
                  {title}
                </Menu.Item>
              </Fragment>
            ))}
          </Menu.Dropdown>
        </Menu>
        {!phone && selector}
        <div ref={setUndoTarget} style={{ display: "contents" }} />
        <Group gap={4} wrap="nowrap" ml="auto">
          <div ref={setActionTarget} style={{ display: "contents" }} />
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
        </Group>
      </Group>
      {phone && selector}
      {view === "discarded" ? (
        <DiscardedDreams key={media} media={media} />
      ) : view === "history" ? (
        <DreamHistory media={media} />
      ) : view === "projects" ? (
        <DreamProjects actionTarget={actionTarget} />
      ) : view === "taste" ? (
        phone ? (
          <ScrollArea flex={1} mih={0} w="100%">
            <Stack gap="lg">
              <TasteProfile />
              <TasteReflection />
            </Stack>
          </ScrollArea>
        ) : (
          <ScrollArea
            flex={1}
            mih={0}
            w="100%"
            maw={760}
            mx="auto"
            classNames={{ viewport: classes.taste }}
          >
            <Stack gap="lg">
              <TasteProfile />
              <TasteReflection />
            </Stack>
          </ScrollArea>
        )
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
          undoTarget={undoTarget}
          empty={
            reviewing ? (
              library.isError ? (
                <Alert color="red" title="Couldn't Load the Library">
                  <Button
                    variant="subtle"
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
