import type { PointerEvent } from "react";

import classes from "./GenerationInputControls.module.css";

/** Shared Button props for the compact chips in the generation rail. */
export const chipProps = {
  variant: "default",
  size: "sm",
  radius: "xl",
  className: classes.chip,
  classNames: { section: classes.chipSection },
  // A tapped combobox chip is focused by Mantine without preventScroll, which jumps an iOS page;
  // focusing it first without scrolling makes that call a no-op. A pointer shows no focus ring.
  onPointerDown: (event: PointerEvent<HTMLElement>) =>
    event.currentTarget.focus({ preventScroll: true, focusVisible: false }),
} as const;

/** A chip that shows only its icon; callers give it an accessible name and a tooltip. */
export const iconChipProps = {
  ...chipProps,
  className: `${classes.chip} ${classes.iconChip}`,
} as const;
