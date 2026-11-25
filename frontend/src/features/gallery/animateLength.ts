import type { GenerationInput, MediaItem, Profile } from "../../types";
import { withLength } from "../generation/length.ts";
import { isProfile, profileForBackend, takesReferences } from "../generation/payload.ts";

/** Where videos run: the side of Studio's default video model. */
export type VideoSide = "cloud" | "local";

/** A video continues on its own profile unless videos run on Cloud or its profile cannot run. */
export function retainedAnimationProfile(
  profiles: Profile[],
  item: Pick<MediaItem, "type" | "settings" | "model">,
  videos?: VideoSide,
) {
  if (item.type !== "video" || videos === "cloud") return undefined;
  const priorId = String(item.settings?.profileId || "");
  return profiles.find((listed) => {
    const profile = profileForBackend(listed, undefined, true)!;
    return (
      profile.kind === "video" &&
      profile.ready !== false &&
      !listed.availability &&
      takesReferences(listed) &&
      (priorId ? isProfile(listed, priorId) : listed.model === item.model)
    );
  });
}

/**
 * The reference mode's timing, shared by menu choices, writing and submission: the length the
 * person last chose in Animate, else Studio's configured video length.
 */
export function animationInput(input: GenerationInput, listed: Profile, seconds?: number | null) {
  const profile = profileForBackend(listed, undefined, true)!;
  const mode = profile.imageModes?.reference;
  const run = { ...profile, capabilities: { ...profile.capabilities, ...mode?.capabilities } };
  const next = { ...input, ...profile.defaults, ...mode?.defaults };
  return withLength(next, run, seconds ?? listed.videoPreference?.videoSeconds);
}
