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
