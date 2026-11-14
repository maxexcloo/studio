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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useEffect, useState } from "react";

import { post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { TasteProfile } from "../taste/TasteProfile";
import { DiscardedDreams } from "./DiscardedDreams";
import { DreamDeck } from "./DreamDeck";
import { DreamDigest } from "./DreamDigest";
import { DreamProjects } from "./DreamProjects";
import { DreamSettingsButton, useDreamSettings } from "./DreamSettings";
import { type Dream, dreamQuery, dreamWhen } from "./queries";

import classes from "./DreamPage.module.css";

/** What the deck shows once every card is judged, or before Dream is on. */
function Empty({ dream }: { dream: Dream }) {
  const save = useDreamSettings();
  if (!dream.settings.enabled)
    return (
      <EmptyState
        fill
        action={
          <Stack align="center" gap="sm">
            <Button loading={save.isPending} onClick={() => save.mutate({ enabled: true })}>
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
          <Button loading={save.isPending} onClick={() => save.mutate({ paused: false })}>
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

/** Above the deck while Dream is off, as the deck alone doesn't show it. */
function OffNotice() {
  const save = useDreamSettings();
  return (
    <Group justify="center" gap="xs" role="status" aria-label="Dream Status">
      <Text size="sm" c={save.error ? "red" : "dimmed"}>
        {save.error ? `Couldn't Turn On Dream: ${save.error.message}` : "Dream is off."}
      </Text>
      <Button
        size="compact-sm"
        variant="light"
        loading={save.isPending}
        onClick={() => save.mutate({ enabled: true })}
      >
        Turn On
      </Button>
    </Group>
  );
}

/**
 * Dream: the deck of unseen results, comparisons and calibration, with its pause and settings;
 * While You Were Away as the overview per project, the projects, the discards or the taste profile.
 * Opening it counts as a visit.
 */
export function DreamPage() {
  const phone = usePhone();
  const client = useQueryClient();
  const dream = useQuery(dreamQuery);
  useEffect(() => {
    void post("/api/dream/visit")
      .then(() => client.invalidateQueries({ queryKey: dreamQuery.queryKey, exact: true }))
      .catch(() => undefined);
  }, [client]);
  const save = useDreamSettings();
  // Dream always opens on the deck; Taste is its own control beside Settings.
  const [view, setView] = useState<"deck" | "overview" | "discarded" | "projects" | "taste">(
    "deck",
  );
  const taste = {
    variant: view === "taste" ? "light" : "subtle",
    color: view === "taste" ? undefined : "gray",
    "aria-pressed": view === "taste",
    onClick: () => setView(view === "taste" ? "deck" : "taste"),
  } as const;
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
            { value: "overview", label: "Overview" },
            { value: "projects", label: "Projects" },
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
          {data && <DreamSettingsButton dream={data} />}
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
        </Group>
      </Group>
      {data?.reason && (
        <Text size="sm" c="dimmed" ta="center" role="status" aria-label="Dream Status">
          {data.status === "unavailable" ? `Can't Run: ${data.reason}` : data.reason}
        </Text>
      )}
      {view === "discarded" ? (
        <DiscardedDreams />
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
          items={data!.unseen}
          calibrate={data!.settings.enabled}
          notice={!data!.settings.enabled && <OffNotice />}
          empty={<Empty dream={data!} />}
        />
      )}
    </div>
  );
}
