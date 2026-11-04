import type { ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";
import classes from "./SettingRows.module.css";

/**
 * A titled run of setting rows, divided like the rest of Settings. `danger` titles a section's last
 * group, Danger Zone, whose actions always confirm first. A group holding a list puts its
 * `toolbar` (`SectionToolbar`) beside the title, wrapping below it when narrow.
 */
export function SettingGroup({
  title,
  danger = false,
  toolbar,
  children,
}: {
  title: string;
  danger?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <Text size="sm" fw={600} c={danger ? "red" : "dimmed"}>
      {title}
    </Text>
  );
  return (
    <Stack gap={4} component="section" aria-label={title}>
      {toolbar ? (
        <Group gap="xs" justify="space-between">
          {heading}
          <div className={classes.toolbar}>{toolbar}</div>
        </Group>
      ) : (
        heading
      )}
      <div>{children}</div>
    </Stack>
  );
}

/** One setting: its label and description, then its control or value, which wraps below on phones. */
export function SettingRow({
  label,
  description,
  wide = false,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** Inputs such as Selects take the full row on phones. */
  wide?: boolean;
  children?: ReactNode;
}) {
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
        <Group gap="xs" wrap="nowrap" w={wide ? { base: "100%", sm: "auto" } : undefined}>
          {children}
        </Group>
      )}
    </Group>
  );
}
