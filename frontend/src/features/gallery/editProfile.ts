import { isCloudProfile } from "../../../../shared/profiles.ts";
import type { GenerationInput, MediaItem, Profile } from "../../types";
import { isProfile, profileForBackend, takesReferences } from "../generation/payload.ts";

/** The LoRAs a result was made with, as its settings recorded them. */
export const enabledLoras = (settings: MediaItem["settings"]) =>
  Array.isArray(settings?.loras)
    ? (settings.loras as GenerationInput["loras"]).filter(
        (lora) => lora?.name && lora.enabled !== false,
      )
    : undefined;

export function referenceProfilePriority(profile: Profile) {
  const run = profileForBackend(profile, undefined, true)!;
  if (profile.availability || run.ready === false) return 3;
  if (isCloudProfile(profile)) return 2;
  return run.backend === "radiance" ? 0 : 1;
}

// Distilled and few-step editors barely change an image, so a full model edits first.
const fast =
  /\b(turbo|lightning|hyper|lcm|flash|fast|schnell|distill(ed)?|dmd2?)\b|\b([1-9]|1[0-6])[- ]?steps?\b/i;
const distilled = (profile: Profile) =>
  fast.test(`${profile.displayName || profile.label} ${profile.variantLabel || ""}`);

/**
 * The ready editor for an item: the source's family first where its LoRAs can carry over, then a
 * full model before a distilled one, the source's family, Radiance before ComfyUI before Cloud,
 * and the source's own profile.
 */
export function automaticEditProfile(profiles: Profile[], item: MediaItem) {
  const priorId = item.settings?.profileId;
  const made = (profile: Profile) =>
    priorId ? isProfile(profile, priorId) : profile.model === item.model;
  const family = profiles.find(made)?.family;
  const loras = Boolean(enabledLoras(item.settings)?.length);
  const rank = (profile: Profile) => {
    const other = Number(!family || profile.family !== family);
    return [
      loras ? other : 0,
      Number(distilled(profile)),
      other,
      referenceProfilePriority(profile),
      Number(!made(profile)),
    ];
  };
  const ranked = profiles
    .filter(
      (profile) =>
        profile.kind === item.type &&
        takesReferences(profile) &&
        referenceProfilePriority(profile) < 3,
    )
    .map((profile) => ({ profile, rank: rank(profile) }));
  ranked.sort((left, right) => {
    const index = left.rank.findIndex((value, at) => value !== right.rank[at]);
    return index < 0 ? 0 : left.rank[index] - right.rank[index];
  });
  return ranked[0]?.profile;
}
