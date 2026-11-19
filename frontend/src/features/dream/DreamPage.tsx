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
import { Check, ChevronDown, Image as ImageIcon, Video } from "lucide-react";
import { Fragment, useEffect, useId, useState } from "react";
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
import { DreamDeck } from "./DreamDeck";
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

/** The deck once every card is judged, or while Dream is off with no pair to compare. */
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

const views = ["deck", "projects", "taste", "discarded", "history"] as const;

function useLibraryReview(seed: string, media: DreamMedia, decided: Set<string>) {
  const query = useInfiniteQuery(libraryReviewQuery(seed, media));
  const items =
    query.data?.pages.flatMap((page) => page.items).filter((item) => !decided.has(item.id)) ?? [];
  const lastPage = query.data?.pages.at(-1);
  const remaining = (lastPage ? lastPage.remaining - lastPage.items.length : 0) + items.length;
  return { query, items, remaining };
}

/**
 * Dream shows unseen results, comparisons and calibration in the deck, with counts of images
 * and videos awaiting a verdict. Projects shows what is new in each project. Opening Dream counts
 * as a visit.
 */
export function DreamPage() {
  const phone = usePhone();
  const [media, setMedia] = useRemembered<DreamMedia>("dream-media", "image");
  const [seed] = useState(() => crypto.randomUUID());
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [returned, setReturned] = useState<DreamItem[]>([]);
  const imageReview = useLibraryReview(seed, "image", decided);
  const videoReview = useLibraryReview(seed, "video", decided);
  const reviews = { image: imageReview, video: videoReview };
  const { query: library, items: libraryItems } = reviews[media];
  const [undoTarget, setUndoTarget] = useState<HTMLDivElement | null>(null);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  useEffect(() => {
    void post("/api/dream/visit")
      .then(() => client.invalidateQueries({ queryKey: dreamQuery.queryKey, exact: true }))
      .catch(() => undefined);
  }, [client]);
  const save = useDreamSettings();
  // Dream opens on the deck at /dream; each other view has its own path, so reload and Back keep
  // it. A project's detail view (/dream/projects/:projectId) opens over Projects.
  const params = useParams();
  const param = params.projectId ? "projects" : params.view;
  const view = views.find((name) => name === param) ?? "deck";
  const navigate = useNavigate();
  const setView = (next: (typeof views)[number]) =>
    navigate(next === "deck" ? "/dream" : `/dream/${next}`);
  const mediaLabels = { image: "Images", video: "Videos" };
  const viewLabels = {
    deck: mediaLabels[media],
    projects: "Projects",
    taste: "Taste",
    discarded: "Discards",
    history: "History",
  };
  const data = dream.data;
  const deckUnseen = data?.settings.enabled
    ? [
        ...data.unseen,
        ...returned.filter((item) => !data.unseen.some((listed) => listed.id === item.id)),
      ].filter((item) => !decided.has(item.id))
    : [];
  const count = data && dreamCardCounts(deckUnseen, data.settings);
  const unseen = { image: count?.images, video: count?.videos };
  const reviewing =
    view === "deck" &&
    !unseen[media] &&
    (Boolean(library.data?.pages.some((page) => page.items.length)) ||
      library.isPending ||
      library.isError);
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
  // Unseen cards of each kind, so new work on the other kind is never hidden.
  const counted = (kind: DreamMedia) =>
    unseen[kind] ? `${mediaLabels[kind]} (${unseen[kind]})` : mediaLabels[kind];
  const waitingId = useId();
  const plural = (number: number, noun: string) => `${number} ${noun}${number === 1 ? "" : "s"}`;
  const waiting = count && {
    images: plural(count.images, "image"),
    videos: plural(count.videos, "video"),
  };
  // The deck takes its media from the view menu; the other views that list media switch here.
  const selector = ["discarded", "history"].includes(view) && (
    <SegmentedControl
      aria-label="Dream Media"
      value={media}
      onChange={(value) => setMedia(value as DreamMedia)}
      data={[
        { value: "image", label: counted("image") },
        { value: "video", label: counted("video") },
      ]}
    />
  );
  const item = (label: string, checked: boolean, open: () => void, description?: string) => (
    <Menu.Item
      key={label}
      aria-label={label}
      aria-description={description}
      rightSection={checked ? <Check size={14} /> : undefined}
      onClick={open}
    >
      {label}
      {description && (
        <Text component="span" size="xs" c="dimmed" display="block">
          {description}
        </Text>
      )}
    </Menu.Item>
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
                {viewLabels[view]}
                {/* Always in sight, so new work on either kind shows from every view. */}
                {count && waiting && (
                  <Group component="span" gap={4} wrap="nowrap" c="dimmed" ml={8} aria-hidden>
                    {phone ? (
                      <>
                        <ImageIcon size={14} />
                        {count.images} ·
                        <Video size={14} />
                        {count.videos}
                      </>
                    ) : (
                      `· ${waiting.images} · ${waiting.videos}`
                    )}
                  </Group>
                )}
              </Button>
            </Menu.Target>
          </PopupTooltip>
          {waiting && (
            <VisuallyHidden id={waitingId}>
              {`${waiting.images} and ${waiting.videos} waiting`}
            </VisuallyHidden>
          )}
          <Menu.Dropdown>
            {(["image", "video"] as const).map((kind) => {
              const { remaining } = reviews[kind];
              return item(
                counted(kind),
                view === "deck" && media === kind,
                () => {
                  setMedia(kind);
                  setView("deck");
                },
                remaining ? `Rate Your Library (${remaining})` : undefined,
              );
            })}
            {views.slice(1).map((value) => (
              <Fragment key={value}>
                {value === "discarded" && <Menu.Divider />}
                {item(viewLabels[value], view === value, () => setView(value))}
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
      ) : dream.isPending ? (
        <LoadingState fill label="Loading Dream" />
      ) : dream.isError ? (
        <Alert color="red" title="Couldn't Load Dream">
          {dream.error.message}
        </Alert>
      ) : (
        <DreamDeck
          key={media}
          media={media}
          items={deckUnseen}
          decided={decided}
          setDecided={setDecided}
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
          pairsOnly={!data!.settings.enabled}
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
