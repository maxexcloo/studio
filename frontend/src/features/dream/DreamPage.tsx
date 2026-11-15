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
import { Check, ChevronDown, Fingerprint } from "lucide-react";
import { useEffect } from "react";
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

const views = ["deck", "overview", "projects", "discarded", "taste"] as const;

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
  // Dream opens on the deck at /dream; each other view has its own path, so reload and Back keep
  // it. Taste is its own control beside Settings.
  const param = useParams().view;
  const view = views.find((name) => name === param) ?? "deck";
  const navigate = useNavigate();
  const setView = (next: (typeof views)[number]) =>
    navigate(next === "deck" ? "/dream" : `/dream/${next}`);
  const taste = {
    variant: view === "taste" ? "light" : "subtle",
    color: view === "taste" ? undefined : "gray",
    "aria-pressed": view === "taste",
    onClick: () => setView(view === "taste" ? "deck" : "taste"),
  } as const;
  const viewLabels = {
    deck: "Deck",
    overview: "Overview",
    projects: "Projects",
    discarded: "Discarded",
  };
  const data = dream.data;
  return (
    <div className={classes.page}>
      {/* Phones keep the views in a menu, so they and the actions share one row. */}
      <Group className={classes.toolbar} gap="sm" wrap="nowrap">
        {phone ? (
          <Menu position="bottom-start">
            <PopupTooltip label="Dream View">
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  aria-label="Dream View"
                  rightSection={<ChevronDown size={14} />}
                >
                  {view === "taste" ? "Taste" : viewLabels[view]}
                </Button>
              </Menu.Target>
            </PopupTooltip>
            <Menu.Dropdown>
              {(Object.keys(viewLabels) as (keyof typeof viewLabels)[]).map((value) => (
                <Menu.Item
                  key={value}
                  rightSection={view === value ? <Check size={14} /> : undefined}
                  onClick={() => setView(value)}
                >
                  {viewLabels[value]}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <SegmentedControl
            radius="xl"
            aria-label="Dream View"
            value={view === "taste" ? "" : view}
            onChange={(value) => setView(value as typeof view)}
            data={Object.entries(viewLabels).map(([value, label]) => ({ value, label }))}
          />
        )}
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
          items={data!.settings.enabled ? data!.unseen : []}
          pairsOnly={!data!.settings.enabled}
          empty={<Empty dream={data!} />}
        />
      )}
    </div>
  );
}
