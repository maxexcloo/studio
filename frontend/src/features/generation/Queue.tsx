import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Image as Thumbnail,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { arrayMove } from "@dnd-kit/helpers";
import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from "react";
import {
  ChevronDown,
  CircleAlert,
  GripVertical,
  Image,
  Video,
  type LucideIcon,
} from "lucide-react";
import { icons } from "../../ui/icons";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import classes from "./Queue.module.css";
import { api, post } from "../../api";
import type { Profile, QueueJob, ReferenceAsset } from "../../types";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { useTryAgain } from "../gallery/useTryAgain";
import { useJobSwap } from "../runtime/JobSwap";
import { useGenerationActions } from "./GenerationProvider";
import { loraInfoQuery, loraTitle } from "./LoraPicker";
import { isProfile, profileName, shownProfileName } from "./payload";
import { referenceLabel } from "./references";
import { WritingStream } from "./PromptWriting";
import type { QueueRowDrag } from "./SortableQueue";
import {
  pausedReason,
  terminalStatuses,
  type QueueCancelAllResponse,
  type QueuePause,
} from "../../../../shared/queue";
export const queueQuery = queryOptions({
  queryKey: ["queue"],
  queryFn: () => api<{ jobs: QueueJob[]; paused: QueuePause }>("/api/queue"),
  // Every in-app submit (composer, viewer) invalidates this query; an idle queue still
  // checks now and then, so work started elsewhere (an MCP client, another tab) shows, and the
  // gallery with it, without the window regaining focus.
  refetchInterval: (query) =>
    query.state.data?.jobs.some((job) => !terminalStatuses.has(job.status)) ? 1500 : 15_000,
});
/** One of the account's jobs, however old: the queue lists only its latest finished ones. */
export const queueJobQuery = (id: string) =>
  queryOptions({
    queryKey: ["queue", id],
    queryFn: () => api<{ job: QueueJob }>(`/api/queue/${encodeURIComponent(id)}`),
  });
export function useQueue() {
  return useQuery(queueQuery);
}
const queueActionKey = ["queue-action"];
/**
 * An empty `id` acts on the whole queue (`cancel-all`, `clear-failed`, `pause` and the like), or
 * with `set` on that set's waiting work (`move`).
 */
