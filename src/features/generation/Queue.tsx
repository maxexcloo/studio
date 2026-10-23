import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, RotateCw } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "../../ui/EmptyState";
import { api, failure, post } from "../../api";
import type { QueueJob } from "../../types";
export const terminal = new Set(["completed", "failed", "cancelled"]);
export function useQueue() {
  return useQuery({
    queryKey: ["queue"],
    queryFn: () => api<{ jobs: QueueJob[] }>("/api/queue"),
    refetchInterval: 1500,
  });
}
export function Queue({ sessionId, compact = false }: { sessionId?: string; compact?: boolean }) {
  const client = useQueryClient();
  const queue = useQueue();
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(id ? `/api/queue/${encodeURIComponent(id)}/${action}` : `/api/queue/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["session"] });
    },
    onError: failure,
  });
  const jobs = (queue.data?.jobs ?? []).filter(
    (j) =>
      (!sessionId || j.sessionId === sessionId) &&
      (!compact || !["completed", "cancelled"].includes(j.status)),
  );
  if (queue.error) return <Alert color="red">{queue.error.message}</Alert>;
  if (compact)
    return (
      <Stack gap="md" flex={1} mih={0} aria-label="Queue">
        {jobs.some((job) => !terminal.has(job.status)) && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            style={{ alignSelf: "end" }}
            loading={action.isPending}
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
            <Tooltip label={job.status === "failed" ? "Retry" : "Cancel"}>
              <ActionIcon
                aria-label={job.status === "failed" ? "Retry" : "Cancel"}
                variant="subtle"
                color="gray"
                size={36}
                loading={action.isPending}
                onClick={() =>
                  action.mutate({
                    id: job.id,
                    action: job.status === "failed" ? "retry" : "cancel",
                  })
                }
              >
                {job.status === "failed" ? <RotateCw size={16} /> : <X size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}
      </Stack>
    );
  return (
    <Stack gap="sm" aria-label="Queue">
      {!sessionId && jobs.some((job) => ["queued", "waiting"].includes(job.status)) && (
        <Button
          variant="subtle"
          color="red"
          style={{ alignSelf: "start" }}
          onClick={() => action.mutate({ id: "", action: "cancel-pending" })}
        >
          Cancel My Pending Jobs
        </Button>
      )}
      {jobs.length === 0 ? (
        <Text c="dimmed" size="sm">
          Empty Queue
        </Text>
      ) : (
        jobs.map((job) => (
          <Paper withBorder key={job.id} p="md">
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Text fw={500} lineClamp={1}>
                  {job.input?.prompt || job.operation || "Generation"}
                </Text>
                <Badge
                  color={
                    job.status === "failed" ? "red" : job.status === "completed" ? "green" : "gray"
                  }
                >
                  {job.status}
                </Badge>
              </Group>
              {job.reason && (
                <Text size="sm" c={job.status === "failed" ? "red" : "dimmed"}>
                  {job.reason}
                </Text>
              )}
              {job.progress && !terminal.has(job.status) && (
                <Progress
                  aria-label="Generation Progress"
                  value={job.progress.max ? (job.progress.value / job.progress.max) * 100 : 0}
                  animated
                />
              )}
              <Group gap="xs">
                <Button
                  component={Link}
                  to={`/chat/${job.sessionId}`}
                  variant="subtle"
                  size="compact-sm"
                >
                  Open Session
                </Button>
                {!terminal.has(job.status) && (
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    loading={action.isPending}
                    onClick={() => action.mutate({ id: job.id, action: "cancel" })}
                  >
                    Cancel
                  </Button>
                )}
                {job.status === "failed" && (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => action.mutate({ id: job.id, action: "retry" })}
                  >
                    Retry
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}
