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

/** Dream: the deck with its pause and settings, the discards or the taste profile. */
export function DreamPage() {
  const phone = usePhone();
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  // Dream always opens on the deck; Taste is its own control beside Settings.
  const [view, setView] = useState<"deck" | "discarded" | "taste">("deck");
  const taste = {
    variant: view === "taste" ? "light" : "subtle",
    color: view === "taste" ? undefined : "gray",
    "aria-pressed": view === "taste",
    onClick: () => setView(view === "taste" ? "deck" : "taste"),
  } as const;
  const [tuning, setTuning] = useRemembered("dream-tuning", false);
  const data = dream.data;
  return (
    <div className={classes.page}>
      <Group className={classes.toolbar} gap="sm" wrap="nowrap">
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
          {/* Phones name Taste, as its fingerprint alone is ambiguous and they show no tooltips. */}
          {phone ? (
            <Button size="sm" leftSection={<Fingerprint size={18} />} {...taste}>
              Taste
            </Button>
          ) : (
            <Tooltip label="Taste">
              <ActionIcon aria-label="Taste" {...taste}>
                <Fingerprint size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {data && <DreamSettingsButton dream={data} />}
        </Group>
      </Group>
      {data?.status === "unavailable" && data.reason && (
        <Text size="sm" c="dimmed" ta="center" role="status" aria-label="Dream Status">
          Can’t Run: {data.reason}
        </Text>
      )}
      {view === "discarded" ? (
        <DiscardedDreams />
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