type QueueAction = {
  id: string;
  set?: string;
  action:
    | "cancel"
    | "clear"
    | "retry"
    | "move"
    | "cancel-all"
    | "clear-failed"
    | "pause"
    | "resume"
    | "pause-all"
    | "resume-all";
  /** The place (from 0) `move` takes the item to among the account's waiting items. */
  to?: number;
};
export function useQueueAction(jobId?: string) {
  const client = useQueryClient();
  const pending = useIsMutating({
    mutationKey: queueActionKey,
    predicate: (mutation) =>
      jobId !== undefined && (mutation.state.variables as QueueAction)?.id === jobId,
  });
  const action = useMutation({
    mutationKey: queueActionKey,
    mutationFn: async ({ id, set, action, to }: QueueAction) => {
      const result = await post<{ job?: QueueJob } & Partial<QueueCancelAllResponse>>(
        set
          ? `/api/queue/sets/${encodeURIComponent(set)}/${action}`
          : id
            ? `/api/queue/${encodeURIComponent(id)}/${action}`
            : `/api/queue/${action}`,
        to === undefined ? undefined : { to },
      );
      // Stop All answers per job; one its worker couldn't confirm stopping fails like a row's Stop.
      const unconfirmed = result.outcomes?.find((outcome) => outcome.error);
      if (unconfirmed) throw new Error(unconfirmed.error);
      return result;
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queueQuery.queryKey }),
        client.invalidateQueries({ queryKey: ["gallery"] }),
      ]),
  });
  function matching(value: QueueAction) {
    return client.isMutating({
      mutationKey: queueActionKey,
      predicate: (mutation) => {
        const pending = mutation.state.variables as QueueAction;
        return (
          pending?.id === value.id && pending.set === value.set && pending.action === value.action
        );
      },
    });
  }
  return {
    isPending: action.isPending || pending > 0,
    mutate: (value: QueueAction) => {
      if (!matching(value)) action.mutate(value);
    },
    /** Resolves to the response (a retry's new job), or `undefined` when already in flight. */
    mutateAsync: async (value: QueueAction) =>
      matching(value) ? undefined : action.mutateAsync(value),
  };
}
export function QueueJobAction({ job, compact = false }: { job: QueueJob; compact?: boolean }) {
  const action = useQueueAction(job.id);
  const retryJobs = useTryAgain(job.items);
  if (terminalStatuses.has(job.status) && job.status !== "failed") return null;
  const retry = job.status === "failed";
  const label = retry ? "Retry" : "Stop";
  const onClick = () =>
    retry ? void retryJobs([job.id]) : action.mutate({ id: job.id, action: "cancel" });
  return compact ? (
    <RowButton
      label={label}
      icon={retry ? icons.retry : icons.stop}
      stop={!retry}
      pending={action.isPending}
      onClick={onClick}
    />
  ) : (
    // The viewer's status, styled as a tile's Stop and Retry.
    <Button
      variant="default"
      size="sm"
      radius="xl"
      leftSection={retry ? <icons.retry size={16} /> : <icons.stop size={16} />}
      loading={action.isPending}
      disabled={action.isPending}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
/**
 * A queue row's or set's action, named in words beside its icon so Stop never reads as a checkbox;
 * `name` is a fuller accessible name that starts with the label.
 */
function RowButton({
  label,
  name,
  icon: Icon,
  stop = false,
  pending,
  onClick,
}: {
  label: string;
  name?: string;
  icon: LucideIcon;
  stop?: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="compact-sm"
      variant="light"
      color={stop ? "red" : "gray"}
      miw="max-content"
      leftSection={<Icon size={14} aria-hidden />}
      aria-label={name}
      loading={pending}
      disabled={pending}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
/** Title Case job states for the queue, tiles and the viewer. */
export const statusLabels: Record<QueueJob["status"], string> = {
  writing: "Writing Prompt",
  queued: "Queued",
  waiting: "Waiting for a Worker",
  starting: "Starting",
  running: "Generating",
  saving: "Saving",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
/** A generation's progress as a percentage, or 0 while it has no steps to count. */
export const progressPercent = (progress: QueueJob["progress"]) =>
  progress?.max ? Math.max(0, Math.min(100, ((progress.value ?? 0) / progress.max) * 100)) : 0;
/** What dragging reorders: the account's own work not yet started; Dream's waits at its own tier. */
const movableJob = (job: QueueJob) =>
  !job.dream && ["writing", "queued", "waiting"].includes(job.status);
const loadSortable = () => import("./SortableQueue");
const SortableQueue = lazy(loadSortable);
/**
 * A run's recorded settings in short: the profile, size, length, steps, seed, LoRAs and outputs.
 * `loraName` lists each LoRA by name with its strength instead of counting them.
 */
export function settingChips(
  input: QueueJob["input"],
  profile?: Profile,
  loraName?: (file: string) => string,
) {
  const name = shownProfileName(
    String(input.profileName || profile?.displayName || profile?.label || ""),
  );
  const steps = input.steps && !new RegExp(`\\b${input.steps}\\s*steps?\\b`, "i").test(name);
  const loras = Array.isArray(input.loras)
    ? input.loras.filter((lora: { enabled?: boolean }) => lora.enabled !== false)
    : [];
  const seconds = Number(input.duration) || Number(input.frames) / Number(input.fps) || 0;
  return [
    name,
    input.width && input.height ? `${input.width} × ${input.height}` : "",
    input.kind === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "",
    steps ? `${input.steps} Steps` : "",
    input.seed !== undefined && input.seed !== "" ? `Seed ${input.seed}` : "",
    ...(loraName
      ? loras.map((lora) => `${loraName(lora.name)} ${Number(lora.strength ?? 1).toFixed(2)}`)
      : [loras.length ? `${loras.length} ${loras.length === 1 ? "LoRA" : "LoRAs"}` : ""]),
    Number(input.count) > 1 ? `${input.count} Outputs` : "",
  ].filter(Boolean);
}

/** What a queue item runs with, shown under its row once opened. */
function QueueJobDetails({
  job,
  profile,
  reason,
}: {
  job: QueueJob;
  profile?: Profile;
  /** Why it waits, when the row's status leaves it out. */
  reason?: string;
}) {
  const { input } = job;
  const info = useQuery(loraInfoQuery);
  const references = Array.isArray(input.referenceDetails)
    ? (input.referenceDetails as ReferenceAsset[])
    : [];
  const prompt = String(input.prompt || "").trim();
  const negative = String(input.negative || "").trim();
  return (
    <Stack gap={6} pb="xs" className={classes.details}>
      {reason && (
        <Text size="xs" c="dimmed">
          {reason}
        </Text>
      )}
      {prompt && (
        <Text size="sm" className={classes.text}>
          {prompt}
        </Text>
      )}
      {negative && (
        <Text size="xs" c="dimmed" className={classes.text}>
          Negative: {negative}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {settingChips(input, profile, (file) => loraTitle(info.data?.loras[file], file)).join(
          " · ",
        )}
      </Text>
      {references.length > 0 && (
        <Group gap={6}>
          {references.map((asset, position) => (
            <Thumbnail
              key={`${asset.slot}:${asset.id}`}
              src={asset.thumbnailUrl || asset.url}
              alt={referenceLabel(asset, position, profile)}
              h={40}
              w={40}
              radius="sm"
            />
          ))}
        </Group>
      )}
    </Stack>
  );
}

/** A job's state in short: Upscaling for a running upscale, then its progress or phase. */
function shortStatus(job: QueueJob) {
  const percent = progressPercent(job.progress);
  return [
    job.operation === "upscale" && job.status === "running"
      ? "Upscaling"
      : statusLabels[job.status],
    percent ? `${Math.round(percent)}%` : job.progress?.phase,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The leading drag handle, apart from the row's Stop at the other end. */
function DragHandle({ drag }: { drag?: QueueRowDrag }) {
  return (
    <Tooltip label="Drag to Reorder">
      <ActionIcon
        ref={drag?.handleRef}
        disabled={!drag}
        aria-label="Drag to Reorder"
        variant="subtle"
        color="gray"
        style={{ cursor: drag?.isDragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <GripVertical size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

const kindIcon = (job: QueueJob, failed: boolean) =>
  failed ? CircleAlert : job.input?.kind === "video" ? Video : Image;

function QueueRow({
  job,
  sortable,
  drag,
  onSwap,
}: {
  job: QueueJob;
  /** Shows its drag handle, which works once `drag` arrives with the sortable list. */
  sortable: boolean;
  drag?: QueueRowDrag;
  /** Offers to swap running text out for this waiting work, when the account may. */
  onSwap?: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const detailsId = useId();
  const phone = usePhone();
  const failed = job.status === "failed";
  const Kind = kindIcon(job, failed);
  // The profile it runs on, by its short name.
  const profile = useGenerationActions().profiles.find((entry) =>
    isProfile(entry, job.input?.profileId),
  );
  // Phones keep the title and a short status (and Paused, or why it failed); the model and any other
  // reason are in the details.
  const reasonShown = !phone || failed || job.reason === pausedReason;
  const status = phone
    ? [shortStatus(job), reasonShown && job.reason].filter(Boolean).join(" · ")
    : [profile && profileName(profile), shortStatus(job), job.reason].filter(Boolean).join(" · ");
  return (
    <div ref={drag?.elementRef} className={classes.row}>
      <Group wrap="nowrap" gap="sm" py="xs">
        {sortable && <DragHandle drag={drag} />}
        {/* Opens the inputs below; only the handle drags, so a tap here never moves the row. */}
        <UnstyledButton
          className={classes.toggle}
          aria-expanded={opened}
          aria-controls={detailsId}
          onClick={() => setOpened((open) => !open)}
        >
          <Group wrap="nowrap" gap="sm">
            <Kind
              size={18}
              aria-hidden
              color={failed ? "var(--mantine-color-red-6)" : "var(--mantine-color-dimmed)"}
              style={{ flexShrink: 0 }}
            />
            <Stack gap={2} flex={1} miw={0}>
              <Text size="sm" lineClamp={1}>
                {String(job.input?.prompt || "Generation")}
              </Text>
              <Text size="xs" c={failed ? "red" : "dimmed"} lineClamp={phone ? 1 : 2}>
                {status}
              </Text>
              {job.dream && (
                <Badge size="xs" color="gray" miw="max-content">
                  Dream
                </Badge>
              )}
            </Stack>
          </Group>
        </UnstyledButton>
        {onSwap && (
          <Button variant="default" size="compact-sm" miw="max-content" onClick={onSwap}>
            Swap to {job.input?.kind === "video" ? "Videos" : "Images"}
          </Button>
        )}
        {failed && <ClearJob job={job} />}
        <QueueJobAction job={job} compact />
      </Group>
      {job.status === "writing" && (
        <div className={classes.details}>
          <WritingStream progress={job.progress} />
        </div>
      )}
      <Collapse id={detailsId} expanded={opened} keepMounted={false}>
        <QueueJobDetails job={job} profile={profile} reason={reasonShown ? "" : job.reason} />
      </Collapse>
    </div>
  );
}

/**
 * A queue row: one job, or a set of several that one request queued together (an MCP `generate`
 * call of several, a split run), whose `members` are all its jobs, finished ones included.
 */
export type QueueEntry = {
  /** The job's ID, or the set's prefixed `set:`. */
  id: string;
  /** The rows it shows: unfinished and failed work. */
  jobs: QueueJob[];
  set?: { id: string; title: string; members: QueueJob[] };
};

/**
 * The queue's rows in order: each set of several jobs one group, where its first shown job is,
 * Dream's jobs each their own row, after everyone else's.
 */
function queueEntries(all: QueueJob[]): QueueEntry[] {
  const members = new Map<string, QueueJob[]>();
  for (const job of all)
    if (job.queueSet && !job.dream)
      members.set(job.queueSet, [...(members.get(job.queueSet) || []), job]);
  const sets = new Map<string, QueueEntry>();
  const entries: QueueEntry[] = [];
  for (const job of shownJobs(all)) {
    const set = job.dream ? undefined : job.queueSet;
    const group = set ? members.get(set) : undefined;
    if (!set || !group || group.length < 2) {
      entries.push({ id: job.id, jobs: [job] });
      continue;
    }
    const entry = sets.get(set);
    if (entry) {
      entry.jobs.push(job);
      continue;
    }
    const first = group[0].input;
    const resultSet = first?.resultSet as { title?: string } | undefined;
    const created = {
      id: `set:${set}`,
      jobs: [job],
      set: {
        id: set,
        title: String(resultSet?.title || first?.prompt || "Generations"),
        members: group,
      },
    };
    sets.set(set, created);
    entries.push(created);
  }
  // Dream's work waits below everyone's own, so it lists last too.
  return [
    ...entries.filter((entry) => !entry.jobs[0].dream),
    ...entries.filter((entry) => entry.jobs[0].dream),
  ];
}

/**
 * A set's group row: its title and progress, Stop for its unfinished work (or Retry Failed once
 * only failures remain), its handle moving its waiting work together, and its jobs below once
 * opened.
 */
function QueueSetRow({
  entry,
  sortable,
  drag,
  row,
}: {
  entry: QueueEntry;
  sortable: boolean;
  drag?: QueueRowDrag;
  row: (job: QueueJob) => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const jobsId = useId();
  const action = useQueueAction();
  const [busy, setBusy] = useState<"stop" | "retry">();
  const { title, members } = entry.set!;
  const done = members.filter((job) => job.status === "completed").length;
  const total = members.filter((job) => job.status !== "cancelled").length;
  const failed = members.filter((job) => job.status === "failed").map((job) => job.id);
  const unfinished = members
    .filter((job) => !terminalStatuses.has(job.status))
    .map((job) => job.id);
  const Kind = kindIcon(members[0], !unfinished.length && failed.length > 0);
  // The set's state as its leading unfinished job's: one running, else the first waiting.
  const lead =
    members.find((job) => ["starting", "running", "saving"].includes(job.status)) ??
    members.find((job) => !terminalStatuses.has(job.status));
  const stop = async () => {
    setBusy("stop");
    await Promise.allSettled(unfinished.map((id) => action.mutateAsync({ id, action: "cancel" })));
    setBusy(undefined);
  };
  const retryJobs = useTryAgain(members.flatMap((job) => job.items));
  const retry = async () => {
    setBusy("retry");
    await retryJobs(failed);
    setBusy(undefined);
  };
  const retryButton = (
    <RowButton
      label="Retry Failed"
      icon={icons.retry}
      pending={busy === "retry"}
      onClick={() => void retry()}
    />
  );
  return (
    <div ref={drag?.elementRef} className={classes.row}>
      <Group wrap="nowrap" gap="sm" py="xs">
        {sortable && <DragHandle drag={drag} />}
        <UnstyledButton
          className={classes.toggle}
          aria-expanded={opened}
          aria-controls={jobsId}
          onClick={() => setOpened((open) => !open)}
        >
          <Group wrap="nowrap" gap="sm">
            <Kind
              size={18}
              aria-hidden
              color={
                Kind === CircleAlert ? "var(--mantine-color-red-6)" : "var(--mantine-color-dimmed)"
              }
              style={{ flexShrink: 0 }}
            />
            <Stack gap={2} flex={1} miw={0}>
              <Text size="sm" lineClamp={1}>
                {title}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {[
                  lead && shortStatus(lead),
                  `${done} of ${total} Done`,
                  failed.length && `${failed.length} Failed`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Stack>
            <ChevronDown
              size={16}
              aria-hidden
              className={classes.chevron}
              data-opened={opened || undefined}
            />
          </Group>
        </UnstyledButton>
        {unfinished.length ? (
          <RowButton
            label="Stop"
            name="Stop Set"
            icon={icons.stop}
            stop
            pending={busy === "stop"}
            onClick={() => void stop()}
          />
        ) : (
          failed.length > 0 && retryButton
        )}
      </Group>
      <Collapse id={jobsId} expanded={opened} keepMounted={false}>
        <div className={classes.set}>
          {entry.jobs.map(row)}
          {unfinished.length > 0 && failed.length > 0 && (
            <Group justify="end" py="xs">
              {retryButton}
            </Group>
          )}
        </div>
      </Collapse>
    </div>
  );
}
function ClearJob({ job }: { job: QueueJob }) {
  const action = useQueueAction(job.id);
  return (
    <Tooltip label="Clear">
      <ActionIcon
        aria-label="Clear"
        variant="subtle"
        color="gray"
        loading={action.isPending}
        disabled={action.isPending}
        onClick={() => action.mutate({ id: job.id, action: "clear" })}
      >
        <icons.clear size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
const bulk = {
  "cancel-all": {
    label: "Stop All",
    title: "Stop All Generations",
  },
  "clear-failed": {
    label: "Clear Failed",
    icon: icons.clearFailed,
    title: "Clear Failed Generations",
    text: "Failed generations leave the queue. Their records stay in the gallery and can still be retried.",
  },
} as const;
/** The queue's own actions on its heading's row: Pause and Clear Failed as icons, Stop All named. */
export function QueueActions() {
  const queue = useQueue();
  const action = useQueueAction();
  // Only Stop All's own request spins it, not Pause or Clear Failed.
  const stoppingAll =
    useIsMutating({
      mutationKey: queueActionKey,
      predicate: (mutation) => (mutation.state.variables as QueueAction)?.action === "cancel-all",
    }) > 0;
  const everyone = usePausesEveryone();
  const [confirming, setConfirming] = useState<keyof typeof bulk>();
  if (!queue.data) return null;
  const jobs = shownJobs(queue.data.jobs);
  // An empty queue offers its Resume in the empty state instead.
  if (!jobs.length) return null;
  const pause = pauseControl(queue.data.paused, everyone);
  // Stop All leaves Dream's work to Dream's own pause.
  const stopping = jobs.filter((job) => !job.dream && !terminalStatuses.has(job.status)).length;
  const dreaming = jobs.some((job) => job.dream && !terminalStatuses.has(job.status));
  const text = {
    "cancel-all": [
      `Studio stops your ${stopping} unfinished ${stopping === 1 ? "generation" : "generations"}.`,
      "Results already saving are kept.",
      dreaming ? "Dream's work waits for Dream's own pause." : "",
    ]
      .filter(Boolean)
      .join(" "),
    "clear-failed": bulk["clear-failed"].text,
  };
  const clearing = jobs.some((job) => job.status === "failed");
  const queueAction = (label: string, Icon: LucideIcon, onClick: () => void) => (
    <Tooltip key={label} label={label}>
      <ActionIcon
        aria-label={label}
        variant="subtle"
        color="gray"
        disabled={action.isPending}
        onClick={onClick}
      >
        <Icon size={16} />
      </ActionIcon>
    </Tooltip>
  );
  return (
    // At the end of the heading it shares: beside the title, or beside the phone drawer's Close.
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {queueAction(pause.label, pause.held ? icons.resume : icons.pause, () =>
        pause.actions.forEach((key) => action.mutate({ id: "", action: key })),
      )}
      {clearing &&
        queueAction(bulk["clear-failed"].label, bulk["clear-failed"].icon, () =>
          setConfirming("clear-failed"),
        )}
      {/* Named in words, apart from the icons, so it never reads as a checkbox. */}
      {stopping > 0 && (
        <RowButton
          label="Stop All"
          icon={icons.stop}
          stop
          pending={stoppingAll}
          onClick={() => setConfirming("cancel-all")}
        />
      )}
      <ConfirmDialog
        opened={confirming !== undefined}
        title={confirming ? bulk[confirming].title : ""}
        action={confirming ? bulk[confirming].label : ""}
        pending={action.isPending}
        onClose={() => setConfirming(undefined)}
        onConfirm={() =>
          action
            .mutateAsync({ id: "", action: confirming! })
            .then(() => setConfirming(undefined))
            // The MutationCache notification reports a failure; the dialog stays open to retry.
            .catch(() => undefined)
        }
      >
        {confirming && text[confirming]}
      </ConfirmDialog>
    </Group>
  );
}
const shownJobs = (jobs: QueueJob[]) =>
  jobs.filter((job) => !["completed", "cancelled"].includes(job.status));
// In single-user mode the account's own pause already holds everything.
function usePausesEveryone() {
  const multiUser = useAccount().data?.mode === "multi-user";
  return useIsAdmin() && multiUser;
}
/**
 * The queue's one Pause: an administrator of a multi-user Studio holds every account's work, their
 * own included; anyone else holds their own. Resume releases whichever holds the account's work.
 */
function pauseControl(paused: QueuePause, everyone: boolean) {
  const held = paused.mine || (everyone && paused.all);
  const actions: QueueAction["action"][] = held
    ? [paused.mine && "resume", everyone && paused.all && "resume-all"].filter(
        (key): key is QueueAction["action"] => Boolean(key),
      )
    : [everyone ? "pause-all" : "pause"];
  return { held, label: held ? "Resume" : "Pause Queue", actions };
}
export function Queue() {
  const queue = useQueue();
  const action = useQueueAction();
  const everyone = usePausesEveryone();
  const client = useQueryClient();
  const swap = useJobSwap();
  // Loads dragging ahead of a second waiting item, so the rows aren't replaced when it arrives.
  useEffect(() => void loadSortable(), []);
  if (queue.error) return <Alert color="red">{queue.error.message}</Alert>;
  if (queue.isPending) return <LoadingState label="Loading Generations" fill />;
  const { paused } = queue.data;
  const jobs = shownJobs(queue.data.jobs);
  if (!jobs.length) {
    // An empty queue still offers the one action that lets work start again.
    const pause = pauseControl(paused, everyone);
    return (
      <EmptyState
        fill
        action={
          pause.held && (
            <Button
              variant="default"
              loading={action.isPending}
              onClick={() => pause.actions.forEach((key) => action.mutate({ id: "", action: key }))}
            >
              Resume
            </Button>
          )
        }
      >
        Empty Queue
      </EmptyState>
    );
  }
  const entries = queueEntries(queue.data.jobs);
  const waiting = (entry: QueueEntry) => entry.jobs.filter(movableJob);
  const movable = entries.filter((entry) => waiting(entry).length > 0);
  const sortable = movable.length > 1;
  const jobRow = (job: QueueJob, drag?: QueueRowDrag, handle = false) => (
    <QueueRow
      key={job.id}
      job={job}
      sortable={handle}
      drag={drag}
      onSwap={swap.swappable(job) ? () => swap.offer(job) : undefined}
    />
  );
  const row = (entry: QueueEntry, drag?: QueueRowDrag) =>
    entry.set ? (
      <QueueSetRow
        key={entry.id}
        entry={entry}
        sortable={sortable && movable.includes(entry)}
        drag={drag}
        row={(job) => jobRow(job)}
      />
    ) : (
      jobRow(entry.jobs[0], drag, sortable && movable.includes(entry))
    );
  // A set's waiting work moves as one, in its order, to `to` among the waiting entries. The new
  // order shows at once; the refetch after the move settles it, a failed one included.
  function move(entry: QueueEntry, to: number) {
    const order = arrayMove(movable, movable.indexOf(entry), to).flatMap(waiting);
    const at = order.indexOf(waiting(entry)[0]);
    const ids = order.map((job) => job.id);
    client.setQueryData(queueQuery.queryKey, (data) => {
      if (!data) return data;
      const pending = data.jobs.filter(movableJob);
      const byId = new Map(pending.map((job) => [job.id, job]));
      const next = ids.map((id) => byId.get(id)).filter((job) => job !== undefined);
      if (next.length !== pending.length) return data;
      const jobs = [...data.jobs];
      pending.forEach((job, index) => {
        jobs[data.jobs.indexOf(job)] = next[index];
      });
      return { ...data, jobs };
    });
    void action
      .mutateAsync(
        entry.set
          ? { id: "", set: entry.set.id, action: "move", to: at }
          : { id: entry.id, action: "move", to: at },
      )
      .catch(() => client.invalidateQueries({ queryKey: queueQuery.queryKey }));
  }
  return (
    <Stack gap={0} aria-label="Queue">
      {paused.all && !everyone && (
        <Text size="xs" c="dimmed" py="xs">
          An administrator has paused the queue.
        </Text>
      )}
      {sortable ? (
        <Suspense fallback={entries.map((entry) => row(entry))}>
          <SortableQueue entries={entries} movable={movable} row={row} onMove={move} />
        </Suspense>
      ) : (
        entries.map((entry) => row(entry))
      )}
      {swap.dialog}
    </Stack>
  );
}
