/** The backends one profile can run on, by name; a combined profile keeps each one's graph and settings in `studio.backends`. */
export const profileBackendLabels: Readonly<Record<string, string>> = Object.freeze({
  comfyui: "ComfyUI",
  radiance: "Radiance",
});

/**
 * The backend a combined profile's run uses: the one asked for while the profile has it, else its
 * default, unless the run has references the default takes none of; then the first backend that does.
 */
export function runBackend(
  backends: readonly { id: string; references: number }[],
  fallback: string,
  wanted: unknown,
  references: boolean,
): string {
  if (backends.some((option) => option.id === wanted)) return wanted as string;
  if (!references || backends.find((option) => option.id === fallback)?.references !== 0)
    return fallback;
  return backends.find((option) => option.references)?.id || fallback;
}

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
