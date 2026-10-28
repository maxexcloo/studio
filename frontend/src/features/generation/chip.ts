import type { KeyboardEvent } from "react";
import classes from "./GenerationInputControls.module.css";

/** Shared Button props for the compact chips in the generation rail. */
export const chipProps = {
  variant: "default",
  size: "sm",
  radius: "xl",
  className: classes.chip,
  classNames: { section: classes.chipSection },
} as const;

/** A chip that shows only its icon; callers give it an accessible name and a tooltip. */
export const iconChipProps = {
  ...chipProps,
  className: `${classes.chip} ${classes.iconChip}`,
} as const;

/** Nested pickers, menus, open comboboxes and keyboard drags inside a panel handle their own Escape. */
const nestedLayers =
  '.mantine-Popover-dropdown, [role="menu"], [role="dialog"], [aria-haspopup][aria-expanded="true"]';

/** A chip panel's Escape: closes the panel only when no nested layer took the key. */
export function escapePanel(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const layer = (event.target as Element).closest(nestedLayers);
  if (layer && !layer.hasAttribute("data-chip-popup")) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}
