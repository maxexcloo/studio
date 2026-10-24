import classes from "./GenerationInputControls.module.css";

/** Shared Button props for the compact chips in the generation rail. */
export const chipProps = {
  variant: "default",
  size: "sm",
  radius: "xl",
  className: classes.chip,
} as const;
