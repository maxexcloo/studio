import type { GenerationInput, Profile } from "../../types";
import { controlRange } from "./payload.ts";

/**
 * A video's length choices in seconds, as the profile's own duration or as frames at its FPS on the
 * frame grid the worker accepts (counted from the minimum, as backend/validation.js does).
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
    .concat(current > 0 ? [current] : [])
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
      .map((value) => ({
        value: String(value),
        label: `${Number((value / fps).toFixed(2))} s`,
      })),
  };
}
