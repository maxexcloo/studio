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
} from "@mantine/core";
import { icons } from "../../ui/icons";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { TasteProfile } from "../taste/TasteProfile";
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
    off: "Off",
    paused: "Paused",
    generating: "Dreaming…",
    waiting: "Waiting for idle time",
    capped: "Today’s limit reached",
    unavailable: "Can’t run",
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

/** Dream: the deck with its status, pause and settings, the discards or the taste profile. */
export function DreamPage() {
  const phone = usePhone();
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  // Dream always opens on the deck; Taste is its own icon beside Settings.
  const [view, setView] = useState<"deck" | "discarded" | "taste">("deck");
  const [tuning, setTuning] = useRemembered("dream-tuning", false);
  const data = dream.data;
  const status = data && statusLine(data);
  return (
    <div className={classes.page}>
      {/* Phones give the status its own line under the views and actions. */}
      <Group className={classes.toolbar} gap="sm" wrap={phone ? "wrap" : "nowrap"}>
        <SegmentedControl
          radius="xl"
          aria-label="Dream View"
          value={view === "taste" ? "" : view}
          onChange={(value) => setView(value as typeof view)}
          data={[
            { value: "deck", label: "Deck" },
            { value: "discarded", label: "Discarded" },
          ]}
        />
        <div className={classes.status} role="status" aria-label="Dream Status">
          {status && (
            <Text size={phone ? "xs" : "sm"} truncate>
              {status.label}
              {status.detail && (
                <Text span c="dimmed" inherit>
                  {" · "}
                  {status.detail}
                </Text>
              )}
            </Text>
          )}
        </div>
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
          <Tooltip label="Taste">
            <ActionIcon
              variant={view === "taste" ? "light" : "subtle"}
              color={view === "taste" ? undefined : "gray"}
              aria-label="Taste"
              aria-pressed={view === "taste"}
              onClick={() => setView(view === "taste" ? "deck" : "taste")}
            >
              <Fingerprint size={18} />
            </ActionIcon>
          </Tooltip>
          {data && <DreamSettingsButton dream={data} />}
        </Group>
      </Group>
      {view === "discarded" ? (
        <DiscardedDreams />
      ) : view === "taste" ? (
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
