/**
 * The size control's tiers (`resolutionTier`; `resolution` is a workflow's or provider's own
 * setting): the image's long edge, with the aspect from the input's own width and height.
 */
export const resolutions = ["1K", "2K", "4K"] as const;
export type Resolution = (typeof resolutions)[number];
const longEdges: Record<Resolution, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };

type Range = { min?: number; max?: number; step?: number };
interface SizedProfile {
  kind?: string;
  aspectPolicy?: string;
  constraints?: Record<string, Range | undefined>;
  native?: Partial<Record<string, string>>;
  options?: { resolutions?: string[] };
}
interface SizedInput {
  kind?: unknown;
  width?: unknown;
  height?: unknown;
  resolutionTier?: unknown;
  inpaint?: unknown;
  referenceAssets?: unknown;
  referenceRole?: unknown;
}

const adjustable = (range?: Range) =>
  Boolean(range && Number(range.max) > 0 && Number(range.min ?? 0) !== Number(range.max));

/**
 * Whether the tier sizes this run. Videos, a painted mask or a reference that frames the output
 * decide the size themselves, and a profile without adjustable width and height keeps its own.
 */
export function resolutionApplies(input: SizedInput, profile?: SizedProfile) {
  if (!profile || (input.kind || profile.kind) !== "image" || input.inpaint) return false;
  if (profile.options?.resolutions?.length) return false;
  if (!adjustable(profile.constraints?.width) || !adjustable(profile.constraints?.height))
    return false;
  const referenced = Array.isArray(input.referenceAssets) && input.referenceAssets.length > 0;
  return !(
    profile.aspectPolicy === "reference" &&
    referenced &&
    input.referenceRole !== "reference"
  );
}

/** Tiers the profile explicitly supports, within its dimension limits. */
export function availableResolutions(profile?: SizedProfile, input?: SizedInput) {
  if (!resolutionApplies(input || { kind: profile?.kind }, profile)) return [];
  return resolutions.filter((tier) => {
    if (tier !== "1K" && profile?.native?.[tier.toLowerCase()] !== "yes") return false;
    if (!input)
      return ["width", "height"].some(
        (key) => Number(profile?.constraints?.[key]?.max) >= longEdges[tier],
      );
    const steps = Object.fromEntries(
      ["width", "height"].map((key) => [key, { step: profile?.constraints?.[key]?.step }]),
    );
    const size = {
      width: Number(input.width) || 1024,
      height: Number(input.height) || Number(input.width) || 1024,
    };
    const intended = resolutionSize(size, tier, { constraints: steps });
    const limited = resolutionSize(size, tier, profile);
    return intended.width === limited.width && intended.height === limited.height;
  });
}

/** A remembered tier follows the profile's available choices when the profile or shape changes. */
export function selectedResolution(input: SizedInput, profile?: SizedProfile) {
  const choices = availableResolutions(profile, input);
  return choices.find((tier) => tier === input.resolutionTier) || choices[0];
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

/** Apply an explicit native tier; requests without a tier retain their pixel dimensions. */
export function withResolution<T extends SizedInput>(input: T, profile?: SizedProfile): T {
  if (!resolutionApplies(input, profile) || !isResolution(input.resolutionTier)) return input;
  const resolution = input.resolutionTier;
  const width = Number(input.width) || 1024;
  const height = Number(input.height) || width;
  const choices = availableResolutions(profile, { width, height });
  if (!choices.includes(resolution))
    throw new Error(`Choose a native resolution for this model: ${choices.join(", ")}.`);
  const size = resolutionSize({ width, height }, resolution, profile);
  return {
    ...input,
    ...size,
    // 2K and larger draws decode in tiles.
    ...(resolution === "1K" ? {} : { tiledDecode: true }),
  };
}
