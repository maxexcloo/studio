import { useState } from "react";
import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import { Download, Ellipsis, Star } from "lucide-react";
import type { MediaItem } from "../../types";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { MediaActionItems, type PrimaryAction } from "./MediaActions";
import { useMediaTransfer } from "./mediaShare";
import { useMediaFavorite } from "./useMediaFavorite";
import { mediaTitle } from "./mediaLabels";
import { UpscaleDialog } from "./UpscaleControls";
import classes from "./MediaTileActions.module.css";

/** Star, Download and More over a gallery tile or Chat result; the More menu doubles as its context menu. */
export function MediaTileActions({
  item,
  opened,
  onOpenedChange,
  sessionId,
  omit,
  onSelect,
}: {
  item: MediaItem;
  opened: boolean;
  onOpenedChange: (value: boolean) => void;
  sessionId?: string;
  omit?: PrimaryAction[];
  onSelect?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const favorite = useMediaFavorite(item);
  const transfer = useMediaTransfer(item, opened);
  const name = mediaTitle(item);
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
        {item.status === "done" && (
          <Tooltip label={item.favorite ? "Unstar" : "Star"}>
            <ActionIcon
              className={`${classes.control} ${classes.favorite}`}
              data-starred={item.favorite || undefined}
              aria-label={`${item.favorite ? "Unstar" : "Star"} ${name}`}
              aria-pressed={Boolean(item.favorite)}
              variant="default"
              loading={favorite.isPending}
              onClick={() => favorite.mutate()}
            >
              <Star size={16} fill={item.favorite ? "currentColor" : "none"} />
            </ActionIcon>
          </Tooltip>
        )}
        {item.status === "done" && item.url && (
          <Tooltip label="Download">
            <ActionIcon
              component="a"
              {...transfer.download}
              className={`${classes.control} ${classes.download}`}
              aria-label={`Download ${name}`}
              variant="default"
            >
              <Download size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        <Menu opened={opened} onChange={onOpenedChange} position="bottom-end" width={210}>
          <Menu.Target>
            <ActionIcon
              className={`${classes.control} ${classes.more}`}
              aria-label={`More Actions for ${name}`}
              variant="default"
            >
              <Ellipsis size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {opened && (
              <MediaActionItems
                item={item}
                transfer={transfer}
                sessionId={sessionId}
                omit={omit}
                onApplied={() => onOpenedChange(false)}
                onDelete={() => setDeleting(true)}
                onSelect={onSelect}
                onUpscale={() => setUpscaling(true)}
              />
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      <DeleteMediaDialog
        opened={deleting}
        ids={[item.id]}
        close={() => setDeleting(false)}
        onDeleted={() => {}}
      />
      {item.status === "done" && (
        <UpscaleDialog item={item} opened={upscaling} onClose={() => setUpscaling(false)} />
      )}
    </>
  );
}
