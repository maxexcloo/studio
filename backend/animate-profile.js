import { isCloudProfile } from "./cloud-profiles.js";
import { profileImageSize, referenceImageSize } from "./generation-defaults.js";
import { chooseProfile, takesFirstFrame } from "./mcp-tiers.js";
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
 * The video profile that animates an image when the user named none: while the local video worker
 * runs, the account's default local first-frame profile, else the usual local pick (`tier` narrows
 * it); otherwise a Grok profile the account is granted, with a `note` saying so. It never waits on
 * a stopped worker. `profiles` are the account's own; `cloud` is a request for Grok. Given the
 * image's `width` and `height`, the choice carries the video's `size` (frameSize).
 */
export function animateProfile(
  profiles,
  { defaultId, localRunning, localParked = false, tier, cloud = false, width, height },
) {
  // A parked worker was stopped on purpose; say so rather than call it not running.
  const notRunning = localParked
    ? "Local video is parked (an administrator stopped it on purpose)"
    : "Local video isn't running";
  const usable = profiles.filter(
    (profile) => profile.kind === "video" && profile.ready !== false && profile.mediaInputs?.length,
  );
  const local = usable.filter(
    (profile) => !isCloudProfile(profile) && !["offline", "parked"].includes(profile.availability),
  );
  const grok = usable.filter(isCloudProfile);
  const options = { kind: "video", tier, references: 1, firstFrame: true, defaultId };
  if (!cloud && localRunning && local.length) {
    const preferred = !tier && local.find((p) => p.id === defaultId && takesFirstFrame(p));
    return withSize(
      { profile: preferred || chooseProfile(local, options), cloud: false, note: "" },
      width,
      height,
    );
  }
  if (!grok.length)
    throw new Error(
      cloud
        ? "This account has no Grok video profile; Cloud Models is off for it."
        : localRunning
          ? "No video profile that takes a starting image is available to this account."
          : `${notRunning} and this account has no Grok access (Cloud Models), so nothing can animate this image right now.`,
    );
  const profile = chooseProfile(grok, options);
  const label = profile.label || profile.id;
  return withSize(
    {
      profile,
      cloud: true,
      note: cloud
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
