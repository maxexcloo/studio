/**
 * Pure account and access-profile policy shared by the account store and routes.
 * Keep identifiers server-owned: request payloads may name a profile, never a
 * user ID or storage path.
 *
 * Cloud (provider-backed) profiles are not granted one by one: the Cloud Models
 * feature grants them all. An access profile stored before that feature existed
 * has no `cloudModels` value; until `migrateCloudModels` settles it from the
 * discovered catalogue, it keeps exactly its old cloud grants.
 *
 * A generation profile marked `nsfw` needs the NSFW Models feature on top of its
 * grant. Profiles stored before that feature keep it on, as nothing was marked then.
 * `allModels` grants every local profile, including ones added later.
 */
import { isCloudProfile } from "./cloud-profiles.js";

export { isCloudProfile };

export const accountRoles = Object.freeze({ administrator: "administrator", user: "user" });

export const accessFeatures = Object.freeze([
  "loras",
  "imageGeneration",
  "videoGeneration",
  "imageReferences",
  "videoReferences",
  "gallery",
  "promptHistory",
  "cloudModels",
  "nsfwModels",
  "presets"
]);

/** Features that default on when a stored access profile has no value for them. */
const onUnlessStored = new Set(["nsfwModels"]);

const keyPattern = /^[a-z0-9][a-z0-9:-]{0,127}$/;

export function validAccountKey(value) {
  return typeof value === "string" && keyPattern.test(value);
}

/** Without an availability list, keep the stored grants: discovery and execution recheck each profile. */
export function normaliseAccessProfile(profile, availableProfiles = null) {
  const names = Array.isArray(availableProfiles) ? new Set(availableProfiles.filter((name) => typeof name === "string" && name.trim())) : null;
  const usable = (name) => typeof name === "string" && name.trim() && name.length <= 256 && (!names || names.has(name));
  const selected = Array.isArray(profile?.generationProfiles)
    ? [...new Set(profile.generationProfiles.filter(usable))]
    : [];
  const features = Object.fromEntries(accessFeatures.map((feature) => [feature, onUnlessStored.has(feature) ? profile?.features?.[feature] !== false : profile?.features?.[feature] === true]));
  const retired = Array.isArray(profile?.retiredCloudGrants) ? [...new Set(profile.retiredCloudGrants.filter((name) => typeof name === "string" && name.trim() && name.length <= 256))] : [];
  return {
    id: validAccountKey(profile?.id) ? profile.id : "",
    name: String(profile?.name || "").trim().slice(0, 80),
    generationProfiles: selected,
    allModels: profile?.allModels === true,
    features,
    ...(retired.length ? { retiredCloudGrants: retired } : {})
  };
}

/** Whether a stored access profile predates the Cloud Models feature. */
export const predatesCloudModels = (profile) => typeof profile?.features?.cloudModels !== "boolean";

/**
 * Settles Cloud Models on an access profile that predates it: on when it granted any cloud
 * profile. Those grants move from `generationProfiles` to `retiredCloudGrants`, kept as a
 * record that no longer grants anything. Returns the profile unchanged when there is nothing
 * to settle, or when no cloud profile is known to settle it against.
 */
export function migrateCloudModels(profile, cloudProfiles = []) {
  const cloud = new Set(cloudProfiles);
  if (!predatesCloudModels(profile) || !cloud.size) return profile;
  const grants = Array.isArray(profile?.generationProfiles) ? profile.generationProfiles : [];
  const retired = grants.filter((id) => cloud.has(id));
  return {
    ...profile,
    generationProfiles: grants.filter((id) => !cloud.has(id)),
    features: { ...(profile?.features || {}), cloudModels: retired.length > 0 },
    ...(retired.length ? { retiredCloudGrants: [...new Set([...(profile.retiredCloudGrants || []), ...retired])] } : {})
  };
}

export function effectiveAccountAccess(account, profiles, availableProfiles = null) {
  if (!account || account.disabled === true) return { authenticated: false, reason: account ? "disabled" : "anonymous" };
  if (account.role === accountRoles.administrator) {
    return {
      authenticated: true,
      userId: account.id,
      role: accountRoles.administrator,
      generationProfiles: [...new Set(availableProfiles || [])],
      features: Object.fromEntries(accessFeatures.map((feature) => [feature, true]))
    };
  }
  const profile = profiles?.[account.accessProfileId];
  if (!profile) return { authenticated: false, reason: "profile-unassigned" };
  const safe = normaliseAccessProfile({ ...profile, id: account.accessProfileId }, availableProfiles);
  return {
    authenticated: true,
    userId: account.id,
    role: accountRoles.user,
    generationProfiles: safe.generationProfiles,
    allModels: safe.allModels,
    features: safe.features,
    // Not yet settled: a cloud profile still needs its own grant, as before.
    ...(predatesCloudModels(profile) ? { legacyCloudGrants: true } : {})
  };
}

/**
 * Pass the profile itself (its id, family and `nsfw` marker) so cloud and NSFW profiles follow
 * their features; a bare id is checked as an unmarked local profile.
 */
export function mayUseGenerationProfile(access, profile) {
  if (!access?.authenticated) return false;
  if (access.role === accountRoles.administrator) return true;
  const id = typeof profile === "string" ? profile : profile?.id;
  if (typeof profile === "object" && profile?.nsfw === true && access.features.nsfwModels !== true) return false;
  if (isCloudProfile(typeof profile === "string" ? { id: profile } : profile)) {
    return access.legacyCloudGrants ? access.generationProfiles.includes(id) : access.features.cloudModels === true;
  }
  return access.allModels === true || access.generationProfiles.includes(id);
}

export function mayUseFeature(access, feature) {
  return Boolean(access?.authenticated && (access.role === accountRoles.administrator || access.features[feature] === true));
}

export function visibleGenerationProfiles(profiles, access) {
  if (!access?.authenticated) return [];
  if (access.role === accountRoles.administrator) return profiles;
  return profiles.filter((profile) => mayUseGenerationProfile(access, profile));
}

/**
 * The access profiles Studio adds when absent, so a default for new accounts is one choice
 * away. Administrator: everything. User: every local model except NSFW ones, no cloud
 * models, no LoRAs and no presets. Once added they are ordinary access profiles.
 */
export const builtInAccessProfiles = Object.freeze([
  { id: "administrator", name: "Administrator", generationProfiles: [], allModels: true, features: Object.fromEntries(accessFeatures.map((feature) => [feature, true])) },
  { id: "user", name: "User", generationProfiles: [], allModels: true, features: Object.fromEntries(accessFeatures.map((feature) => [feature, !["loras", "cloudModels", "nsfwModels", "presets"].includes(feature)])) }
]);

/**
 * Carries the old global LoRAs and Cloud Models switches into each access profile once:
 * a profile keeps a feature only where the switch had it on too, so nobody gains or loses
 * access when the switch goes. `globals` holds the switches' values at the time.
 */
export function migrateFeatureOptions(profile, globals = {}) {
  const features = { ...(profile?.features || {}) };
  let changed = false;
  if (globals.loras === false && features.loras !== false) { features.loras = false; changed = true; }
  // With cloud models switched off nobody had a cloud grant to keep, so this also settles the profile.
  if (globals.cloudModels === false && features.cloudModels !== false) { features.cloudModels = false; changed = true; }
  return changed ? { ...profile, features } : profile;
}
