import { Alert, Badge, Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
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
export function Queue({ sessionId }: { sessionId?: string }) {
  const client = useQueryClient();
  const queue = useQueue();
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(id ? `/api/queue/${encodeURIComponent(id)}/${action}` : "/api/queue/cancel-pending"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["session"] });
    },
    onError: failure,
  });
  const jobs = (queue.data?.jobs ?? []).filter((j) => !sessionId || j.sessionId === sessionId);
  if (queue.error) return <Alert color="red">{queue.error.message}</Alert>;
  return (
    <Stack gap="sm" aria-label="Generation Queue">
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
          Your generations and their progress will appear here.
        </Text>
      ) : (
        jobs.map((job) => (
          <Paper key={job.id} p="md">
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
                  to={`/sessions/${job.sessionId}`}
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
