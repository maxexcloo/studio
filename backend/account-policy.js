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
 * Its own prompt ideas, suggestions and proposed changes are worded explicitly only with
 * `explicitWording`.
 * `allModels` grants every local profile, including ones added later.
 *
 * Any account may turn the Cloud Models, LoRAs and Uncensored Models it has off for itself
 * (account-preferences.js); its effective features are then off everywhere they apply. For an
 * administrator this narrows only its own use: administration (profile and catalogue editing, the
 * Library) does not go through these checks.
 */
import { isCloudProfile } from "./cloud-profiles.js";
import { canonicalProfileId } from "./profile/store.js";

export const accountRoles = Object.freeze({ administrator: "administrator", user: "user" });

/**
 * What varies between groups beyond their models. Everything else (generation, references, the
 * gallery, prompt history and upscaling) comes with an account. Prompt Assistant gates every text
 * the assistant writes for a person (Improve, Ask for a Change, Suggestions, prompt ideas, Animate's
 * themes, negative and LoRA suggestions, suggested prompts); Chat gates only Studio Chat.
 */
export const accessFeatures = Object.freeze([
  "chat",
  "cloudModels",
  "dream",
  "loras",
  "promptAssistant",
  "uncensoredModels",
]);
// On unless a group turns them off, so groups saved before these existed keep them.
const defaultOnFeatures = new Set(["chat", "dream", "promptAssistant"]);

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

/** Features an account may turn off for itself, among those its role or group grants. */
export const personalFeatures = Object.freeze(["cloudModels", "loras", "uncensoredModels"]);
const narrowed = (features, preferences) => ({
  ...features,
  ...Object.fromEntries(
    personalFeatures.map((feature) => [
      feature,
      features[feature] && preferences[feature] !== false,
    ]),
  ),
});

export function effectiveAccountAccess(
  account,
  profiles,
  availableProfiles = null,
  preferences = {},
) {
  if (!account || account.disabled === true)
    return { authenticated: false, reason: account ? "disabled" : "anonymous" };
  if (account.role === accountRoles.administrator) {
    return {
      authenticated: true,
      userId: account.id,
      role: accountRoles.administrator,
      generationProfiles: [...new Set(availableProfiles || [])],
      features: narrowed(
        Object.fromEntries(accessFeatures.map((feature) => [feature, true])),
        preferences,
      ),
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
    features: narrowed(safe.features, preferences),
  };
}

/**
 * Pass the profile itself (its id, family and `uncensored` marker) so cloud and uncensored profiles follow
 * their features; a bare id is checked as an unmarked local profile.
 */
export function mayUseGenerationProfile(access, profile) {
  if (!access?.authenticated) return false;
  const id = typeof profile === "string" ? profile : profile?.id;
  if (
    typeof profile === "object" &&
    profile?.uncensored === true &&
    access.features.uncensoredModels !== true
  )
    return false;
  const cloud = isCloudProfile(typeof profile === "string" ? { id: profile } : profile);
  if (access.role === accountRoles.administrator) return !cloud || access.features.cloudModels;
  // An AI-drafted profile is live for administrators only until one approves it.
  if (typeof profile === "object" && profile?.aiDrafted === true) return false;
  if (cloud) return access.features.cloudModels === true;
  return access.allModels === true || access.generationProfiles.includes(id);
}

/** An administrator that hasn't turned anything off for itself, so every profile check would pass. */
export function hasFullAccess(access) {
  return (
    access?.role === accountRoles.administrator &&
    accessFeatures.every((feature) => access.features?.[feature] === true)
  );
}

export function mayUseFeature(access, feature) {
  return Boolean(access?.authenticated && access.features?.[feature] === true);
}

/**
 * Whether the assistant may word what it offers unasked (prompt ideas, next steps, proposed
 * changes) explicitly: the account's Spicy Prompts preference on and Uncensored Models in its
 * effective access. `access` is undefined only in single-user mode, which has every feature.
 */
export const explicitWording = (access, preferences) =>
  preferences.spicyPrompts === true &&
  (access === undefined || mayUseFeature(access, "uncensoredModels"));

export function visibleGenerationProfiles(profiles, access) {
  if (!access?.authenticated) return [];
  return profiles.filter((profile) => mayUseGenerationProfile(access, profile));
}

/**
 * The User access profile Studio adds when absent, the default for new accounts until an
 * administrator picks another: every local model except uncensored ones, Chat, Dream and the prompt
 * assistant, no cloud models and no LoRAs. Once added it is an ordinary access profile. Administrators have full access
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
