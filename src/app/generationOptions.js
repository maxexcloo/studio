import { defaultGenerationCount } from '../../server/generation-defaults.js';

export { profileImageSize, referenceImageSize } from '../../server/generation-defaults.js';

/** Snap typed and restored dimensions to the selected model's supported stride. */
export function imageDimension(value, metadata = {}) {
  const step = Number(metadata.step) || 1;
  const minimum = Math.ceil((Number(metadata.min) || step) / step) * step;
  const maximum = Math.floor((Number(metadata.max) || 16384) / step) * step;
  return Math.max(minimum, Math.min(maximum, Math.round(Number(value) / step) * step));
}

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

export function profileImageCount(profile, fallback = defaultGenerationCount) {
  return clampProfileCount(profile, fallback);
}

/** Reference latents multiply memory use: queue each variant separately. */
export function generationPlan({ count = 1, kind, profile, references = [], queueMode }) {
  const effectiveCount = clampProfileCount(profile, count, kind);
  const separate = kind === "video" || (clampProfileCount(profile, 1, kind) === 1 && (queueMode === "separate" || references.length > 0));
  return { effectiveCount, separate, imageRuns: separate ? effectiveCount : 1, requestCount: separate ? 1 : effectiveCount };
}
