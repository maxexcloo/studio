import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  ScrollArea,
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
import { TasteProfile } from "../taste/TasteProfile";
import { DiscardedDreams } from "./DiscardedDreams";
import { DreamDeck } from "./DreamDeck";
import { DreamDigest } from "./DreamDigest";
import { DreamHistory } from "./DreamHistory";
import { DreamProjects } from "./DreamProjects";
import { DreamSettingsButton, useDreamSettings } from "./DreamSettings";
import { type Dream, dreamQuery, dreamWhen } from "./queries";

import classes from "./DreamPage.module.css";

/** The deck once every card is judged, or while Dream is off with no pair to compare. */
function Empty({ dream }: { dream: Dream }) {
  const save = useDreamSettings();
  if (!dream.settings.enabled)
    return (
      <EmptyState
        fill
        action={
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
  const [undoTarget, setUndoTarget] = useState<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  useEffect(() => {
    void post("/api/dream/visit")
      .then(() => client.invalidateQueries({ queryKey: dreamQuery.queryKey, exact: true }))
      .catch(() => undefined);
  }, [client]);
  const save = useDreamSettings();
  // Dream opens on the deck at /dream; each other view has its own path, so reload and Back keep
  // it.
  const param = useParams().view;
  const view = views.find((name) => name === param) ?? "deck";
  const navigate = useNavigate();
  const setView = (next: (typeof views)[number]) =>
    navigate(next === "deck" ? "/dream" : `/dream/${next}`);
  const viewLabels = {
    deck: "Deck",
    overview: "Overview",
    projects: "Projects",
    taste: "Taste",
    discarded: "Discards",
    history: "History",
  };
  const data = dream.data;
  return (
    <div className={classes.page}>
      <Group className={classes.toolbar} gap="sm" wrap="nowrap">
        <Menu position="bottom-start">
          <PopupTooltip label="Dream View">
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                aria-label="Dream View"
                leftSection={<icons.dream size={16} />}
                rightSection={<ChevronDown size={14} />}
              >
                {viewLabels[view]}
              </Button>
            </Menu.Target>
          </PopupTooltip>
          <Menu.Dropdown>
            {views.map((value) => (
              <Fragment key={value}>
                {value === "discarded" && <Menu.Divider />}
                <Menu.Item
                  rightSection={view === value ? <Check size={14} /> : undefined}
                  onClick={() => setView(value)}
                >
                  {viewLabels[value]}
                </Menu.Item>
              </Fragment>
            ))}
          </Menu.Dropdown>
        </Menu>
        <div ref={setUndoTarget} style={{ display: "contents" }} />
        <Group gap={4} wrap="nowrap" ml="auto">
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
      {data?.reason && (
        <Text size="sm" c="dimmed" ta="center" role="status" aria-label="Dream Status">
          {data.status === "unavailable" ? `Can't Run: ${data.reason}` : data.reason}
        </Text>
      )}
      {view === "discarded" ? (
        <DiscardedDreams />
      ) : view === "history" ? (
        <DreamHistory />
      ) : view === "projects" ? (
        <DreamProjects />
      ) : view === "taste" ? (
        phone ? (
          <TasteProfile fill />
        ) : (
          <ScrollArea
            flex={1}
            mih={0}
            w="100%"
            maw={760}
            mx="auto"
            classNames={{ viewport: classes.taste }}
          >
            <TasteProfile />
          </ScrollArea>
        )
      ) : dream.isPending ? (
        <LoadingState fill label="Loading Dream" />
      ) : dream.isError ? (
        <Alert color="red" title="Couldn't Load Dream">
          {dream.error.message}
        </Alert>
      ) : view === "overview" ? (
        data!.digest.length ? (
          <DreamDigest groups={data!.digest} since={data!.since} />
        ) : (
          <Empty dream={data!} />
        )
      ) : (
        <DreamDeck
          items={data!.settings.enabled ? data!.unseen : []}
          pairsOnly={!data!.settings.enabled}
          undoTarget={undoTarget}
          empty={<Empty dream={data!} />}
        />
      )}
    </div>
  );
}
