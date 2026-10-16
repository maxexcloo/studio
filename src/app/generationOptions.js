export { outputProfile } from './outputReuse.js';

/** Video count is a queue of independent jobs, never the model's batch size. */
export function profileCountRange(profile, kind = profile?.kind || "image") {
  if (kind === "video") return { min: 1, max: 8, step: 1 };
  if (profile?.capabilities?.variations === false) return { min: 1, max: 1, step: 1 };
  const meta = profile?.constraints?.count || {};
  const min = Math.max(1, Number(meta.min) || 1);
  return { min, max: Math.max(min, Math.min(8, Number(meta.max) || 8)), step: Math.max(1, Number(meta.step) || 1), offset: Number(meta.offset) || 0 };
}

export function clampProfileCount(profile, count, kind = profile?.kind || "image") {
  const { min, max, step, offset = 0 } = profileCountRange(profile, kind);
  const value = Math.max(min, Math.min(max, Number(count) || 1));
  return Math.round(Math.max(min, Math.min(max, Math.round((value - offset) / step) * step + offset)));
}

export function profileImageCount(profile, fallback = 4) {
  return clampProfileCount(profile, profile?.kind === "video" ? 1 : fallback);
}

/** Reference latents multiply memory use: queue each variant separately. */
export function generationPlan({ count = 1, kind, profile, references = [], queueMode }) {
  const effectiveCount = clampProfileCount(profile, count, kind);
  const separate = kind === "video" || (clampProfileCount(profile, 1, kind) === 1 && (queueMode === "separate" || references.length > 0));
  return { effectiveCount, separate, imageRuns: separate ? effectiveCount : 1, requestCount: separate ? 1 : effectiveCount };
}

/** Use the workflow's own canvas unless its family selects a starting preset. */
export function profileImageSize(profile, kind = profile?.kind || "image") {
  const defaults = profile?.defaults || {};
  const aspect = profile?.aspectPolicy !== "fixed" && profile?.aspectDefault
    ? profile.aspectPresets?.find((item) => item.label === profile.aspectDefault)
    : null;
  const width = Number(defaults.width || (kind === "video" ? 640 : 1024));
  const height = Number(defaults.height || width);
  return aspect ? { width: aspect.w, height: aspect.h } : { width, height };
}

/** Fit a reference's proportions to the canvas budget and both dimension limits together. */
export function referenceImageSize(profile, reference, { pixels, resize = true } = {}) {
  const width = Number(reference?.width);
  const height = Number(reference?.height);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  const defaults = profileImageSize(profile);
  const budget = Number(pixels) > 0 ? Number(pixels) : defaults.width * defaults.height;
  const ranges = ['width', 'height'].map((key) => {
    const range = profile?.constraints?.[key] || {};
    const step = Number(range.step) || 8;
    return { min: Math.ceil((range.min ?? 64) / step) * step, max: Math.floor((range.max ?? 4096) / step) * step, step };
  });
  if (ranges.some((range) => range.min > range.max)) return null;
  const [w, h] = ranges;
  const minScale = Math.max(w.min / width, h.min / height);
  const maxScale = Math.min(w.max / width, h.max / height);
  let scale = resize ? Math.min(1, Math.sqrt(budget / (width * height))) : 1;
  // Some fixed or unusually narrow ranges cannot represent the source ratio.
  scale = minScale <= maxScale ? Math.max(minScale, Math.min(maxScale, scale)) : Math.min(maxScale, scale);
  const snap = (value, range) => Math.max(range.min, Math.min(range.max, Math.round(value / range.step) * range.step));
  return { width: snap(width * scale, w), height: snap(height * scale, h) };
}
