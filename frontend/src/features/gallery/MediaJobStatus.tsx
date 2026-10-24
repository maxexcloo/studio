import { Alert, Button, Group, Loader, Progress, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router";
import type { MediaItem } from "../../types";
import { useTryAgain } from "./useTryAgain";
import { QueueJobAction, statusLabels, terminal, useQueue } from "../generation/Queue";

/** Only a matching account-owned durable queue record can expose retry or cancellation. */
export function MediaJobStatus({
  item,
  onRetried,
}: {
  item: MediaItem;
  /** Receives the replacement job once a retry is accepted and the failed item is removed. */
  onRetried?: (jobId: string) => void;
}) {
  const queue = useQueue();
  const tryAgain = useTryAgain([item]);
  const [retrying, setRetrying] = useState(false);
  const job = item.jobId ? queue.data?.jobs.find((job) => job.id === item.jobId) : undefined;
  const savedError = "error" in item && typeof item.error === "string" ? item.error : "";
  const loading = Boolean(item.jobId && !job && (queue.isPending || queue.isFetching));
  const failed = job?.status === "failed" || (!job && item.status === "error");
  const cancelled = job?.status === "cancelled" || (!job && item.status === "canceled");
  const active = job && !terminal.has(job.status);
  const progress = job?.progress;
  return (
    <Stack
      role="status"
      aria-label="Generation Status"
      aria-live="polite"
      align="center"
      gap="md"
      p="lg"
      maw="32rem"
      w="100%"
      onClick={(event) => event.stopPropagation()}
    >
      {(loading || active) && (
        <Loader
          size="sm"
          color="gray"
          aria-label={loading ? "Loading Generation Status" : statusLabels[job!.status]}
        />
      )}
      <Text size="lg" fw={600} c={failed ? "red" : undefined} ta="center">
        {loading
          ? "Loading Generation Status"
          : job
            ? statusLabels[job.status]
            : failed
              ? statusLabels.failed
              : cancelled
                ? statusLabels.cancelled
                : "Generation Unavailable"}
      </Text>
      {(job?.reason || savedError) && (
        <Text size="sm" c={failed ? "red" : "dimmed"} ta="center">
          {job?.reason || savedError}
        </Text>
      )}
      {progress && active && (
        <Progress
          aria-label="Generation Progress"
          w="100%"
          value={
            progress.max > 0 ? Math.max(0, Math.min(100, (progress.value / progress.max) * 100)) : 0
          }
          animated
        />
      )}
      {item.jobId && queue.error ? (
        <Alert color="red" title="Couldn’t Load Generation Status">
          <Stack gap="sm">
            <Text size="sm">{queue.error.message}</Text>
            <Button
              variant="subtle"
              size="compact-sm"
              loading={queue.isFetching}
              onClick={() => void queue.refetch()}
            >
              Reload Status
            </Button>
          </Stack>
        </Alert>
      ) : !job && !loading ? (
        <Text size="sm" c="dimmed" ta="center">
          No recorded generation is available to retry. Use Recreate to generate from this item’s
          saved inputs.
        </Text>
      ) : null}
      {job && (
        <Group justify="center">
          {job.status === "failed" ? (
            <Button
              variant="default"
              size="sm"
              loading={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  const replacement = (await tryAgain([job.id])).get(job.id);
                  if (replacement) onRetried?.(replacement);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              Retry
            </Button>
          ) : (
            <QueueJobAction job={job} />
          )}
          <Button component={Link} to={`/chat/${job.sessionId}`} variant="subtle" size="compact-sm">
            Open Chat
          </Button>
        </Group>
      )}
    </Stack>
  );
}
