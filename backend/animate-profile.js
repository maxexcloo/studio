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
 * takes the `prefer`red pool (`local` unless asked) while it can run, otherwise the other, with a
 * `note` saying so; `local` and `cloud` (MCP's `runs_on`) take only their own pool and refuse
 * without it. It never waits on a stopped worker. Profiles that take a first frame come first; among them
 * `tier` (Fast unless asked) takes its nearest tier with a profile, preferring the account's default
 * family. `offers` says what Animate's Cloud, Fast and Quality offer the account, also on a refusal:
 * `cloud` with a Grok profile, and `fast` and `quality` for the local tiers (a stopped pool
 * included, so picking it says why it can't run): both when they pick different profiles, otherwise
 * the one its profile is nearer. `profiles` are the account's own. Given the image's `width` and `height`, the
 * choice carries the video's `size` (frameSize).
 */
export function animateProfile(
  profiles,
  {
    defaultId,
    localRunning,
    localParked = false,
    tier = "fast",
    where = "auto",
    prefer = "local",
    width,
    height,
  },
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
  const pick = (pool, wanted) => {
    const frames = pool.filter(takesFirstFrame);
    const candidates = frames.length ? frames : pool;
    return chooseProfile(candidates, {
      kind: "video",
      tier: tierDistance[wanted].find((item) => candidates.some((p) => tierOf(p) === item)),
      references: 1,
      defaultId,
    });
  };
  const anyLocal = usable.filter((profile) => !isCloudProfile(profile));
  const [fast, quality] = anyLocal.length
    ? [pick(anyLocal, "fast"), pick(anyLocal, "quality")]
    : [];
  const fastTier = ["fast", "turbo"].includes(tierOf(fast));
  const offers = {
    cloud: grok.length > 0,
    fast: Boolean(fast) && (fast !== quality || fastTier),
    quality: Boolean(quality) && (fast !== quality || !fastTier),
  };
  const refuse = (message) => {
    throw Object.assign(new Error(message), { offers });
  };
  const choose = (pool) => {
    const profile = pick(pool, tier);
    return { profile, tier: tierOf(profile) };
  };
  const cloudChoice = (note) => {
    const choice = choose(grok);
    return withSize({ ...choice, cloud: true, offers, note }, width, height);
  };
  if (where === "auto" && prefer === "cloud" && grok.length) return cloudChoice("");
  if (where !== "cloud" && localRunning && local.length) {
    const choice = choose(local);
    // A preferred Cloud lands here only when the account has no Grok profile.
    const note =
      where === "auto" && prefer === "cloud"
        ? `Cloud isn't available to this account, so this runs on ${choice.profile.label || choice.profile.id}.`
        : "";
    return withSize({ ...choice, cloud: false, offers, note }, width, height);
  }
  if (where === "local")
    refuse(
      anyLocal.length
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
  const label = choose(grok).profile.label || choose(grok).profile.id;
  return cloudChoice(
    where === "cloud"
      ? ""
      : localRunning
        ? `No local video profile takes a starting image, so this runs on ${label}.`
        : `${notRunning}, so this runs on ${label}.`,
  );
}
const withSize = (choice, width, height) =>
  width > 0 && height > 0 ? { ...choice, size: frameSize(choice.profile, width, height) } : choice;
