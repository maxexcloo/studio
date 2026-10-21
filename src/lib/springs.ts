import { useReducedMotion } from "framer-motion";

/**
 * Framer motion presets (UI-PATTERNS › Motion). Nothing overshoots: springs
 * have no bounce, and the tweens match the CSS tokens in 00-tokens.css.
 * Use these instead of raw timings.
 */
const ease = [0.2, 0, 0, 1] as const;

export const springs = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
  },
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0,
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0,
  },
  /** Only for sheets that follow a finger. */
  sheet: {
    type: "spring" as const,
    stiffness: 420,
    damping: 40,
  },
} as const;

/** --motion-instant/fast/base/slow with --motion-ease. */
export const tweens = {
  instant: { duration: 0.09, ease },
  fast: { duration: 0.14, ease },
  base: { duration: 0.2, ease },
  slow: { duration: 0.32, ease },
} as const;

export const motionEase = ease;

/** Smooth scrolling becomes an instant jump with reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * For height, width and filter animations, which MotionConfig's reduced
 * motion does not cover: the given tween, or an instant change.
 */
export function useMotionTween(tween: { duration: number; ease: typeof ease } = tweens.slow) {
  return useReducedMotion() ? { duration: 0 } : tween;
}
