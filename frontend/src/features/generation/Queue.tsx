import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Menu,
  RingProgress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  CircleAlert,
  Image,
  ListOrdered,
  Video,
  type LucideIcon,
} from "lucide-react";
import { icons } from "../../ui/icons";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import classes from "./Queue.module.css";
import { api, post } from "../../api";
import type { QueueJob } from "../../types";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { useGenerationActions } from "./GenerationProvider";
import { isProfile, profileName } from "./payload";
import { WritingStream } from "./PromptWriting";
import { terminalStatuses, type QueueMove, type QueuePause } from "../../../../shared/queue";
export const queueQuery = queryOptions({
  queryKey: ["queue"],
  queryFn: () => api<{ jobs: QueueJob[]; paused: QueuePause }>("/api/queue"),
  // Idle queues don't poll: every in-app submit (composer, viewer, Chat stream) invalidates this
  // query, and work started elsewhere (another tab, MCP) appears on window focus.
  refetchInterval: (query) =>
    query.state.data?.jobs.some((job) => !terminalStatuses.has(job.status)) ? 1500 : false,
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
  /** Where `move` takes the item among the account's waiting items. */
  to?: QueueMove;
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
        to && { to },
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
/** Not yet started: the items a pause holds and Move reorders. */
const waiting = (job: QueueJob) => ["writing", "queued", "waiting"].includes(job.status);
const moves = [
  { to: "top", label: "Move to Top", Icon: ArrowUpToLine },
  { to: "up", label: "Move Up", Icon: ArrowUp },
  { to: "down", label: "Move Down", Icon: ArrowDown },
] as const;
/** Moves a waiting item among the account's other waiting items; other accounts keep their places. */
function MoveJob({ job, first, last }: { job: QueueJob; first: boolean; last: boolean }) {
  const action = useQueueAction(job.id);
  return (
    <Menu position="bottom-end">
      <Tooltip label="Move">
        <Menu.Target>
          <ActionIcon aria-label="Move" variant="subtle" color="gray" loading={action.isPending}>
            <ListOrdered size={16} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        {moves.map(({ to, label, Icon }) => (
          <Menu.Item
            key={to}
            leftSection={<Icon size={16} />}
            disabled={to === "down" ? last : first}
            onClick={() => action.mutate({ id: job.id, action: "move", to })}
          >
            {label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
function QueueRow({ job, place }: { job: QueueJob; place?: { first: boolean; last: boolean } }) {
  const failed = job.status === "failed";
  const { progress } = job;
  const percent = progressPercent(progress);
  const Kind = failed ? CircleAlert : job.input?.kind === "video" ? Video : Image;
  // The profile it runs on, by its short name.
  const profile = useGenerationActions().profiles.find((entry) =>
    isProfile(entry, job.input?.profileId),
  );
  return (
    <Group wrap="nowrap" gap="sm" py="xs" className={classes.row}>
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
          {[profile && profileName(profile), statusLabels[job.status], progress?.phase, job.reason]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {job.status === "writing" && <WritingStream progress={progress} />}
      </Stack>
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
      {place && <MoveJob job={job} {...place} />}
      <QueueJobAction job={job} compact />
      {failed && <ClearJob job={job} />}
    </Group>
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
  return (
    <Stack gap={0} aria-label="Queue">
      {paused.all && !everyone && (
        <Text size="xs" c="dimmed" py="xs">
          An administrator has paused the queue.
        </Text>
      )}
      {jobs.map((job) => (
        <QueueRow
          key={job.id}
          job={job}
          place={
            movable.length > 1 && waiting(job)
              ? { first: job === movable[0], last: job === movable.at(-1) }
              : undefined
          }
        />
      ))}
    </Stack>
  );
}
