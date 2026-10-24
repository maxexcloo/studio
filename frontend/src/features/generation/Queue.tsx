import { ActionIcon, Alert, Button, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { X, RotateCw } from "lucide-react";
import { EmptyState } from "../../ui/EmptyState";
import { api, failure, post } from "../../api";
import type { QueueJob } from "../../types";
export const terminal = new Set(["completed", "failed", "cancelled"]);
export const queueQuery = queryOptions({
  queryKey: ["queue"],
  queryFn: () => api<{ jobs: QueueJob[] }>("/api/queue"),
  refetchInterval: 1500,
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
      post(id ? `/api/queue/${encodeURIComponent(id)}/${action}` : `/api/queue/${action}`),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queueQuery.queryKey }),
        client.invalidateQueries({ queryKey: ["session"] }),
        client.invalidateQueries({ queryKey: ["gallery"] }),
      ]),
    onError: failure,
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
    mutateAsync: async (value: QueueAction) => {
      if (matching(value)) return false;
      await action.mutateAsync(value);
      return true;
    },
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
        size={36}
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
export function Queue() {
  const queue = useQueue();
  const action = useQueueAction();
  const jobs = (queue.data?.jobs ?? []).filter(
    (job) => !["completed", "cancelled"].includes(job.status),
  );
  if (queue.error) return <Alert color="red">{queue.error.message}</Alert>;
  return (
    <Stack gap="md" flex={1} mih={0} aria-label="Queue">
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
      {!jobs.length && <EmptyState fill>Empty Queue</EmptyState>}
      {jobs.map((job) => (
        <Group
          key={job.id}
          wrap="nowrap"
          align="start"
          gap="sm"
          style={{
            paddingBlock: "var(--mantine-spacing-xs)",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          {!terminal.has(job.status) && <Loader size={16} color="gray" mt={4} />}
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" lineClamp={1}>
              {String(job.input?.prompt || "Generation")}
            </Text>
            <Text size="xs" c={job.status === "failed" ? "red" : "dimmed"}>
              {job.reason || job.status}
            </Text>
          </Stack>
          <QueueJobAction job={job} compact />
        </Group>
      ))}
    </Stack>
  );
}
