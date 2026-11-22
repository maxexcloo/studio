import { Progress } from "@mantine/core";

import { type QueueStatus, activeStatuses, pendingStatuses } from "../../../../shared/queue";
import { titleCase } from "../../../../shared/titles";
import type { QueueJob } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";

type JobState = {
  status: QueueStatus;
  operation?: QueueJob["operation"];
  progress?: QueueJob["progress"];
  queuePosition?: number;
  backend?: QueueJob["backend"];
  cancelling?: boolean;
  reason?: string;
};

export const statusLabels: Record<QueueStatus, string> = {
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

function durationLeft(ms: number) {
  const seconds = Math.ceil(ms / 5000) * 5;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return [minutes && `${minutes}m`, rest && `${rest}s`].filter(Boolean).join(" ");
}

function percentage({ progress, status, cancelling }: JobState) {
  if (status === "saving" || cancelling || !progress?.max) return undefined;
  return Math.max(0, Math.min(100, Math.round(((progress.value ?? 0) / progress.max) * 100)));
}

export function jobStatus(job: JobState, queueLabel?: { model?: string }) {
  const { progress, queuePosition, status } = job;
  const base =
    (job.cancelling && "Stopping") ||
    (job.operation === "upscale" && status === "running" && "Upscaling") ||
    (queueLabel && status === "waiting" && "Waiting") ||
    statusLabels[status];
  const heading = queueLabel?.model ? `${base} – ${queueLabel.model}` : base;
  if (pendingStatuses.has(status) && queuePosition !== undefined) {
    const resource = status === "writing" ? "Prompt" : titleCase(job.backend || "Worker");
    return `${heading} · #${queuePosition} in ${resource} Queue`;
  }
  if (!activeStatuses.has(status)) return heading;
  const phase = job.cancelling || status === "saving" ? "" : titleCase(progress?.phase || "");
  const value = progress?.value ?? 0;
  const max = progress?.max ?? 0;
  const steps =
    !job.cancelling && status !== "saving" && progress?.steps && max > 0
      ? `${progress.estimated ? "About Step" : "Step"} ${Math.min(max, Math.max(1, Math.ceil(value)))} of ${max}`
      : "";
  const remaining = progress?.endsAt === undefined ? progress?.etaMs : progress.endsAt - Date.now();
  const eta =
    !job.cancelling && status !== "saving" && remaining && remaining > 0
      ? `About ${durationLeft(remaining)} Left`
      : "";
  const percent = percentage(job);
  return [
    queueLabel ? heading : phase || base,
    queueLabel && phase !== base && phase,
    steps || (percent !== undefined && `${percent}%`),
    eta,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function jobReason(job: JobState) {
  return (
    job.reason ||
    (job.cancelling
      ? "Waiting for the provider to confirm."
      : ["queued", "waiting"].includes(job.status)
        ? "Waiting to start."
        : "")
  );
}

export function JobProgressBar({ job, className }: { job: JobState; className?: string }) {
  const motionDuration = useMotionDuration();
  if (!activeStatuses.has(job.status)) return null;
  const percent = percentage(job);
  return (
    <Progress.Root
      className={className}
      role="progressbar"
      aria-label="Generation Progress"
      aria-valuenow={percent}
      aria-valuetext={jobStatus(job)}
      size="xs"
      w="100%"
      transitionDuration={motionDuration}
    >
      <Progress.Section value={percent ?? 100} striped={percent === undefined} withAria={false} />
    </Progress.Root>
  );
}
