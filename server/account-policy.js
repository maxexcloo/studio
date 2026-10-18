/**
 * Pure account and access-profile policy shared by the account store and routes.
 * Keep identifiers server-owned: request payloads may name a profile, never a
 * user ID or storage path.
 */

export const accountRoles = Object.freeze({ administrator: "administrator", user: "user" });

export const accessFeatures = Object.freeze([
  "loras",
  "imageGeneration",
  "videoGeneration",
  "imageReferences",
  "videoReferences",
  "gallery",
  "promptHistory"
]);

const keyPattern = /^[a-z0-9][a-z0-9:-]{0,127}$/;

export function validAccountKey(value) {
  return typeof value === "string" && keyPattern.test(value);
}

export function normaliseAccessProfile(profile, availableProfiles = []) {
  const names = new Set(availableProfiles.filter((name) => typeof name === "string" && name.trim()));
  const selected = Array.isArray(profile?.generationProfiles)
    ? [...new Set(profile.generationProfiles.filter((name) => names.has(name)))]
    : [];
  const features = Object.fromEntries(accessFeatures.map((feature) => [feature, profile?.features?.[feature] === true]));
  return {
    id: validAccountKey(profile?.id) ? profile.id : "",
    name: String(profile?.name || "").trim().slice(0, 80),
    generationProfiles: selected,
    features
  };
}

export function effectiveAccountAccess(account, profiles, availableProfiles = []) {
  if (!account || account.disabled === true) return { authenticated: false, reason: account ? "disabled" : "anonymous" };
  if (account.role === accountRoles.administrator) {
    return {
      authenticated: true,
      userId: account.id,
      role: accountRoles.administrator,
      generationProfiles: [...new Set(availableProfiles)],
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
    features: safe.features
  };
}

export function mayUseGenerationProfile(access, profileId) {
  return Boolean(access?.authenticated && (access.role === accountRoles.administrator || access.generationProfiles.includes(profileId)));
}

export function mayUseFeature(access, feature) {
  return Boolean(access?.authenticated && (access.role === accountRoles.administrator || access.features[feature] === true));
}

export function visibleGenerationProfiles(profiles, access) {
  if (!access?.authenticated) return [];
  if (access.role === accountRoles.administrator) return profiles;
  return profiles.filter((profile) => mayUseGenerationProfile(access, profile.id));
}
