import { Alert, Button, Group, Loader, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { CircleAlert } from "lucide-react";

import { terminalStatuses } from "../../../../shared/queue";
import type { MediaItem } from "../../types";
import { JobProgressBar, jobReason, jobStatus, statusLabels } from "../generation/JobProgress";
import { WritingStream } from "../generation/PromptWriting";
import { QueueJobAction, useQueue } from "../generation/Queue";

import classes from "./MediaJobStatus.module.css";

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
  const job = item.jobId ? queue.data?.jobs.find((job) => job.id === item.jobId) : undefined;
  const savedError = "error" in item && typeof item.error === "string" ? item.error : "";
  const loading = Boolean(item.jobId && queue.isPending);
  const status = job ? job.status : item.status;
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const active = job && !terminalStatuses.has(job.status);
  const progress = job?.progress;
  const reason = (job && jobReason(job)) || savedError;
  const queueError = item.jobId ? queue.error : null;

  if (!loading && !active && !cancelled) {
    return (
      <Paper
        className={classes.panel}
        role="status"
        aria-label="Generation Status"
        radius="lg"
        p="md"
        withBorder
        onClick={(event) => event.stopPropagation()}
      >
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon color={failed ? "red" : "gray"} variant="light" radius="md">
            <CircleAlert size={16} aria-hidden />
          </ThemeIcon>
          <Text fw={600}>{failed ? "Generation Failed" : "Generation Unavailable"}</Text>
        </Group>
        <Stack className={classes.reason} gap="xs" tabIndex={0}>
          <Text size="sm">
            {reason ||
              (failed
                ? "No error was recorded for this generation."
                : "This generation has no media.")}
          </Text>
          {queueError ? (
            <Text size="sm" c="dimmed">
              Couldn't load generation status. {queueError.message}
            </Text>
          ) : job?.status !== "failed" ? (
            <Text size="sm" c="dimmed">
              Use Edit to review the prompt and settings.
            </Text>
          ) : null}
        </Stack>
        {queueError ? (
          <Group justify="flex-end">
            <Button size="sm" loading={queue.isFetching} onClick={() => void queue.refetch()}>
              Reload Status
            </Button>
          </Group>
        ) : job?.status === "failed" ? (
          <Group justify="flex-end">
            <QueueJobAction job={job} items={[item]} onRetried={onRetried} />
          </Group>
        ) : null}
      </Paper>
    );
  }

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
      <Text size="lg" fw={600} ta="center">
        {loading ? "Loading Generation Status" : job ? jobStatus(job) : statusLabels.cancelled}
      </Text>
      {reason && (
        <Text size="sm" c="dimmed" ta="center" style={{ overflowWrap: "anywhere" }}>
          {reason}
        </Text>
      )}
      {active && <JobProgressBar job={job} />}
      {active && job?.status === "writing" && <WritingStream progress={progress} />}
      {queueError && (
        <Alert color="red" title="Couldn't Load Generation Status">
          <Stack gap="sm">
            <Text size="sm">{queueError.message}</Text>
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
      )}
      {job && (
        <Group justify="center">
          <QueueJobAction job={job} items={[item]} onRetried={onRetried} />
        </Group>
      )}
    </Stack>
  );
}
