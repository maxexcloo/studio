import { Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { usePhone } from "./usePhone";

import classes from "./SettingRows.module.css";

/**
 * A titled run of setting rows, divided like the rest of Settings. `danger` titles a section's last
 * group, Danger Zone, whose actions always confirm first. A group holding a list puts its
 * `toolbar` (`SectionToolbar`) beside the title, wrapping below it when narrow. A `fill` group takes
 * its column's remaining height, its content filling the room under the title.
 */
export function SettingGroup({
  title,
  description,
  danger = false,
  fill = false,
  toolbar,
  children,
}: {
  title: string;
  description?: string;
  danger?: boolean;
  fill?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <Stack gap={2}>
      <Text component="h4" size="sm" fw={600} c={danger ? "red" : "dimmed"}>
        {title}
      </Text>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
    </Stack>
  );
  return (
    <Stack
      gap={4}
      component="section"
      aria-label={title}
      flex={fill ? 1 : undefined}
      mih={fill ? 0 : undefined}
    >
      {toolbar ? (
        <Group gap="xs" justify="space-between">
          {heading}
          <div className={classes.toolbar}>{toolbar}</div>
        </Group>
      ) : (
        heading
      )}
      <div className={fill ? classes.fill : undefined}>{children}</div>
    </Stack>
  );
}

/**
 * One setting: its label and description, then its control or value, which wraps below on phones.
 * A `wide` row's control (a Select, or a full-width segmented choice, which every segmented row
 * uses) has one width on desktop and the full row on phones, so such rows line up. On phones any
 * row with a picker gives it and its buttons one full-width row: the picker fills it, the buttons
 * keep their width at its end.
 */
export function SettingRow({
  label,
  description,
  wide = false,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}) {
  const phone = usePhone();
  return (
    <Group className={classes.row} justify="space-between" gap="xs" py="sm">
      <Stack gap={2} miw={0} flex="1 1 14rem">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {children && (
        <Group
          className={`${classes.controls} ${wide ? classes.wide : ""}`}
          gap="xs"
          wrap="nowrap"
          w={wide ? (phone ? "100%" : 280) : undefined}
        >
          {children}
        </Group>
      )}
    </Group>
  );
}
