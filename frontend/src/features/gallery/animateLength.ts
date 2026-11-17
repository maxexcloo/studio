import type { GenerationInput, MediaItem, Profile } from "../../types";
import { lengthChoices } from "../generation/length.ts";
import { isProfile, profileForBackend } from "../generation/payload.ts";
import type { SidePreference } from "../settings/accountPreferences";

/** A video continues on its own profile unless Cloud is chosen or its profile cannot run. */
export function retainedAnimationProfile(
  profiles: Profile[],
  item: Pick<MediaItem, "type" | "settings" | "model">,
  videos?: SidePreference,
) {
  if (item.type !== "video" || videos === "cloud") return undefined;
  const priorId = String(item.settings?.profileId || "");
  return profiles.find((listed) => {
    const profile = profileForBackend(listed, undefined, true)!;
    return (
      profile.kind === "video" &&
      profile.ready !== false &&
      (profile.mediaInputs?.length ||
        profile.capabilities.imageInput ||
        profile.capabilities.img2img) &&
      (priorId ? isProfile(listed, priorId) : listed.model === item.model)
    );
  });
}

/** The reference mode's timing, shared by menu choices, writing and submission. */
export function animationInput(input: GenerationInput, listed: Profile, seconds?: number | null) {
  const profile = profileForBackend(listed, undefined, true)!;
  const mode = profile.imageModes?.reference;
  const run = { ...profile, capabilities: { ...profile.capabilities, ...mode?.capabilities } };
  const next = { ...input, ...profile.defaults, ...mode?.defaults };
  const choices = lengthChoices(next, run);
  if (!choices || seconds == null) return next;
  const fps = choices.key === "duration" ? 1 : next.fps;
  const range = run.constraints?.[choices.key] || {};
  const { min = 1, max = Infinity, step = 1, offset = min } = range;
  const value = offset + step * Math.round((seconds * fps - offset) / step);
  // A choice remembered for another profile never makes this profile run an unsupported length.
  return value >= min && value <= max ? { ...next, [choices.key]: value } : next;
}
