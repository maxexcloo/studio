import { ActionIcon, Group, Paper, Text, Tooltip } from "@mantine/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaProfileName, mediaTimestamp, mediaTitle } from "./mediaLabels";

import classes from "./MediaViewer.module.css";

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
  const { profiles } = useGenerationActions();
  if (hidden) return null;
  const title = item && mediaTitle(item);
  const model = item && mediaProfileName(item, profiles);
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
        {title && (
          <Paper withBorder radius="md" px="sm" py={4} miw={0}>
            <Text size="sm" fw={500} truncate title={title}>
              {title}
            </Text>
            {(model || timestamp) && (
              <Group gap={6} wrap="nowrap">
                {model && (
                  <Text size="xs" truncate title={model} miw={0}>
                    {model}
                  </Text>
                )}
                {model && timestamp && (
                  <Text size="xs" c="dimmed" aria-hidden>
                    ·
                  </Text>
                )}
                {timestamp && (
                  <Text
                    component="time"
                    size="xs"
                    dateTime={timestamp.value}
                    style={{ flexShrink: 0 }}
                  >
                    {timestamp.label}
                  </Text>
                )}
              </Group>
            )}
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
