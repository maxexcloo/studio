/**
 * The size control's tiers (`resolutionTier`; `resolution` is a workflow's or provider's own
 * setting): the image's long edge, with the aspect from the input's own width and height.
 */
export const resolutions = ["1K", "2K", "4K"] as const;
export type Resolution = (typeof resolutions)[number];
const longEdges: Record<Resolution, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };

type Range = { min?: number; max?: number; step?: number };

/** Round to a multiple even when a declared dimension limit falls between grid points. */
export function snapDimension(value: number, range: Range = {}) {
  const step = Number(range.step) || 16;
  const min = Math.ceil((Number(range.min) || step) / step) * step;
  const max = Math.floor((Number(range.max) || 16384) / step) * step;
  return Math.max(min, Math.min(max, Math.round(value / step) * step));
}

interface SizedProfile {
  kind?: string;
  aspectPolicy?: string;
  constraints?: Record<string, Range | undefined>;
  native?: Partial<Record<string, string>>;
  options?: { resolutions?: string[] };
}

interface DefaultSizedProfile extends SizedProfile {
  aspectDefault?: string;
  aspectPresets?: { label: string; w: number; h: number }[];
  defaults?: { width?: unknown; height?: unknown; resolution?: unknown; resolutionTier?: unknown };
  imageSizePreference?: ImageSizePreference;
}

/** The workflow's configured canvas or its family's starting preset. */
export function profileImageSize(profile?: DefaultSizedProfile, kind = profile?.kind || "image") {
  const aspect =
    profile?.aspectPolicy !== "fixed" && profile?.aspectDefault
      ? profile.aspectPresets?.find((item) => item.label === profile.aspectDefault)
      : undefined;
  const width = Number(profile?.defaults?.width) || (kind === "video" ? 640 : 1024);
  const height = Number(profile?.defaults?.height) || width;
  return aspect ? { width: aspect.w, height: aspect.h } : { width, height };
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
    const intended = resolutionSize(size, tier, { ...profile, constraints: steps });
    const limited = resolutionSize(size, tier, profile);
    return intended.width === limited.width && intended.height === limited.height;
  });
}

/** Missing or unsupported remembered tiers keep the input's pixel dimensions. */
export function selectedResolution(input: SizedInput, profile?: SizedProfile) {
  const choices = availableResolutions(profile, input);
  return choices.find((tier) => tier === input.resolutionTier);
}

/**
 * `size`'s aspect with its long edge at the tier, each side rounded to the profile's multiple. At
 * the profile's own tier (the one nearest its canvas's long edge) a size with a preset's
 * proportions takes that preset, so the profile's own sizes never shrink to the tier's edge.
 */
export function resolutionSize(
  size: { width: number; height: number },
  resolution: Resolution,
  profile?: DefaultSizedProfile,
) {
  const presets = profile?.aspectPresets?.filter(({ w, h }) => w > 0 && h > 0);
  if (presets?.length) {
    const canvas = profileImageSize(profile);
    const edge = Math.max(canvas.width, canvas.height);
    const away = (tier: Resolution) => Math.abs(Math.log(longEdges[tier] / edge));
    const own = resolutions.reduce((closest, tier) =>
      away(tier) < away(closest) ? tier : closest,
    );
    const preset =
      resolution === own &&
      presets.find(({ w, h }) => Math.abs(Math.log((w / h) * (size.height / size.width))) < 0.01);
    if (preset) return { width: preset.w, height: preset.h };
  }
  const scale = longEdges[resolution] / Math.max(size.width, size.height);
  return {
    width: snapDimension(size.width * scale, profile?.constraints?.width),
    height: snapDimension(size.height * scale, profile?.constraints?.height),
  };
}

export const imageAspects = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"] as const;
export type ImageSizePreference = {
  imageAspect?: (typeof imageAspects)[number] | null;
  imageResolution?: Resolution | null;
};
export const grokVideoAspects = [...imageAspects, "21:9", "5:2"];
export const grokVideoDefaultResolution = "720p";
export const grokPinnedResolutions = ["480p", grokVideoDefaultResolution];

export function grokVideoAspect(width: number, height: number) {
  const distance = (aspect: string) => {
    const [w, h] = aspect.split(":").map(Number);
    return Math.abs(Math.log(width / height) - Math.log(w / h));
  };
  return grokVideoAspects.reduce((best, aspect) =>
    distance(aspect) < distance(best) ? aspect : best,
  );
}

/** Aspect presets as every size control lists them: the standard ratios in order, then the rest. */
export function orderedAspects<T extends { label: string }>(presets: T[]) {
  const rank = (preset: T) => {
    const index = imageAspects.findIndex((aspect) => aspect === preset.label);
    return index < 0 ? imageAspects.length : index;
  };
  return [...presets].sort((a, b) => rank(a) - rank(b));
}

export const isResolution = (value: unknown): value is Resolution =>
  resolutions.includes(value as Resolution);

/** A fresh image draft opens on a supported aspect and resolution for its profile. */
export function profileStartingSize(profile: DefaultSizedProfile): {
  width: number;
  height: number;
  resolution?: string;
  resolutionTier?: Resolution;
} {
  const canvas = profileImageSize(profile);
  const { aspectPresets: presets, imageSizePreference: preference } = profile;
  if (profile.kind !== "image" || !presets?.length || profile.aspectPolicy === "fixed")
    return canvas;
  const native = profile.options?.resolutions;
  const pixelSize =
    adjustable(profile.constraints?.width) && adjustable(profile.constraints?.height);
  if (!native?.length && !pixelSize) return canvas;
  const aspect = preference?.imageAspect;
  const [ratioWidth, ratioHeight] = aspect?.split(":").map(Number) ?? [];
  const preferred =
    aspect &&
    (presets.find(({ label }) => label === aspect) ||
      presets.find(({ w, h }) => w * ratioHeight === h * ratioWidth));
  const exact = presets.find(({ w, h }) => w === canvas.width && h === canvas.height);
  const distance = ({ w, h }: (typeof presets)[number]) =>
    Math.abs(Math.log(w / h) - Math.log(canvas.width / canvas.height));
  const preset =
    preferred ||
    exact ||
    presets.reduce((closest, option) => (distance(option) < distance(closest) ? option : closest));
  const size = { width: preset.w, height: preset.h };
  const preferredTier = preference?.imageResolution;
  if (native?.length) {
    const resolution =
      native.find((value) => value.toUpperCase() === preferredTier) ??
      native.find((value) => value === profile.defaults?.resolution) ??
      native[0];
    return { ...size, resolution };
  }
  const tiers = availableResolutions(profile, size);
  if (!tiers.length) return size;
  const configuredTier = profile.defaults?.resolutionTier;
  const longEdge = Math.max(canvas.width, canvas.height);
  const distanceFromTier = (tier: Resolution) => Math.abs(Math.log(longEdges[tier] / longEdge));
  const resolutionTier =
    tiers.find((tier) => tier === preferredTier) ||
    tiers.find((tier) => tier === configuredTier) ||
    tiers.reduce((closest, tier) =>
      distanceFromTier(tier) < distanceFromTier(closest) ? tier : closest,
    );
  return { ...size, resolutionTier };
}

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
