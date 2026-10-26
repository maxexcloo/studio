import type { ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";
import classes from "./SettingRows.module.css";

/** A titled run of setting rows, divided like the rest of Settings. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={4} component="section" aria-label={title}>
      <Text size="sm" fw={600} c="dimmed">
        {title}
      </Text>
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
