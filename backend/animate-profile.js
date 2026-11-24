import { isCloudProfile } from "../shared/profiles.ts";
import { profileImageSize } from "../shared/resolution.ts";
import { referenceImageSize } from "./generation-defaults.js";
import { chooseProfile, takesFirstFrame, tierDistance, tierOf } from "./mcp/tiers.js";

/**
 * The video's size from its first frame: the image's proportions at the profile's default pixel
 * count and within its limits. Grok takes the first frame's aspect directly.
 */
export function frameSize(profile, width, height) {
  const mode = { ...profile, ...profile.imageModes?.reference };
  const budget = profileImageSize(mode);
  const scale = Math.sqrt((budget.width * budget.height) / (width * height));
  const scaled = { width: width * scale, height: height * scale };
  return isCloudProfile(profile)
    ? { width: Math.round(scaled.width), height: Math.round(scaled.height) }
    : referenceImageSize(mode, scaled);
}

/**
 * The size a video framed by its first frame (`aspectPolicy` "reference") draws at: frameSize of the
 * staged start frame. Null where the run keeps its asked size: an image, a profile with manual
 * framing, no sized start frame, or a frame that only guides (`referenceRole` "reference").
 */
export function startFrameSize(profile, body) {
  if (body.kind !== "video" || profile?.aspectPolicy !== "reference") return null;
  if (body.referenceRole === "reference") return null;
  const slot =
    profile.mediaInputs?.find((item) => item.role === "start") || profile.mediaInputs?.[0];
  const frame = body.referenceAssets?.find((asset) => asset.slot === slot?.id);
  return frame?.width > 0 && frame?.height > 0
    ? frameSize(profile, frame.width, frame.height)
    : null;
}

/**
 * The video profile that animates an image when the user named none. `where` picks the pool: `auto`
 * takes the `prefer`red pool (`local` unless asked) while it can run, otherwise the other, with a
 * `note` saying so; `local` and `cloud` (MCP's `runs_on`) take only their own pool and refuse
 * without it. It never waits on a stopped worker. In a pool the account's own default for that side
 * (`preferred.cloud` or `preferred.local`) wins where it can animate; otherwise profiles that take
 * a first frame come first, and among them `tier` (Fast unless asked) takes its nearest tier with a
 * profile, preferring the account's default family. `offers` says which of Animate's Cloud and
 * Local the account has, also on a refusal (a stopped local pool included, so picking it says why
 * it can't run). `profiles` are the account's own. Given the image's `width` and `height`, the
 * choice carries the video's `size` (frameSize).
 */
