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
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

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
import { DreamDigest } from "./DreamDigest";
import { DreamHistory } from "./DreamHistory";
import { DreamProjects } from "./DreamProjects";
import { DreamSettingsButton, lockedByAdministrator, useDreamSettings } from "./DreamSettings";
import { type Dream, type DreamMedia, dreamCountQuery, dreamQuery, dreamWhen } from "./queries";

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

const views = ["deck", "overview", "projects", "taste", "discarded", "history"] as const;

/**
 * Dream: the deck of unseen results, comparisons and calibration, with its pause and settings;
 * While You Were Away as the overview per project, the projects, the discards or the taste profile.
 * Opening it counts as a visit.
 */
export function DreamPage() {
  const phone = usePhone();
  const [media, setMedia] = useRemembered<DreamMedia>("dream-media", "image");
  const [undoTarget, setUndoTarget] = useState<HTMLDivElement | null>(null);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  const count = useQuery(dreamCountQuery);
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
    overview: "Overview",
    projects: "Projects",
    taste: "Taste",
    discarded: "Discards",
    history: "History",
  };
  const data = dream.data;
  const groups = (data?.digest ?? [])
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.type === media),
      misses: group.misses.filter((item) => item.type === media),
    }))
    .filter((group) => group.items.length || group.misses.length);
  // Unseen cards of each kind, so new work on the other kind is never hidden.
  const unseen = { image: count.data?.images, video: count.data?.videos };
  const counted = (kind: DreamMedia) =>
    unseen[kind] ? `${mediaLabels[kind]} (${unseen[kind]})` : mediaLabels[kind];
  // The deck takes its media from the view menu; the other views that list media switch here.
  const selector = ["overview", "discarded", "history"].includes(view) && (
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
  const item = (label: string, checked: boolean, open: () => void) => (
    <Menu.Item key={label} rightSection={checked ? <Check size={14} /> : undefined} onClick={open}>
      {label}
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
                rightSection={<ChevronDown size={14} />}
              >
                {viewLabels[view]}
              </Button>
            </Menu.Target>
          </PopupTooltip>
          <Menu.Dropdown>
            {(["image", "video"] as const).map((kind) =>
              item(counted(kind), view === "deck" && media === kind, () => {
                setMedia(kind);
                setView("deck");
              }),
            )}
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
          {data && <DreamSettingsButton dream={data} />}
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
      ) : view === "overview" ? (
        groups.length ? (
          <DreamDigest key={media} groups={groups} since={data!.since} />
        ) : (
          <Empty dream={data!} />
        )
      ) : (
        <DreamDeck
          key={media}
          media={media}
          items={data!.settings.enabled ? data!.unseen.filter((item) => item.type === media) : []}
          pairsOnly={!data!.settings.enabled}
          undoTarget={undoTarget}
          empty={<Empty dream={data!} />}
        />
      )}
    </div>
  );
}
