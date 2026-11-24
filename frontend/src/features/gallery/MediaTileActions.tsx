import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import { useState } from "react";

import { menuWidth } from "../../theme";
import type { MediaItem } from "../../types";
import { useActionMenuBounds } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { ratingLabel } from "./itemActions";
import { MediaActionMenu, useMediaDialogs } from "./MediaActions";
import { mediaTitle } from "./mediaLabels";
import { useMediaTransfer } from "./mediaShare";
import type { useRate } from "./useMediaRating";

import classes from "./MediaTileActions.module.css";

/** Quick ratings and a context menu over a gallery tile. */
export function MediaTileActions({
  item,
  opened,
  onOpenedChange,
  onSelect,
  rate,
  hideMore,
}: {
  item: MediaItem;
  opened: boolean;
  onOpenedChange: (value: boolean) => void;
  onSelect?: () => void;
  /** The gallery's one rating mutation, shared by its tiles. */
  rate: ReturnType<typeof useRate>;
  /** Hides More for a tile whose menu opens by holding; the hidden button still anchors it. */
  hideMore?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  // Delete's dialog mounts once the menu offering it opens, so tiles carry no closed dialogs.
  const [menuUsed, setMenuUsed] = useState(opened);
  if (opened && !menuUsed) setMenuUsed(true);
  const menuBounds = useActionMenuBounds(opened);
  const { handlers, dialogs } = useMediaDialogs(item);
  const transfer = useMediaTransfer(item, opened);
  const name = mediaTitle(item);
  return (
    <>
      <Group
        className={classes.actions}
        data-opened={opened || undefined}
        gap={4}
        justify="flex-end"
        align="flex-start"
        wrap="nowrap"
        role="group"
        aria-label={`Actions for ${name}`}
      >
        {item.status === "done" && (
          <Group className={classes.ratings} data-tile-ratings gap={4} wrap="nowrap">
            {(["like", "dislike"] as const).map((id) => {
              const rating = id === "like" ? "liked" : "disliked";
              const pressed = item.rating === rating;
              const Icon = icons[id];
              const label = ratingLabel(id);
              return (
                <Tooltip key={id} label={label}>
                  <ActionIcon
                    className={classes.control}
                    aria-label={`${label} ${name}`}
                    aria-pressed={pressed}
                    variant="default"
                    size={28}
                    data-touch-target
                    onClick={() => rate(item, rating)}
                  >
                    <Icon size={16} fill={pressed ? "currentColor" : "none"} />
                  </ActionIcon>
                </Tooltip>
              );
            })}
          </Group>
        )}
        <Menu
          {...menuBounds}
          opened={opened}
          onChange={onOpenedChange}
          position="bottom-end"
          width={menuWidth}
        >
          <PopupTooltip label="Actions">
            <Menu.Target>
              <ActionIcon
                className={`${classes.control} ${classes.more}`}
                data-hidden={hideMore || undefined}
                aria-label={`Actions for ${name}`}
                variant="default"
                size={28}
              >
                <icons.more size={16} />
              </ActionIcon>
            </Menu.Target>
          </PopupTooltip>
          <Menu.Dropdown>
            <MediaActionMenu
              item={item}
              transfer={transfer}
              onSelect={onSelect}
              onApplied={() => onOpenedChange(false)}
              onDelete={() => setDeleting(true)}
              {...handlers}
            />
          </Menu.Dropdown>
        </Menu>
      </Group>
      {menuUsed && (
        <DeleteMediaDialog
          opened={deleting}
          ids={[item.id]}
          close={() => setDeleting(false)}
          onDeleted={() => {}}
        />
      )}
      {dialogs}
    </>
  );
}
