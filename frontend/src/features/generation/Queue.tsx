import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
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
import { CircleAlert, Image, RotateCw, Video, X } from "lucide-react";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import classes from "./Queue.module.css";
import { api, post } from "../../api";
import type { QueueJob } from "../../types";
import { WritingStream } from "./PromptWriting";
export const terminal = new Set(["completed", "failed", "cancelled"]);
export const queueQuery = queryOptions({
  queryKey: ["queue"],
  queryFn: () => api<{ jobs: QueueJob[] }>("/api/queue"),
  // Idle queues don't poll: every in-app submit (composer, viewer, Chat stream) invalidates this
  // query, and work started elsewhere (another tab, MCP) appears on window focus.
  refetchInterval: (query) =>
    query.state.data?.jobs.some((job) => !terminal.has(job.status)) ? 1500 : false,
});
export function useQueue() {
  return useQuery(queueQuery);
}
const queueActionKey = ["queue-action"];
type QueueAction = { id: string; action: "cancel" | "retry" | "cancel-all" };
export function useQueueAction(jobId?: string) {
  const client = useQueryClient();
  const pending = useIsMutating({
    mutationKey: queueActionKey,
    predicate: (mutation) =>
      jobId !== undefined && (mutation.state.variables as QueueAction)?.id === jobId,
  });
  const action = useMutation({
    mutationKey: queueActionKey,
    mutationFn: ({ id, action }: QueueAction) =>
      post<{ job?: QueueJob }>(
        id ? `/api/queue/${encodeURIComponent(id)}/${action}` : `/api/queue/${action}`,
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
  if (terminal.has(job.status) && job.status !== "failed") return null;
  const retry = job.status === "failed";
  const label = retry ? "Retry" : "Cancel";
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
        {retry ? <RotateCw size={16} /> : <X size={16} />}
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
function QueueRow({ job }: { job: QueueJob }) {
  const failed = job.status === "failed";
  const { progress } = job;
  const percent = progressPercent(progress);
  const Kind = failed ? CircleAlert : job.input?.kind === "video" ? Video : Image;
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
          {[statusLabels[job.status], progress?.phase, job.reason].filter(Boolean).join(" · ")}
        </Text>
        {job.status === "writing" && <WritingStream progress={progress} />}
      </Stack>
      {!terminal.has(job.status) &&
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
    </Group>
  );
}
export function Queue() {
  const queue = useQueue();
  const action = useQueueAction();
  const jobs = (queue.data?.jobs ?? []).filter(
    (job) => !["completed", "cancelled"].includes(job.status),
  );
  if (queue.error) return <Alert color="red">{queue.error.message}</Alert>;
  if (queue.isPending) return <LoadingState label="Loading Generations" fill />;
  if (!jobs.length) return <EmptyState fill>Empty Queue</EmptyState>;
  return (
    <Stack gap={0} aria-label="Queue">
      {jobs.some((job) => !terminal.has(job.status)) && (
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          style={{ alignSelf: "end" }}
          loading={action.isPending}
          disabled={action.isPending}
          onClick={() => action.mutate({ id: "", action: "cancel-all" })}
        >
          Cancel All
        </Button>
      )}
      {jobs.map((job) => (
        <QueueRow key={job.id} job={job} />
      ))}
    </Stack>
  );
}
