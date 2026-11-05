import type { KeyboardEvent, PointerEvent } from "react";
import { popupMiddlewares } from "../../theme";
import classes from "./GenerationInputControls.module.css";

/** Shared Button props for the compact chips in the generation rail. */
export const chipProps = {
  variant: "default",
  size: "sm",
  radius: "xl",
  className: classes.chip,
  classNames: { section: classes.chipSection },
  // A tapped combobox chip is focused by Mantine without preventScroll, which jumps an iOS page;
  // focusing it first without scrolling makes that call a no-op.
  onPointerDown: (event: PointerEvent<HTMLElement>) =>
    event.currentTarget.focus({ preventScroll: true }),
} as const;

/** A chip that shows only its icon; callers give it an accessible name and a tooltip. */
export const iconChipProps = {
  ...chipProps,
  className: `${classes.chip} ${classes.iconChip}`,
} as const;

/** A phone chip's floating popup fits the screen and scrolls inside when it is taller. */
export const fittedPopup = {
  middlewares: { ...popupMiddlewares, size: { padding: 12 } },
  classNames: { dropdown: classes.fitted },
};

/** Nested pickers, menus, open comboboxes and keyboard drags inside a panel handle their own Escape. */
const nestedLayers =
  '.mantine-Popover-dropdown, [role="menu"], [role="dialog"], [aria-haspopup][aria-expanded="true"]';

/**
 * A chip panel's Escape: closes the panel only when no nested layer, such as a chip popup opened
 * inside it (the picker's Filters), took the key.
 */
export function escapePanel(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const layer = (event.target as Element).closest(nestedLayers);
  if (layer && layer !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}
