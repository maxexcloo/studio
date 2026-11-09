import { isCloudProfile } from "../shared/profiles.ts";
import { profileImageSize, referenceImageSize } from "./generation-defaults.js";
import { chooseProfile, takesFirstFrame, tierDistance, tierOf } from "./mcp/tiers.js";
import { videoAspect } from "./providers/cliproxy.ts";

/**
 * The video's size from its first frame: the image's proportions at the profile's default pixel
 * count, within its limits; for Grok, the nearest aspect it accepts.
 */
export function frameSize(profile, width, height) {
  const mode = { ...profile, ...profile.imageModes?.reference };
  const budget = profileImageSize(mode);
  if (!isCloudProfile(profile)) {
    const scale = Math.sqrt((budget.width * budget.height) / (width * height));
    return referenceImageSize(mode, { width: width * scale, height: height * scale });
  }
  const [a, b] = videoAspect(width, height).split(":").map(Number);
  const unit = Math.round(Math.sqrt((budget.width * budget.height) / (a * b)));
  return { width: a * unit, height: b * unit };
}

/**
 * The video profile that animates an image when the user named none. `where` picks the pool: `auto`
 * takes a local one while the local video worker runs, otherwise a Grok profile the account is
 * granted, with a `note` saying so; `local` and `cloud` take only their own pool and refuse without
 * it. It never waits on a stopped worker. Profiles that take a first frame come first; among them
 * `tier` (Fast unless asked) takes its nearest tier with a profile, preferring the account's default
 * family. `tiers` lists Fast and Quality when they pick different profiles in the pool, so Animate
 * offers the choice. `offers` says which pools the account has, also on a refusal, so Animate offers
 * Local GPU or Cloud. `profiles` are the account's own. Given the image's `width` and `height`, the
 * choice carries the video's `size` (frameSize).
 */
export function animateProfile(
  profiles,
  { defaultId, localRunning, localParked = false, tier = "fast", where = "auto", width, height },
) {
  // A parked worker was stopped on purpose; say so rather than call it not running.
  const notRunning = localParked
    ? "Videos are Stopped (an administrator can start them in Settings › Workers)"
    : "Local video isn't running";
  const usable = profiles.filter(
    (profile) => profile.kind === "video" && profile.ready !== false && profile.mediaInputs?.length,
  );
  const local = usable.filter(
    (profile) => !isCloudProfile(profile) && !["offline", "parked"].includes(profile.availability),
  );
  const grok = usable.filter(isCloudProfile);
  // A stopped or offline local pool is still offered, so picking it says why it can't run.
  const offers = {
    local: usable.some((profile) => !isCloudProfile(profile)),
    cloud: grok.length > 0,
  };
  const refuse = (message) => {
    throw Object.assign(new Error(message), { offers });
  };
  const choose = (pool) => {
    const frames = pool.filter(takesFirstFrame);
    const candidates = frames.length ? frames : pool;
    const pick = (wanted) =>
      chooseProfile(candidates, {
        kind: "video",
        tier: tierDistance[wanted].find((item) => candidates.some((p) => tierOf(p) === item)),
        references: 1,
        defaultId,
      });
    const profile = pick(tier);
    const offered = pick("fast") !== pick("quality");
    return { profile, tier: tierOf(profile), tiers: offered ? ["fast", "quality"] : [] };
  };
  if (where !== "cloud" && localRunning && local.length)
    return withSize({ ...choose(local), cloud: false, note: "", offers }, width, height);
  if (where === "local")
    refuse(
      offers.local
        ? `${notRunning}, so Local GPU can't animate this right now.`
        : "This account has no local video profile that takes a starting image.",
    );
  if (!grok.length)
    refuse(
      where === "cloud"
        ? "This account has no Grok video profile; Cloud Models is off for it."
        : localRunning
          ? "No video profile that takes a starting image is available to this account."
          : `${notRunning} and this account has no Grok access (Cloud Models), so nothing can animate this image right now.`,
    );
  const choice = choose(grok);
  const label = choice.profile.label || choice.profile.id;
  return withSize(
    {
      ...choice,
      cloud: true,
      offers,
      note:
        where === "cloud"
          ? ""
          : localRunning
            ? `No local video profile takes a starting image, so this runs on ${label}.`
            : `${notRunning}, so this runs on ${label}.`,
    },
    width,
    height,
  );
}
const withSize = (choice, width, height) =>
  width > 0 && height > 0 ? { ...choice, size: frameSize(choice.profile, width, height) } : choice;
