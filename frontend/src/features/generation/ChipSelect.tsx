import type { ReactNode } from "react";
import {
  Button,
  ColorSwatch,
  ComboboxPopover,
  Group,
  Stack,
  Text,
  type ComboboxPopoverProps,
} from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { chipProps } from "./chip";
import classes from "./GenerationInputControls.module.css";

/**
 * A rail chip that opens its option list: the composer's Profile and Chat's text model. `swatch`
 * is a readiness colour beside the name; `target` adds attributes to the chip itself.
 */
export function ChipSelect({
  name,
  label,
  swatch,
  badge,
  title,
  target,
  ...props
}: Omit<ComboboxPopoverProps, "children"> & {
  name: string;
  label: ReactNode;
  swatch?: string;
  badge?: ReactNode;
  title?: string;
  target?: Record<string, unknown>;
}) {
  return (
    <ComboboxPopover
      allowDeselect={false}
      withCheckIcon={false}
      maxDropdownHeight={320}
      comboboxProps={{
        width: "min(440px, 100vw - 32px)",
        position: "top-start",
        withinPortal: true,
      }}
      {...props}
    >
      <ComboboxPopover.Target>
        <Button
          aria-label={name}
          {...chipProps}
          {...target}
          leftSection={
            swatch && (
              <ColorSwatch
                component="span"
                size={8}
                withShadow={false}
                color={`var(--mantine-color-${swatch}-6)`}
                aria-hidden
              />
            )
          }
          rightSection={<ChevronDown size={14} />}
          title={title}
        >
          <span className={classes.label}>{label}</span>
          {badge}
        </Button>
      </ComboboxPopover.Target>
    </ComboboxPopover>
  );
}

/** One ChipSelect option: its name and description, with badges at the trailing edge. */
export function ChipOption({
  label,
  description,
  checked,
  badges,
}: {
  label: string;
  description?: string;
  checked?: boolean;
  badges?: ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" w="100%">
      <Stack gap={0} miw={0}>
        <Text size="sm" fw={checked ? 600 : 500} truncate title={label}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed" truncate title={description}>
            {description}
          </Text>
        )}
      </Stack>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {badges}
      </Group>
    </Group>
  );
}
