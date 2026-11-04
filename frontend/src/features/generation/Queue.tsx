import {
  ActionIcon,
  Alert,
  Button,
  Collapse,
  Group,
  Image as Thumbnail,
  Loader,
  RingProgress,
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
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { CircleAlert, GripVertical, Image, Video, type LucideIcon } from "lucide-react";
import { icons } from "../../ui/icons";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import classes from "./Queue.module.css";
import { api, post } from "../../api";
import type { Profile, QueueJob, ReferenceAsset } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { useGenerationActions } from "./GenerationProvider";
import { loraInfoQuery, loraTitle } from "./LoraPicker";
import { isProfile, profileName, shownProfileName } from "./payload";
import { referenceLabel } from "./references";
import { WritingStream } from "./PromptWriting";
import type { QueueRowDrag } from "./SortableQueue";
import { terminalStatuses, type QueuePause } from "../../../../shared/queue";
export const queueQuery = queryOptions({
  queryKey: ["queue"],
  queryFn: () => api<{ jobs: QueueJob[]; paused: QueuePause }>("/api/queue"),
  // Every in-app submit (composer, viewer, Chat stream) invalidates this query; an idle queue still
  // checks now and then, so work started elsewhere (an MCP client, another tab) shows, and the
  // gallery with it, without the window regaining focus.
  refetchInterval: (query) =>
    query.state.data?.jobs.some((job) => !terminalStatuses.has(job.status)) ? 1500 : 15_000,
});
export function useQueue() {
  return useQuery(queueQuery);
}
const queueActionKey = ["queue-action"];
/** An empty `id` acts on the whole queue (`cancel-all`, `clear-failed`, `pause` and the like). */
type QueueAction = {
  id: string;
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
    mutationFn: ({ id, action, to }: QueueAction) =>
      post<{ job?: QueueJob }>(
        id ? `/api/queue/${encodeURIComponent(id)}/${action}` : `/api/queue/${action}`,
        to === undefined ? undefined : { to },
      ),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queueQuery.queryKey }),
        client.invalidateQueries({ queryKey: ["session"] }),
        client.invalidateQueries({ queryKey: ["gallery"] }),
      ]),
  });
  function matching(value: QueueAction) {
    return client.isMutating({
      mutationKey: queueActionKey,
      predicate: (mutation) => {
        const pending = mutation.state.variables as QueueAction;
        return pending?.id === value.id && pending.action === value.action;
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
  if (terminalStatuses.has(job.status) && job.status !== "failed") return null;
  const retry = job.status === "failed";
  const label = retry ? "Retry" : "Stop";
  const onClick = () => action.mutate({ id: job.id, action: retry ? "retry" : "cancel" });
  return compact ? (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label}
        variant="subtle"
        color="gray"
        loading={action.isPending}
        disabled={action.isPending}
        onClick={onClick}
      >
        {retry ? <icons.retry size={16} /> : <icons.stop size={16} />}
      </ActionIcon>
    </Tooltip>
  ) : (
    <Button
      variant={retry ? "default" : "subtle"}
      color={retry ? undefined : "red"}
      size={retry ? "sm" : "compact-sm"}
      style={{ alignSelf: "start" }}
      loading={action.isPending}
      disabled={action.isPending}
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
/** Not yet started: the items a pause holds and dragging reorders. */
const waiting = (job: QueueJob) => ["writing", "queued", "waiting"].includes(job.status);
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
function QueueJobDetails({ job, profile }: { job: QueueJob; profile?: Profile }) {
  const { input } = job;
  const info = useQuery(loraInfoQuery);
  const references = Array.isArray(input.referenceDetails)
    ? (input.referenceDetails as ReferenceAsset[])
    : [];
  const prompt = String(input.prompt || "").trim();
  const negative = String(input.negative || "").trim();
  return (
    <Stack gap={6} pb="xs" className={classes.details}>
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

function QueueRow({
  job,
  sortable,
  drag,
}: {
  job: QueueJob;
  /** Shows its drag handle, which works once `drag` arrives with the sortable list. */
  sortable: boolean;
  drag?: QueueRowDrag;
}) {
  const [opened, setOpened] = useState(false);
  const detailsId = useId();
  const duration = useMotionDuration();
  const failed = job.status === "failed";
  const { progress } = job;
  const percent = progressPercent(progress);
  const Kind = failed ? CircleAlert : job.input?.kind === "video" ? Video : Image;
  // The profile it runs on, by its short name.
  const profile = useGenerationActions().profiles.find((entry) =>
    isProfile(entry, job.input?.profileId),
  );
  return (
    <div ref={drag?.elementRef} className={classes.row}>
      <Group wrap="nowrap" gap="sm" py="xs">
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
              <Text size="xs" c={failed ? "red" : "dimmed"} lineClamp={2}>
                {[
                  profile && profileName(profile),
                  statusLabels[job.status],
                  progress?.phase,
                  job.reason,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Stack>
          </Group>
        </UnstyledButton>
        {/* Trailing, so waiting rows' text lines up with the others' and Stop keeps its column. */}
        {sortable && (
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
        )}
        {!terminalStatuses.has(job.status) &&
          (percent ? (
            <RingProgress
              size={28}
              thickness={3}
              roundCaps
              rootColor="var(--mantine-color-default-border)"
              sections={[{ value: percent, color: "var(--mantine-color-dimmed)" }]}
              aria-label={`${Math.round(percent)}% Complete`}
            />
          ) : (
            <Loader size={16} color="gray" aria-label={statusLabels[job.status]} />
          ))}
        <QueueJobAction job={job} compact />
        {failed && <ClearJob job={job} />}
      </Group>
      {job.status === "writing" && (
        <div className={classes.details}>
          <WritingStream progress={progress} />
        </div>
      )}
      <Collapse id={detailsId} expanded={opened} keepMounted={false} transitionDuration={duration}>
        <QueueJobDetails job={job} profile={profile} />
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
    icon: icons.stop,
    title: "Stop All Generations?",
    text: "Studio stops every active generation. Results already saving are kept.",
  },
  "clear-failed": {
    label: "Clear Failed",
    icon: icons.clear,
    title: "Clear Failed Generations?",
    text: "Failed generations leave the queue. Their chat cards stay and can still be retried.",
  },
} as const;
/** The queue's own actions, as icons like each row's, on its heading's row. */
export function QueueActions() {
  const queue = useQueue();
  const action = useQueueAction();
  const everyone = usePausesEveryone();
  const [confirming, setConfirming] = useState<keyof typeof bulk>();
  if (!queue.data) return null;
  const jobs = shownJobs(queue.data.jobs);
  // An empty queue offers its Resume in the empty state instead.
  if (!jobs.length) return null;
  const pause = pauseControl(queue.data.paused, everyone);
  const available = (Object.keys(bulk) as (keyof typeof bulk)[]).filter((key) =>
    jobs.some((job) =>
      key === "cancel-all" ? !terminalStatuses.has(job.status) : job.status === "failed",
    ),
  );
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
    <Group gap={4} wrap="nowrap">
      {queueAction(pause.label, pause.held ? icons.resume : icons.pause, () =>
        pause.actions.forEach((key) => action.mutate({ id: "", action: key })),
      )}
      {available.map((key) =>
        queueAction(bulk[key].label, bulk[key].icon, () => setConfirming(key)),
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
        {confirming && bulk[confirming].text}
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
  const movable = jobs.filter(waiting);
  const sortable = movable.length > 1;
  const row = (job: QueueJob, drag?: QueueRowDrag) => (
    <QueueRow key={job.id} job={job} sortable={sortable && waiting(job)} drag={drag} />
  );
  // The new order shows at once; the refetch after the move settles it, a failed one included.
  function move(job: QueueJob, to: number) {
    client.setQueryData(queueQuery.queryKey, (data) => {
      if (!data) return data;
      const pending = data.jobs.filter(waiting);
      const slots = pending.map((item) => data.jobs.indexOf(item));
      const jobs = [...data.jobs];
      arrayMove(pending, pending.indexOf(job), to).forEach((item, index) => {
        jobs[slots[index]] = item;
      });
      return { ...data, jobs };
    });
    void action
      .mutateAsync({ id: job.id, action: "move", to })
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
        <Suspense fallback={jobs.map((job) => row(job))}>
          <SortableQueue jobs={jobs} movable={movable} row={row} onMove={move} />
        </Suspense>
      ) : (
        jobs.map((job) => row(job))
      )}
    </Stack>
  );
}
