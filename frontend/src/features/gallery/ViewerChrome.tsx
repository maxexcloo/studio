import { ActionIcon, Badge, Group, Tooltip } from "@mantine/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { glass } from "../../theme";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaProfileName } from "./mediaLabels";

import classes from "./MediaViewer.module.css";

export const viewerBadge = {
  variant: "default",
  size: "lg",
  radius: "xl",
  style: glass,
  fw: 500,
  miw: 0,
} as const;

export function ViewerChrome({
  item,
  label,
  end,
  close,
  closeLabel,
  details,
  focusClose,
}: {
  item?: MediaItem;
  label?: ReactNode;
  end?: ReactNode;
  close: () => void;
  closeLabel: string;
  details?: { opened: boolean; phone: boolean; toggle: () => void };
  focusClose?: boolean;
}) {
  const { profiles } = useGenerationActions();
  const model = item && mediaProfileName(item, profiles);
  return (
    <Group
      className={classes.topBar}
      data-chrome
      role="group"
      aria-label="Viewer Header"
      justify="space-between"
      wrap="nowrap"
      onClick={(event) => event.stopPropagation()}
    >
      <Group gap={6} wrap="nowrap" miw={0}>
        {label}
        {model && (
          <Badge {...viewerBadge} className={classes.modelBadge} title={model}>
            {model}
          </Badge>
        )}
      </Group>
      <Group gap={6} wrap="nowrap" className={classes.topActions}>
        {end}
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
