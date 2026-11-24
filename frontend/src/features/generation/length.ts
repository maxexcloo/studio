import type { GenerationInput, Profile } from "../../types";
import { controlRange } from "./payload.ts";

/**
 * A video's length choices in seconds, as the profile's own duration or as frames at its FPS on the
 * frame grid the worker accepts (counted from the minimum, as backend/validation.js does), up to
 * the longest it makes.
 */
export function lengthChoices(input: GenerationInput, profile?: Profile) {
  if (input.kind !== "video" || !profile) return null;
  const duration = profile.capabilities.duration === true;
  const range = controlRange(profile, duration ? "duration" : "frames", { min: 1 });
  const fps = duration ? 1 : input.fps;
  if (!range || !(fps > 0)) return null;
  const { min = 1, max = Infinity, step = 1 } = range;
  const offset = range.offset ?? min;
  const current = Number(duration ? input.duration : input.frames);
  const values = [2, 3, 5, 8, 10, 15]
    .map((seconds) => offset + step * Math.round((seconds * fps - offset) / step))
    .concat(current > 0 ? [current] : [], Number.isFinite(max) ? [max] : [])
    .filter(
      (value) =>
        value >= min &&
        value <= max &&
        Math.abs((value - offset) / step - Math.round((value - offset) / step)) < 1e-8,
    );
  return {
    key: duration ? "duration" : "frames",
    value: String(current),
    data: [...new Set(values)]
      .sort((a, b) => a - b)
      .map((value) => {
        // Whole seconds, as lengths are named (5s, 8s), where a frame grid lands just off them.
        const seconds = value / fps;
        const whole = Math.round(seconds);
        return {
          value: String(value),
          label: Math.abs(seconds - whole) < 0.25 ? `${whole}s` : `${seconds.toFixed(1)}s`,
        };
      }),
  };
}

/**
 * The input at `seconds` long, on the profile's duration or frame grid; unchanged without a length,
 * or where the profile can't run it, so a length chosen for another profile never breaks this one.
 */
export function withLength(input: GenerationInput, profile: Profile, seconds?: number | null) {
  const choices = lengthChoices(input, profile);
  if (!choices || !seconds) return input;
  const fps = choices.key === "duration" ? 1 : input.fps;
  const range = profile.constraints?.[choices.key] || {};
  const { min = 1, max = Infinity, step = 1, offset = min } = range;
  const value = offset + step * Math.round((seconds * fps - offset) / step);
  return value >= min && value <= max ? { ...input, [choices.key]: value } : input;
}
