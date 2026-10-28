import {
  ActionIcon,
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Pause, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { useRemembered } from "../auth/useRemembered";
import { DiscardedDreams } from "./DiscardedDreams";
import { DreamDeck } from "./DreamDeck";
import { DreamSettingsButton, useDreamSettings } from "./DreamSettings";
import { dreamQuery, type Dream } from "./queries";
import classes from "./DreamPage.module.css";

/** A short line on what Dream is doing now, and the backend's reason where it gave one. */
function statusLine(dream: Dream) {
  const made = `${dream.today.images} ${dream.today.images === 1 ? "image" : "images"}${
    dream.settings.videos
      ? `, ${dream.today.videos} ${dream.today.videos === 1 ? "video" : "videos"}`
      : ""
  } today`;
  const label = {
    off: "Dream is off",
    paused: "Paused",
    generating: "Dreaming…",
    waiting: "Waiting for idle time",
    capped: "Today’s limit reached",
    unavailable: "Dream can’t run",
  }[dream.status];
  return {
    label,
    detail: [dream.reason, dream.settings.enabled ? made : ""].filter(Boolean).join(" · "),
  };
}

/**
 * What the deck shows once every card is judged, or before Dream is on. `onTune` starts
 * calibration with gallery images, which needs no GPU and so works while Dream is off.
 */
function Empty({ dream, onTune }: { dream: Dream; onTune?: () => void }) {
  const save = useDreamSettings();
  if (!dream.settings.enabled)
    return (
      <EmptyState
        fill
        action={
          <Stack align="center" gap="sm">
            <Group gap="sm">
              <Button loading={save.isPending} onClick={() => save.mutate({ enabled: true })}>
                Turn On
              </Button>
              {onTune && (
                <Button variant="default" onClick={onTune}>
                  Tune Your Taste
                </Button>
              )}
            </Group>
            {save.error && (
              <Alert color="red" title="Couldn’t Turn On Dream">
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
          <Button loading={save.isPending} onClick={() => save.mutate({ paused: false })}>
            Resume
          </Button>
        }
      >
        Dream Is Paused
      </EmptyState>
    );
  return <EmptyState fill>Nothing New Yet</EmptyState>;
}

/** Dream: the deck of unseen results with its status, pause and settings, or the discards. */
export function DreamPage() {
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  const [view, setView] = useRemembered<"deck" | "discarded">("dream-view", "deck");
  const [tuning, setTuning] = useRemembered("dream-tuning", false);
  const data = dream.data;
  const status = data && statusLine(data);
  return (
    <div className={classes.page}>
      <Group className={classes.toolbar} gap="sm" wrap="nowrap">
        <SegmentedControl
          size="xs"
          radius="xl"
          aria-label="Dream View"
          value={view}
          onChange={(value) => setView(value as typeof view)}
          data={[
            { value: "deck", label: "Deck" },
            { value: "discarded", label: "Discarded" },
          ]}
        />
        <div className={classes.status} role="status" aria-label="Dream Status">
          {status && (
            <Text size="sm" truncate>
              {status.label}
              {status.detail && (
                <Text span c="dimmed" size="sm">
                  {" · "}
                  {status.detail}
                </Text>
              )}
            </Text>
          )}
        </div>
        {data?.settings.enabled && (
          <Tooltip label={data.settings.paused ? "Resume Dream" : "Pause Dream"}>
            <ActionIcon
              variant="default"
              aria-label={data.settings.paused ? "Resume Dream" : "Pause Dream"}
              loading={save.isPending}
              onClick={() => save.mutate({ paused: !data.settings.paused })}
            >
              {data.settings.paused ? <Play size={18} /> : <Pause size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {data && <DreamSettingsButton dream={data} />}
      </Group>
      {view === "discarded" ? (
        <DiscardedDreams />
      ) : dream.isPending ? (
        <LoadingState fill label="Loading Dream" />
      ) : dream.isError ? (
        <Alert color="red" title="Couldn’t Load Dream">
          {dream.error.message}
        </Alert>
      ) : (
        <DreamDeck
          items={data!.unseen}
          calibrate={tuning || data!.settings.enabled}
          empty={(calibration) => (
            <Empty dream={data!} onTune={calibration ? () => setTuning(true) : undefined} />
          )}
        />
      )}
    </div>
  );
}
