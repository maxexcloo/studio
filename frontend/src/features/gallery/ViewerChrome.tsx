import { ActionIcon, Group, Paper, Text, type TextProps, Tooltip } from "@mantine/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { comparisonVariant, mediaTimestamp, mediaTitle, modelSummary } from "./mediaLabels";
import { mediaSource } from "./mediaSource";

import classes from "./MediaViewer.module.css";

/**
 * Its model and steps, then its size and length, under its title in the viewer header and
 * Details; `full` wraps rather than truncating.
 */
export function ViewerMetadata({ item, full }: { item: MediaItem; full?: boolean }) {
  const { profiles } = useGenerationActions();
  const summary = modelSummary(item, profiles);
  const { width, height } = mediaSource(item);
  const settings = item.settings || {};
  const seconds = Number(settings.duration) || Number(settings.frames) / Number(settings.fps);
  const line = [
    comparisonVariant(item),
    summary,
    width && height ? `${width} × ${height}` : "",
    item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10}s` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    line && (
      <Text size="xs" lh={1.25} truncate={!full} title={full ? undefined : line}>
        {line}
      </Text>
    )
  );
}

/** An item's title with when it was made beside it, as the viewer header and Details show it. */
export function ViewerTitle({
  item,
  title = mediaTitle(item),
  ...props
}: TextProps & { item: MediaItem; title?: string; component?: "h2" }) {
  const timestamp = mediaTimestamp(item);
  return (
    <Text {...props} title={[title, timestamp?.label].filter(Boolean).join(" · ")}>
      <span>{title}</span>
      {timestamp && (
        <>
          {" · "}
          <Text component="time" dateTime={timestamp.value} inherit fw={400} c="dimmed">
            {timestamp.label}
          </Text>
        </>
      )}
    </Text>
  );
}

export function ViewerChrome({
  item,
  label,
  actions,
  hidden,
  close,
  closeLabel,
  details,
  focusClose,
}: {
  item?: MediaItem;
  label?: ReactNode;
  actions?: ReactNode;
  hidden?: boolean;
  close: () => void;
  closeLabel: string;
  details?: { opened: boolean; phone: boolean; toggle: () => void };
  focusClose?: boolean;
}) {
  if (hidden) return null;
  return (
    <Group
      className={classes.topBar}
      data-chrome
      role="group"
      aria-label="Viewer Header"
      justify="space-between"
      align="flex-start"
      wrap="nowrap"
      onClick={(event) => event.stopPropagation()}
    >
      <Group gap={6} wrap="nowrap" miw={0}>
        {/* Docked Details carries the title itself. */}
        {item && !(details?.opened && !details.phone) && (
          <Paper withBorder radius="md" px="sm" py={4} miw={0}>
            <ViewerTitle item={item} size="sm" fw={500} truncate />
            <ViewerMetadata item={item} />
          </Paper>
        )}
        {label}
      </Group>
      <Group gap={6} wrap="nowrap" className={classes.topActions}>
        {actions}
        {details && (
          <Tooltip
            label={details.phone ? "Details" : details.opened ? "Hide Details" : "Show Details"}
          >
            <ActionIcon
              data-autofocus={!focusClose || undefined}
              variant="default"
              aria-label="Generation Details"
              aria-expanded={details.opened}
              onClick={details.toggle}
            >
              <icons.details size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Close (Esc)">
          <ActionIcon
            data-autofocus={focusClose || !details || undefined}
            variant="default"
            aria-label={closeLabel}
            onClick={close}
          >
            <X size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
