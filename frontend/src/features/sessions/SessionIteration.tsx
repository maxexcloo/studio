import { ActionIcon, Badge, Button, Group, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { Download, Info } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import { useMediaAction } from "../gallery/useMediaAction";
import { QueueJobAction, terminal } from "../generation/Queue";
import { GenerationCard } from "./GenerationCard";
import { mediaDownload } from "../gallery/download";
import { useShareWithoutSettings } from "../gallery/mediaShare";
import { mediaSource } from "../gallery/mediaSource";
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
  const [withoutSettings] = useShareWithoutSettings();
  const source = mediaSource(item);
  return (
    <Stack gap="sm" className="studio-thread-result">
      <button
        className="studio-thread-media"
        aria-label={`Open ${item.type}: ${item.prompt || "Result"}`}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          open(item);
        }}
      >
        {item.type === "video" ? (
          <video
            src={source.url}
            width={source.width || 1024}
            height={source.height || 1024}
            poster={source.thumbnailUrl}
            preload="none"
            muted
            playsInline
            aria-label={item.prompt || "Generated Video"}
          />
        ) : (
          <img
            src={source.url}
            width={source.width || 1024}
            height={source.height || 1024}
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
        <Tooltip label="Download">
          <ActionIcon
            component="a"
            aria-label="Download"
            {...mediaDownload(item, withoutSettings)}
            variant="subtle"
            color="gray"
            size={36}
          >
            <Download size={17} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Generation Details">
          <ActionIcon
            aria-label="Details"
            variant="subtle"
            color="gray"
            size={36}
            onClick={() => open(item)}
          >
            <Info size={17} />
          </ActionIcon>
        </Tooltip>
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
        {job.status !== "completed" && (
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Studio
            </Text>
            <Text size="xs" c="dimmed">
              {String(job.input.profileName || job.input.profileId || "")}
            </Text>
            <Badge size="xs" variant="light" color={job.status === "failed" ? "red" : "gray"}>
              {job.status}
            </Badge>
          </Group>
        )}
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
        <QueueJobAction job={job} />
      </Stack>
    </article>
  );
}
