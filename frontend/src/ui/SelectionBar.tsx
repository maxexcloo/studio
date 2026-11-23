import { Checkbox, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * A Library list's selection, under its toolbar while Select is on: Select All over the matching
 * records (`all`, where the list has no header checkbox of its own), the count, then the bulk
 * actions, Delete last.
 */
export function SelectionBar({
  label,
  count,
  busy = false,
  all,
  children,
}: {
  label: string;
  count: number;
  busy?: boolean;
  all?: {
    checked: boolean;
    indeterminate: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
  };
  children: ReactNode;
}) {
  return (
    <Group gap="xs" justify="space-between" role="group" aria-label={label} aria-busy={busy}>
      <Group gap="xs">
        {all && (
          <Checkbox
            label="Select All"
            checked={all.checked}
            indeterminate={all.indeterminate}
            disabled={all.disabled || busy}
            onChange={(event) => all.onChange(event.currentTarget.checked)}
          />
        )}
        <Text size="sm" c="dimmed" aria-live="polite">
          {count} selected
        </Text>
      </Group>
      <Group gap="xs">{children}</Group>
    </Group>
  );
}
