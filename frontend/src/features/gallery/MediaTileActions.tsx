import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import { useState } from "react";

import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { AnimateDialog } from "./AnimateDialog";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { MediaActionMenu } from "./MediaActions";
import { mediaTitle } from "./mediaLabels";
import { useMediaTransfer } from "./mediaShare";
import { ReportIssueDialog } from "./ReportIssueDialog";
import type { AnimateRequest } from "./useMediaAction";
import { useMediaRating } from "./useMediaRating";
import { TrimVideoDialog } from "./videoEdits";

import classes from "./MediaTileActions.module.css";

/** Like, Download and More over a gallery tile; the More menu doubles as its context menu. */
export function MediaTileActions({
  item,
  opened,
  onOpenedChange,
  onSelect,
  hideMore,
}: {
  item: MediaItem;
  opened: boolean;
  onOpenedChange: (value: boolean) => void;
  onSelect?: () => void;
  /** Hides More for a tile whose menu opens by holding; the hidden button still anchors it. */
  hideMore?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const [animating, setAnimating] = useState<AnimateRequest | null>(null);
  const [trimming, setTrimming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const rating = useMediaRating(item);
  const liked = item.rating === "liked";
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
          <Tooltip label={liked ? "Unlike" : "Like"}>
            <ActionIcon
              className={`${classes.control} ${classes.like}`}
              data-liked={liked || undefined}
              aria-label={`${liked ? "Unlike" : "Like"} ${name}`}
              aria-pressed={liked}
              variant="default"
              onClick={rating.like}
            >
              <icons.like size={16} fill={liked ? "currentColor" : "none"} />
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
              <icons.download size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        <Menu opened={opened} onChange={onOpenedChange} position="bottom-end" width={menuWidth}>
          <Menu.Target>
            <ActionIcon
              className={`${classes.control} ${classes.more}`}
              data-hidden={hideMore || undefined}
              aria-label={`More Actions for ${name}`}
              variant="default"
            >
              <icons.more size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {opened && (
              <MediaActionMenu
                item={item}
                transfer={transfer}
                onSelect={onSelect}
                onApplied={() => onOpenedChange(false)}
                onAnimate={setAnimating}
                onDelete={() => setDeleting(true)}
                onReport={() => setReporting(true)}
                onTrim={() => setTrimming(true)}
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
      {animating && <AnimateDialog item={item} {...animating} onClose={() => setAnimating(null)} />}
      {trimming && <TrimVideoDialog item={item} onClose={() => setTrimming(false)} />}
      {reporting && <ReportIssueDialog item={item} onClose={() => setReporting(false)} />}
    </>
  );
}
