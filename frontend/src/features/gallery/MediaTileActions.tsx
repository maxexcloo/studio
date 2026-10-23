import { useState } from "react";
import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import { Download, Ellipsis, ImagePlus, Pencil, Play, RotateCw, Star, Trash2 } from "lucide-react";
import type { MediaItem } from "../../types";
import { ReferenceMediaAction } from "./ReferenceMediaAction";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { mediaDownload } from "./download";
import { useShareWithoutSettings } from "./mediaShare";
import { useMediaAction } from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
import { useQueue, useQueueAction } from "../generation/Queue";
import classes from "./MediaTileActions.module.css";

function FailedTileRetry({ jobId }: { jobId: string }) {
  const queue = useQueue();
  const retry = useQueueAction(jobId);
  const job = queue.data?.jobs.find((job) => job.id === jobId);
  if (queue.error)
    return <Menu.Item onClick={() => void queue.refetch()}>Reload Generation Status</Menu.Item>;
  if (!job)
    return queue.isPending ? <Menu.Item disabled>Loading Generation Status</Menu.Item> : null;
  return job.status === "failed" ? (
    <Menu.Item
      leftSection={<RotateCw size={16} />}
      disabled={retry.isPending}
      closeMenuOnClick={false}
      onClick={() => retry.mutate({ id: job.id, action: "retry" })}
    >
      Retry
    </Menu.Item>
  ) : null;
}

export function MediaTileActions({
  item,
  opened,
  onOpenedChange,
}: {
  item: MediaItem;
  opened: boolean;
  onOpenedChange: (value: boolean) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [withoutSettings] = useShareWithoutSettings();
  const action = useMediaAction(item);
  const favorite = useMediaFavorite(item);
  const name = item.prompt || item.filename || "Result";
  const ready = item.status === "done" && Boolean(item.url);
  return (
    <>
      <Group
        className={classes.actions}
        data-opened={opened || undefined}
        gap={4}
        justify="flex-end"
        wrap="nowrap"
        role="group"
        aria-label={`Actions for ${name}`}
      >
        <Tooltip label={item.favorite ? "Unstar" : "Star"}>
          <ActionIcon
            className={`${classes.control} ${classes.favorite}`}
            data-starred={item.favorite || undefined}
            aria-label={`${item.favorite ? "Unstar" : "Star"} ${name}`}
            aria-pressed={Boolean(item.favorite)}
            variant="default"
            size="lg"
            radius="xl"
            loading={favorite.isPending}
            onClick={() => favorite.mutate()}
          >
            <Star size={16} fill={item.favorite ? "currentColor" : "none"} />
          </ActionIcon>
        </Tooltip>
        <Menu opened={opened} onChange={onOpenedChange} position="bottom-end" width={210}>
          <Menu.Target>
            <ActionIcon
              className={classes.control}
              aria-label={`More Actions for ${name}`}
              variant="default"
              size="lg"
              radius="xl"
            >
              <Ellipsis size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {opened && item.status === "error" && item.jobId && (
              <FailedTileRetry jobId={item.jobId} />
            )}
            {ready && (
              <>
                <Menu.Item
                  leftSection={<Pencil size={16} />}
                  disabled={action.isPending}
                  onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
                >
                  {item.type === "video" ? "Extend" : "Refine"}
                </Menu.Item>
                {item.type === "image" && (
                  <Menu.Item
                    leftSection={<Play size={16} />}
                    disabled={action.isPending}
                    onClick={() => action.mutate("animate")}
                  >
                    Animate
                  </Menu.Item>
                )}
              </>
            )}
            {opened && <ReferenceMediaAction item={item} onApplied={() => onOpenedChange(false)} />}
            <Menu.Item
              leftSection={<ImagePlus size={16} />}
              disabled={action.isPending}
              onClick={() => action.mutate("image")}
            >
              Recreate
            </Menu.Item>
            {ready && (
              <Menu.Item
                component="a"
                {...mediaDownload(item, withoutSettings)}
                leftSection={<Download size={16} />}
              >
                Download
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={<Star size={16} fill={item.favorite ? "currentColor" : "none"} />}
              disabled={favorite.isPending}
              onClick={() => favorite.mutate()}
            >
              {item.favorite ? "Unstar" : "Star"}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<Trash2 size={16} />}
              onClick={() => setDeleting(true)}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <DeleteMediaDialog
        opened={deleting}
        ids={[item.id]}
        close={() => setDeleting(false)}
        onDeleted={() => {}}
      />
    </>
  );
}
