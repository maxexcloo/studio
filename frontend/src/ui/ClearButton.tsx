import { ActionIcon, Tooltip } from "@mantine/core";

import { icons } from "./icons";

/**
 * Clear as a ✕ icon just before a form's or popup's primary action; with `onUndo` it is Undo,
 * bringing back what Clear removed.
 */
export function ClearButton({
  disabled,
  onClear,
  onUndo,
}: {
  disabled?: boolean;
  onClear: () => void;
  onUndo?: () => void;
}) {
  const label = onUndo ? "Undo" : "Clear";
  const Icon = onUndo ? icons.undo : icons.clear;
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={label}
        disabled={disabled}
        onClick={onUndo ?? onClear}
      >
        <Icon size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
