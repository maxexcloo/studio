import type { AspectPreset } from './types';

/* ---------------------------------------------------------------------------
   Sizes and ratios for the size menu: naming a ratio, fitting a ratio to an
   area, and keeping a width and height inside what a model accepts.
--------------------------------------------------------------------------- */

export type Size = { width: number; height: number };
/** What a model accepts for one side (its constraints.width / .height). */
export type SideLimits = { min?: number; max?: number; step?: number };

/** Ratios people know by name, tried before anything is worked out. */
const knownRatios: Array<[number, number]> = [[1, 1], [4, 3], [3, 2], [16, 9], [21, 9], [5, 4], [2, 1], [7, 5], [16, 10], [5, 3], [9, 16], [3, 4], [2, 3], [4, 5], [9, 21], [1, 2], [5, 7], [10, 16], [3, 5]];

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/**
 * A size's ratio as people write it: a known one within 1% ("16:9" for
 * 1344×768), the exact one where it's small ("7:5"), else to one decimal
 * ("2.4:1").
 */
export function ratioName(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return "";
  const ratio = width / height;
  const known = knownRatios.find(([w, h]) => Math.abs(ratio / (w / h) - 1) < 0.01);
  if (known) return `${known[0]}:${known[1]}`;
  const divisor = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width) / divisor;
  const h = Math.round(height) / divisor;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return ratio >= 1 ? `${Number(ratio.toFixed(1))}:1` : `1:${Number((1 / ratio).toFixed(1))}`;
}

/** "1.0 MP", "2.4 MP": an area people can compare at a glance. */
export function megapixels({ width, height }: Size) {
  const value = (width * height) / 1_000_000;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} MP`;
}

/** Whether two sizes have the same shape, within half a percent. */
export function sameRatio(a: Size, b: Size) {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && Math.abs((a.width / a.height) / (b.width / b.height) - 1) < 0.005;
}

/** One side, inside the model's limits and on its step. */
export function snapSide(value: number, limits: SideLimits = {}, fallbackStep = 64) {
  const step = limits.step || fallbackStep;
  const min = Math.max(step, limits.min ?? 64);
  const max = limits.max ?? 4096;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

/**
 * A ratio at about the same area as `area`, both sides on the model's step,
 * kept under each side's limit. The steps near the ideal height are tried,
 * so the shape stays as true as the step allows (4:3 at 4.2 MP lands on
 * 2368×1776, exactly 4:3, not 2368×1760, a percent off).
 */
export function fitRatio(ratio: number, area: number, widthLimits: SideLimits = {}, heightLimits: SideLimits = {}, fallbackStep = 64): Size {
  const maxW = widthLimits.max ?? 4096;
  const maxH = heightLimits.max ?? 4096;
  let idealH = Math.sqrt(area / ratio);
  idealH = Math.min(idealH, maxH, maxW / ratio);
  const stepH = heightLimits.step || fallbackStep;
  let best: Size | null = null;
  let score = Infinity;
  for (let offset = -12; offset <= 12; offset += 1) {
    const height = snapSide(Math.round(idealH / stepH) * stepH + offset * stepH, heightLimits, fallbackStep);
    const width = snapSide(height * ratio, widthLimits, fallbackStep);
    // Shape first, then closeness to the area asked for.
    const next = Math.abs(Math.log((width / height) / ratio)) * 40 + Math.abs(Math.log((width * height) / area));
    if (next < score) { score = next; best = { width, height }; }
  }
  return best || { width: snapSide(idealH * ratio, widthLimits, fallbackStep), height: snapSide(idealH, heightLimits, fallbackStep) };
}

/** The preset nearest in shape to a size, for leaving Custom for a preset tab. */
export function closestPreset(presets: AspectPreset[], size: Size) {
  const ratio = size.width / size.height;
  let best: AspectPreset | null = null;
  let distance = Infinity;
  for (const preset of presets) {
    const next = Math.abs(Math.log((preset.w / preset.h) / ratio));
    if (next < distance) { distance = next; best = preset; }
  }
  return best;
}

/**
 * The shape a preset stands for: its label's ratio where it has one ("16:9"
 * for a 1344×768 preset, which is really 7:4), else its own size's.
 */
export function presetRatio(preset: AspectPreset) {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(preset.label || "").trim());
  return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : preset.w / preset.h;
}

/** "1344x768" → { width: 1344, height: 768 }. */
export function parseSize(value: string): Size {
  const [width, height] = String(value || "").split("x").map(Number);
  return { width: width || 0, height: height || 0 };
}
