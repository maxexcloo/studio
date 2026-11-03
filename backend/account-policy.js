/**
 * Pure account and access-profile policy shared by the account store and routes.
 * Keep identifiers server-owned: request payloads may name a profile, never a
 * user ID or storage path.
 *
 * Cloud (provider-backed) profiles are not granted one by one: the Cloud Models
 * feature grants them all.
 *
 * A generation profile marked `uncensored` needs the Uncensored Models feature on top of its
 * grant. The prompt assistant's Spicy preset needs Uncensored Models too, whatever profile is selected.
 * `allModels` grants every local profile, including ones added later.
 */
import { isCloudProfile } from "./cloud-profiles.js";
import { canonicalProfileId } from "./profile/store.js";

export { isCloudProfile };

export const accountRoles = Object.freeze({ administrator: "administrator", user: "user" });

/**
 * What varies between groups beyond their models. Everything else (generation, references, the
 * gallery, prompt history, upscaling and the prompt assistant) comes with an account.
 */
export const accessFeatures = Object.freeze([
  "chat",
  "cloudModels",
  "dream",
  "loras",
  "uncensoredModels",
]);
// On unless a group turns them off, so groups saved before these existed keep them.
const defaultOnFeatures = new Set(["chat", "dream"]);

const keyPattern = /^[a-z0-9][a-z0-9:-]{0,127}$/;

export function validAccountKey(value) {
  return typeof value === "string" && keyPattern.test(value);
}

/** Without an availability list, keep the stored grants: discovery and execution recheck each profile. */
export function normaliseAccessProfile(profile, availableProfiles = null) {
  const names = Array.isArray(availableProfiles)
    ? new Set(availableProfiles.filter((name) => typeof name === "string" && name.trim()))
    : null;
  const usable = (name) =>
    typeof name === "string" && name.trim() && name.length <= 256 && (!names || names.has(name));
  const selected = Array.isArray(profile?.generationProfiles)
    ? [...new Set(profile.generationProfiles.filter(usable))]
    : [];
  const features = Object.fromEntries(
    accessFeatures.map((feature) => [
      feature,
      defaultOnFeatures.has(feature)
        ? profile?.features?.[feature] !== false
        : profile?.features?.[feature] === true,
    ]),
  );
  return {
    id: validAccountKey(profile?.id) ? profile.id : "",
    name: String(profile?.name || "")
      .trim()
      .slice(0, 80),
    generationProfiles: selected,
    allModels: profile?.allModels === true,
    features,
  };
}

export function effectiveAccountAccess(account, profiles, availableProfiles = null) {
  if (!account || account.disabled === true)
    return { authenticated: false, reason: account ? "disabled" : "anonymous" };
  if (account.role === accountRoles.administrator) {
    return {
      authenticated: true,
      userId: account.id,
      role: accountRoles.administrator,
      generationProfiles: [...new Set(availableProfiles || [])],
      features: Object.fromEntries(accessFeatures.map((feature) => [feature, true])),
    };
  }
  const profile = profiles?.[account.accessProfileId];
  if (!profile) return { authenticated: false, reason: "profile-unassigned" };
  const safe = normaliseAccessProfile(
    {
      ...profile,
      id: account.accessProfileId,
      // A grant of a merged profile grants the profile it became (profile/merge.js).
      ...(Array.isArray(profile.generationProfiles)
        ? { generationProfiles: profile.generationProfiles.map(canonicalProfileId) }
        : {}),
    },
    availableProfiles,
  );
  return {
    authenticated: true,
    userId: account.id,
    role: accountRoles.user,
    generationProfiles: safe.generationProfiles,
    allModels: safe.allModels,
    features: safe.features,
  };
}

/**
 * Pass the profile itself (its id, family and `uncensored` marker) so cloud and uncensored profiles follow
 * their features; a bare id is checked as an unmarked local profile.
 */
export function mayUseGenerationProfile(access, profile) {
  if (!access?.authenticated) return false;
  if (access.role === accountRoles.administrator) return true;
  const id = typeof profile === "string" ? profile : profile?.id;
  if (
    typeof profile === "object" &&
    profile?.uncensored === true &&
    access.features.uncensoredModels !== true
  )
    return false;
  // An AI-drafted profile is live for administrators only until one approves it.
  if (typeof profile === "object" && profile?.aiDrafted === true) return false;
  if (isCloudProfile(typeof profile === "string" ? { id: profile } : profile))
    return access.features.cloudModels === true;
  return access.allModels === true || access.generationProfiles.includes(id);
}

export function mayUseFeature(access, feature) {
  return Boolean(
    access?.authenticated &&
    (access.role === accountRoles.administrator || access.features[feature] === true),
  );
}

export function visibleGenerationProfiles(profiles, access) {
  if (!access?.authenticated) return [];
  if (access.role === accountRoles.administrator) return profiles;
  return profiles.filter((profile) => mayUseGenerationProfile(access, profile));
}

/**
 * The User access profile Studio adds when absent, the default for new accounts until an
 * administrator picks another: every local model except uncensored ones, Chat and Dream, no cloud
 * models and no LoRAs. Once added it is an ordinary access profile. Administrators have full access
 * by role.
 */
export const builtInAccessProfile = Object.freeze({
  id: "user",
  name: "User",
  generationProfiles: [],
  allModels: true,
  features: Object.fromEntries(
    accessFeatures.map((feature) => [feature, defaultOnFeatures.has(feature)]),
  ),
});
