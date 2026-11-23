import { ActionIcon, Group, Paper, Text, Tooltip } from "@mantine/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaProfileName, mediaTimestamp, mediaTitle } from "./mediaLabels";
import { mediaSource } from "./mediaSource";

import classes from "./MediaViewer.module.css";

/** `title`, when given, is the heading above: a model it already names isn't repeated. */
export function ViewerMetadata({
  item,
  compact,
  title,
}: {
  item: MediaItem;
  compact?: boolean;
  title?: string;
}) {
  const { profiles } = useGenerationActions();
  const named = mediaProfileName(item, profiles);
  const model = title?.includes(named) ? "" : named;
  const { width, height } = mediaSource(item);
  const timestamp = compact && !title ? undefined : mediaTimestamp(item);
  const settings = item.settings || {};
  const steps = Number(settings.steps);
  const stepLabel = steps > 0 && !/\b\d+\s+steps?\b/i.test(title ?? model) ? `${steps} Steps` : "";
  const seconds = Number(settings.duration) || Number(settings.frames) / Number(settings.fps);
  const sizeAndDuration = [
    width && height ? `${width} × ${height}` : "",
    item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10}s` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const hasModel = Boolean(model || stepLabel);
  const hasFacts = Boolean(timestamp || sizeAndDuration);
  const summary = (
    <>
      {model && <span>{model}</span>}
      {model && stepLabel && " · "}
      {stepLabel}
    </>
  );
  const facts = (
    <>
      {timestamp && <time dateTime={timestamp.value}>{timestamp.label}</time>}
      {timestamp && sizeAndDuration && " · "}
      {sizeAndDuration}
    </>
  );
  if (compact)
    return (
      (hasModel || hasFacts) && (
        <Text
          size="xs"
          lh={1.25}
          truncate
          title={[model, stepLabel, timestamp?.label, sizeAndDuration].filter(Boolean).join(" · ")}
        >
          {summary}
          {hasModel && hasFacts && " · "}
          {facts}
        </Text>
      )
    );
  return (
    <>
      {hasModel && (
        <Text
          size="xs"
          lh={1.25}
          lineClamp={2}
          title={[model, stepLabel].filter(Boolean).join(" · ")}
        >
          {summary}
        </Text>
      )}
      {hasFacts && (
        <Text size="xs" c="dimmed" lh={1.25}>
          {facts}
        </Text>
      )}
    </>
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
  const title = item && mediaTitle(item);
  const timestamp = item && mediaTimestamp(item);
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
        {item && (
          <Paper withBorder radius="md" px="sm" py={4} miw={0}>
            <Text
              size="sm"
              fw={500}
              truncate
              title={[title, timestamp?.label].filter(Boolean).join(" · ")}
            >
              <span>{title}</span>
              {timestamp && (
                <>
                  {" · "}
                  <Text component="time" dateTime={timestamp.value} size="xs" c="dimmed">
                    {timestamp.label}
                  </Text>
                </>
              )}
            </Text>
            <ViewerMetadata item={item} compact />
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
