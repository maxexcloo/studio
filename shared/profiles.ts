/** The most LoRAs a stack runs: a loader holds up to this many (rgthree stacks and Radiance take 4). */
export const maxLoras = 8;
/** What a LoRA does to a picture, as the catalogue classifies it. */
export const loraTypes = ["slider", "style", "character", "concept"] as const;
/** How a LoRA runs: an optional effect, or part of a recipe (an acceleration adapter, a supporting file). */
export const loraRoles = ["effect", "acceleration", "supporting"] as const;
/** The backends one profile can run on, by name; a combined profile keeps each one's graph and settings in `studio.backends`. */
export const profileBackendLabels: Readonly<Record<string, string>> = Object.freeze({
  comfyui: "ComfyUI",
  radiance: "Radiance",
});

/**
 * The backend a combined profile's run uses: the one asked for while the profile has it, else its
 * default, unless the run has references the default takes none of; then the first backend that does.
 * A run with LoRAs leaves Radiance for ComfyUI unless its Radiance backend has a model for LoRA runs
 * (`loras`): Radiance 2's IQ8R models take no adapters.
 */
export function runBackend(
  backends: readonly { id: string; references: number; loras?: boolean }[],
  fallback: string,
  wanted: unknown,
  references: boolean,
  loras = false,
): string {
  if (backends.some((option) => option.id === wanted)) return wanted as string;
  if (
    loras &&
    fallback === "radiance" &&
    !backends.find((option) => option.id === "radiance")?.loras &&
    backends.some((option) => option.id === "comfyui")
  )
    return "comfyui";
  if (!references || backends.find((option) => option.id === fallback)?.references !== 0)
    return fallback;
  return backends.find((option) => option.references)?.id || fallback;
}

/**
 * A profile's reference slots as roles: a slot that `follows` another of its role joins that one's
 * linked stack, which takes as many images as its slots' `max` (1 each) add up to.
 */
export function slotGroups<S extends { id: string; role?: string; follows?: string }>(slots: S[]) {
  const groups: S[][] = [];
  for (const slot of slots) {
    const group = slot.follows
      ? groups.find(
          (items) => items[0].role === slot.role && items.some((item) => item.id === slot.follows),
        )
      : undefined;
    if (group) group.push(slot);
    else groups.push([slot]);
  }
  return groups;
}

export const slotCapacity = (group: { max?: number }[]) =>
  group.reduce((total, input) => total + (input.max || 1), 0);

/** What a combined profile shares across its backends; any other field in `studio.backends.<id>` replaces the shared one. */
export const sharedProfileFields: readonly string[] = Object.freeze([
  "id",
  "name",
  "kind",
  "family",
  "uncensored",
  "prompting",
]);

/** A profile name's "·" segments without its backend's, so "Krea 2 · ComfyUI · Fast" keeps "Krea 2" and "Fast". */
export const profileNameParts = (name: string) =>
  String(name)
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !Object.hasOwn(profileBackendLabels, part.toLowerCase()));

/**
 * A profile family as LoRAs list it: an imported profile may say "minimax-h3" for "minimax_h3",
 * and FLUX.3 Klein's "flux3_klein" is the "flux3" its adapters name.
 */
export const loraFamilyId = (family: unknown) => {
  const id = String(family || "").replaceAll("-", "_");
  return id === "flux3_klein" ? "flux3" : id;
};

const constraintKeys = ["baseModels", "conditionings", "profileIds"] as const;
/** A LoRA publisher's targets within its family; `unlisted: "other"` refuses the rest. */
export type LoraConstraints = Partial<Record<(typeof constraintKeys)[number], string[]>> & {
  unlisted?: string;
};
const basename = (value: unknown) =>
  String(value || "")
    .split(/[\\/]/)
    .pop();

/**
 * Whether a LoRA suits a profile: "other" (trained for another family, or a variant its publisher
 * excludes) is refused on submit; "unknown" is unverified. Explicit publisher targets refine family
 * compatibility.
 */
export function loraCompatibility(
  info:
    | {
        families?: string[];
        compatibility?: LoraConstraints;
      }
    | null
    | undefined,
  profile:
    | {
        id?: string;
        family?: unknown;
        baseModel?: string;
        model?: string;
        defaults?: { model?: unknown };
        recipe?: { conditioning?: string };
      }
    | null
    | undefined,
): "fits" | "other" | "unknown" {
  const family = loraFamilyId(profile?.family);
  if (!info?.families?.length || !family || family === "custom") return "unknown";
  if (!info.families.some((value) => loraFamilyId(value) === family)) return "other";
  const constraints = info.compatibility;
  if (!constraints) return "fits";
  const model = profile?.baseModel || profile?.defaults?.model || profile?.model;
  const context = {
    baseModels: String(model || "").startsWith("custom:") ? "" : basename(model),
    conditionings: profile?.recipe?.conditioning,
    profileIds: profile?.id,
  };
  let unknown = false;
  for (const key of constraintKeys) {
    if (!Object.hasOwn(constraints, key)) continue;
    if (!context[key]) {
      unknown = true;
      continue;
    }
    const allowed = constraints[key] || [];
    if (
      !allowed.some((value) => (key === "baseModels" ? basename(value) : value) === context[key])
    ) {
      if (constraints.unlisted === "other") return "other";
      unknown = true;
    }
  }
  return unknown ? "unknown" : "fits";
}

/**
 * A LoRA's readable name: its catalogue title, else its file name cleaned up (no folder or
 * extension, spaces for underscores and hyphens, Title Case), so people never read
 * "pawg_krea2.safetensors".
 */
export function loraName(file: string, info?: { title?: unknown } | null) {
  const title = typeof info?.title === "string" ? info.title.trim() : "";
  if (title) return title;
  return String(file || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)([a-z])/g, (_, space, letter) => space + letter.toUpperCase());
}

/** A recommendation does not require complete publisher bounds for the strength control. */
export const loraDefaultStrength = (
  info:
    | {
        recommendedStrength?: number;
        strengthRange?: { default?: number; min?: number; max?: number };
      }
    | undefined,
  fallback: number,
) =>
  info?.recommendedStrength ??
  info?.strengthRange?.default ??
  Math.min(
    Math.max(fallback, info?.strengthRange?.min ?? fallback),
    info?.strengthRange?.max ?? fallback,
  );

/**
 * A provider-backed cloud profile (Grok): it runs at the provider, not on a worker. Access
 * profiles grant these through their Cloud Models feature rather than one by one. Studio picks one
 * by itself only as an account's default: its Images or Videos preference is Cloud, or no local
 * profile can run (model/catalogue.js withPreferredDefaults).
 */
export const isCloudProfile = (
  profile?: { id?: unknown; family?: string; provider?: string } | null,
) =>
  profile?.provider === "cliproxyapi" ||
  profile?.family === "grok" ||
  /^grok/i.test(String(profile?.id || ""));

/**
 * What a reference slot (`studio.mediaInputs[].role`) can guide, by name. A slot with one of these
 * roles steers the result rather than being where it starts (`start`, `end` or a plain `reference`),
 * and only these slots may map a `strength` input.
 */
export const guidingRoles: Readonly<Record<string, string>> = Object.freeze({
  identity: "Identity",
  layout: "Pose/Layout",
  style: "Style",
});