export function animateProfile(
  profiles,
  {
    defaultId,
    profileId,
    preferRadiance = false,
    localRunning,
    localParked = false,
    tier = "fast",
    preferred = {},
    where = "auto",
    prefer = "local",
    width,
    height,
  },
) {
  // A parked worker was stopped on purpose; say so rather than call it not running.
  const notRunning = localParked ? "Local video is stopped" : "Local video isn't running";
  const usable = profiles.filter(
    (profile) => profile.kind === "video" && profile.ready !== false && profile.mediaInputs?.length,
  );
  const local = usable.filter(
    (profile) => !isCloudProfile(profile) && !["offline", "parked"].includes(profile.availability),
  );
  const grok = usable.filter(isCloudProfile);
  const pick = (pool, wanted) => {
    const frames = pool.filter(takesFirstFrame);
    const framed = frames.length ? frames : pool;
    const radiance = preferRadiance
      ? framed.filter((profile) => profile.backend === "radiance")
      : [];
    const candidates = radiance.length ? radiance : framed;
    return chooseProfile(candidates, {
      kind: "video",
      tier: tierDistance[wanted].find((item) => candidates.some((p) => tierOf(p) === item)),
      references: 1,
      defaultId,
    });
  };
  const anyLocal = usable.filter((profile) => !isCloudProfile(profile));
  const offers = { cloud: grok.length > 0, local: anyLocal.length > 0 };
  const refuse = (message) => {
    throw Object.assign(new Error(message), { offers });
  };
  if (profileId) {
    const profile = usable.find((item) => item.id === profileId);
    if (!profile) refuse("This video model is unavailable for animation.");
    return withSize(
      { profile, tier: tierOf(profile), cloud: isCloudProfile(profile), offers },
      width,
      height,
    );
  }
  const choose = (pool) => {
    const own = preferred[isCloudProfile(pool[0]) ? "cloud" : "local"];
    const profile = pool.find((item) => item.id === own) || pick(pool, tier);
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
    refuse(anyLocal.length ? `${notRunning}.` : "No local video model can animate images.");
  if (!grok.length)
    refuse(
      where === "cloud"
        ? "Cloud video isn't available to this account."
        : localRunning
          ? "No video model can animate images."
          : `${notRunning} and cloud video isn't available to this account.`,
    );
  const label = choose(grok).profile.label || choose(grok).profile.id;
  return cloudChoice(
    where === "cloud"
      ? ""
      : localRunning
        ? `No local video model can animate images, so this runs on ${label}.`
        : `${notRunning}, so this runs on ${label}.`,
  );
}
/** The single input Dream can fill from a still or from the end of a video. */
export function dreamVideoSlot(profile) {
  const inputs = profile.mediaInputs || [];
  const first = inputs[0];
  const slot =
    inputs.find((input) => input.role === "start") ||
    (first && (!first.role || first.role === "reference") ? first : undefined);
  return slot && !inputs.some((input) => input !== slot && input.required) ? slot : undefined;
}

/**
 * Dream's video profile on its selected side: an extension stays on its source's model; otherwise
 * `choose` draws one of the ready profiles that take a still (Dream weighs them by keep rate and
 * turns away from the last one), or the account's default without it.
 */
export function dreamVideoProfile(profiles, options) {
  const { backend, extend, unavailable, choose, width, height, allowUncensored, defaultId } =
    options;
  if (backend !== "cloud" && options.localRunning === false)
    throw new Error(options.localParked ? "Local video is stopped." : "Local video isn't running.");
  const pool = profiles.filter(
    (profile) =>
      profile.kind === "video" &&
      (allowUncensored !== false || !uncensoredDreamProfile(profile)) &&
      isCloudProfile(profile) === (backend === "cloud") &&
      profile.ready !== false &&
      !["offline", "parked"].includes(profile.availability) &&
      dreamVideoSlot(profile),
  );
  if (!pool.length)
    throw new Error(
      backend === "cloud"
        ? "Cloud video isn't available to this account."
        : "No local video model can animate images.",
    );
  const candidates = extend ? pool.filter((profile) => profile.id === extend) : pool;
  if (extend && !candidates.length) throw new Error("The source video's model isn't ready.");
  const healthy = candidates.filter((profile) => !unavailable.has(profile.id));
  if (!healthy.length) {
    const [profile] = candidates;
    throw new Error(
      `Dream's last video on ${profile.label || profile.id} failed; it waits to try again.`,
    );
  }
  const profile =
    (!extend && choose?.(healthy)) || healthy.find((item) => item.id === defaultId) || healthy[0];
  return withSize({ profile, frames: dreamFrames(profile, options.seconds) }, width, height);
}

/**
 * Dream's clips run `seconds` long, else 5 to 8 seconds: the profile's own length when it falls
 * there, else the nearest its frame grid allows.
 */
export function dreamFrames(profile, seconds = 0) {
  const fps = Number(profile.defaults?.fps);
  const frames = Number(profile.defaults?.frames);
  const grid = profile.constraints?.frames;
  if (!(fps > 0 && frames > 0) || !grid?.step) return undefined;
  const { min = 1, max = Infinity, step, offset = 0 } = grid;
  if (seconds > 0) {
    const nearest = offset + Math.round((seconds * fps - offset) / step) * step;
    return Math.max(min, Math.min(max, nearest));
  }
  const length = frames / fps;
  if (length >= 5 && length <= 8) return frames;
  const target = (length < 5 ? 5 : 8) * fps;
  const steps = (length < 5 ? Math.ceil : Math.floor)((target - offset) / step);
  const fitted = Math.max(min, Math.min(max, offset + steps * step));
  return (fitted - offset) % step ? frames : fitted;
}
const withSize = (choice, width, height) =>
  width > 0 && height > 0 ? { ...choice, size: frameSize(choice.profile, width, height) } : choice;

/** An unpinned run may pick any of the combined profile's backends. */
export function uncensoredDreamProfile(profile) {
  return Boolean(
    profile.uncensored || profile.backendOptions?.some(({ profile }) => profile?.uncensored),
  );
}
