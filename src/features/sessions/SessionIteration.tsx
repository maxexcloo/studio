import { Alert, Badge, Button, Group, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, failure } from "../../api";
import type { MediaItem, QueueJob } from "../../types";
import { useMediaAction } from "../gallery/useMediaAction";
import { terminal } from "../generation/Queue";
import { GenerationCard } from "./GenerationCard";
function SessionResult({
  item,
  sessionId,
  open,
}: {
  item: MediaItem;
  sessionId: string;
  open: (item: MediaItem) => void;
}) {
  const action = useMediaAction(item, sessionId);
  return (
    <Stack gap="sm" className="studio-thread-result">
      <button
        className="studio-thread-media"
        aria-label={`Open ${item.type}: ${item.prompt || "Result"}`}
        onClick={() => open(item)}
      >
        {item.type === "video" ? (
          <video
            src={item.url}
            poster={item.thumbnailUrl}
            preload="none"
            muted
            playsInline
            aria-label={item.prompt || "Generated Video"}
          />
        ) : (
          <img
            src={item.url}
            width={item.width || 1024}
            height={item.height || 1024}
            alt={item.prompt || "Generated Image"}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
      </button>
      <Group gap="xs">
        <Button
          variant="default"
          radius="xl"
          size="sm"
          loading={action.isPending}
          onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
        >
          {item.type === "video" ? "Extend" : "Refine"}
        </Button>
        {item.type === "image" && (
          <Button
            variant="default"
            radius="xl"
            size="sm"
            loading={action.isPending}
            onClick={() => action.mutate("animate")}
          >
            Animate
          </Button>
        )}
        <Button
          component="a"
          href={`/api/gallery/export?ids=${encodeURIComponent(item.id)}`}
          variant="subtle"
          color="gray"
          size="sm"
        >
          Download
        </Button>
        <Button variant="subtle" color="gray" size="sm" onClick={() => open(item)}>
          Details
        </Button>
      </Group>
    </Stack>
  );
}
export function SessionIteration({
  job,
  index,
  open,
  parentIndex,
}: {
  job: QueueJob;
  index: number;
  open: (item: MediaItem) => void;
  parentIndex: number;
}) {
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: (action: string) => api(`/api/queue/${job.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["session", job.sessionId] });
    },
    onError: failure,
  });
  const items = (job.items?.length ? job.items : job.outputs || []).filter(
    (item) => item.status === "done" || item.url,
  );
  return (
    <article className="studio-thread-iteration" aria-label={`Iteration ${index + 1}`}>
      <div>
        <Text size="xs" c="dimmed" mb={6}>
          {job.operation === "refine"
            ? "Refine"
            : job.operation === "animate"
              ? "Animate"
              : job.operation === "upscale"
                ? "Upscale"
                : "Image"}
          {parentIndex >= 0 ? ` · from iteration ${parentIndex + 1}` : ""}
        </Text>
        <GenerationCard job={job} />
      </div>
      <Stack gap="md">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Studio
          </Text>
          <Text size="xs" c="dimmed">
            {String(job.input.profileName || job.input.profileId || "")}
          </Text>
          <Badge
            size="xs"
            variant="light"
            color={job.status === "failed" ? "red" : job.status === "completed" ? "green" : "gray"}
          >
            {job.status}
          </Badge>
        </Group>
        {items.map((item) => (
          <SessionResult key={item.id} item={item} sessionId={job.sessionId} open={open} />
        ))}
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
        {!terminal.has(job.status) && (
          <Button
            variant="subtle"
            color="red"
            size="compact-sm"
            style={{ alignSelf: "start" }}
            loading={action.isPending}
            onClick={() => action.mutate("cancel")}
          >
            Cancel
          </Button>
        )}
        {job.status === "failed" && (
          <Button
            variant="default"
            size="sm"
            style={{ alignSelf: "start" }}
            onClick={() => action.mutate("retry")}
          >
            Retry
          </Button>
        )}
        {!!action.error && (
          <Alert color="red">
            {action.error instanceof Error ? action.error.message : String(action.error)}
          </Alert>
        )}
      </Stack>
    </article>
  );
}
