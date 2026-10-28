/**
 * The size control's tiers (`resolutionTier`; `resolution` is a workflow's or provider's own
 * setting): the image's long edge, with the aspect from the input's own width and height.
 */
export const resolutions = ["1K", "2K", "4K"] as const;
export type Resolution = (typeof resolutions)[number];
export const defaultResolution: Resolution = "1K";
const longEdges: Record<Resolution, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };

type Range = { min?: number; max?: number; step?: number };
interface SizedProfile {
  kind?: string;
  aspectPolicy?: string;
  constraints?: Record<string, Range | undefined>;
  native?: Partial<Record<string, string>>;
}
interface SizedInput {
  kind?: unknown;
  width?: unknown;
  height?: unknown;
  resolutionTier?: unknown;
  inpaint?: unknown;
  referenceAssets?: unknown;
  referenceRole?: unknown;
  autoUpscale?: unknown;
}

const adjustable = (range?: Range) =>
  Boolean(range && Number(range.max) > 0 && Number(range.min ?? 0) !== Number(range.max));

/**
 * Whether the tier sizes this run. Videos, a painted mask or a reference that frames the output
 * decide the size themselves, and a profile without adjustable width and height keeps its own.
 */
export function resolutionApplies(input: SizedInput, profile?: SizedProfile) {
  if (!profile || (input.kind || profile.kind) !== "image" || input.inpaint) return false;
  if (!adjustable(profile.constraints?.width) || !adjustable(profile.constraints?.height))
    return false;
  const referenced = Array.isArray(input.referenceAssets) && input.referenceAssets.length > 0;
  return !(
    profile.aspectPolicy === "reference" &&
    referenced &&
    input.referenceRole !== "reference"
  );
}

/**
 * How a profile reaches a tier: the tier it draws at, and the long edge Upscale then takes it to
 * where the model doesn't draw that size itself (4K draws at 2K where it can, else 1K).
 */
export function resolutionPlan(profile: SizedProfile | undefined, resolution: Resolution) {
  const draws = (tier: Resolution) =>
    tier === "1K" || profile?.native?.[tier.toLowerCase()] === "yes";
  if (draws(resolution)) return { draws: resolution };
  return {
    draws: draws("2K") ? ("2K" as const) : ("1K" as const),
    upscaleTo: longEdges[resolution],
  };
}

/** `size`'s aspect with its long edge at the tier, each side rounded to the profile's multiple. */
export function resolutionSize(
  size: { width: number; height: number },
  resolution: Resolution,
  profile?: SizedProfile,
) {
  const scale = longEdges[resolution] / Math.max(size.width, size.height);
  const snap = (value: number, range: Range = {}) => {
    const step = Number(range.step) || 16;
    const min = Math.ceil((Number(range.min) || step) / step) * step;
    const max = Math.floor((Number(range.max) || 16384) / step) * step;
    return Math.max(min, Math.min(max, Math.round((value * scale) / step) * step));
  };
  return {
    width: snap(size.width, profile?.constraints?.width),
    height: snap(size.height, profile?.constraints?.height),
  };
}

export const isResolution = (value: unknown): value is Resolution =>
  resolutions.includes(value as Resolution);

/**
 * The run's size for its tier (1K when none is set): the width and height it draws at, and Smart
 * upscale to the tier's long edge where the model doesn't draw it. Applying it again changes nothing.
 */
export function withResolution<T extends SizedInput>(input: T, profile?: SizedProfile): T {
  if (!resolutionApplies(input, profile)) return input;
  const resolution = isResolution(input.resolutionTier) ? input.resolutionTier : defaultResolution;
  const width = Number(input.width) || 1024;
  const height = Number(input.height) || width;
  const plan = resolutionPlan(profile, resolution);
  const size = resolutionSize({ width, height }, plan.draws, profile);
  const asked = (input.autoUpscale || null) as { quality?: string } | null;
  return {
    ...input,
    resolutionTier: resolution,
    ...size,
    // 2K and larger draws decode in tiles.
    ...(plan.draws === "1K" ? {} : { tiledDecode: true }),
    autoUpscale: plan.upscaleTo
      ? {
          ...asked,
          quality: asked?.quality || (resolution === "4K" ? "high" : "balanced"),
          target: plan.upscaleTo,
        }
      : asked,
  };
}
