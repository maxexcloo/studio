import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAccountAccess, mayUseFeature, mayUseGenerationProfile, normaliseAccessProfile, validAccountKey, visibleGenerationProfiles } from "./account-policy.js";

const available = ["image-fast", "image-quality", "video"];

test("account keys accept only bounded server-safe identifiers", () => {
  assert.equal(validAccountKey("user-23"), true);
  assert.equal(validAccountKey("custom:portrait-mode"), true);
  for (const value of ["", "../user", "User", "a/b", "a".repeat(129), null]) assert.equal(validAccountKey(value), false);
});

test("access profiles contain only currently available generation profiles and known feature switches", () => {
  assert.deepEqual(normaliseAccessProfile({
    id: "artists",
    name: " Artists ",
    generationProfiles: ["image-fast", "unapproved", "image-fast", 3],
    features: { loras: true, admin: true, unknown: true }
  }, available), {
    id: "artists",
    name: "Artists",
    generationProfiles: ["image-fast"],
    features: {
      loras: true,
      imageGeneration: false,
      videoGeneration: false,
      imageReferences: false,
      videoReferences: false,
      gallery: false,
      promptHistory: false
    }
  });
});

test("administrators receive current full access and ordinary users receive one assigned profile", () => {
  const profiles = { artists: { name: "Artists", generationProfiles: ["image-fast"], features: { loras: true, gallery: true } } };
  const admin = effectiveAccountAccess({ id: "admin", role: "administrator" }, profiles, available);
  assert.equal(mayUseGenerationProfile(admin, "video"), true);

  const user = effectiveAccountAccess({ id: "user-1", role: "user", accessProfileId: "artists" }, profiles, available);
  assert.equal(user.userId, "user-1");
  assert.equal(mayUseGenerationProfile(user, "image-fast"), true);
  assert.equal(mayUseGenerationProfile(user, "image-quality"), false);
  assert.equal(mayUseFeature(user, "loras"), true);
  assert.deepEqual(visibleGenerationProfiles(available.map((id) => ({ id })), user), [{ id: "image-fast" }]);
});

test("disabled, unknown-role, and unassigned accounts do not authenticate", () => {
  assert.equal(effectiveAccountAccess({ id: "disabled", role: "user", disabled: true }, {}).authenticated, false);
  assert.equal(effectiveAccountAccess({ id: "unassigned", role: "user" }, {}).reason, "profile-unassigned");
  assert.equal(effectiveAccountAccess({ id: "unknown", role: "owner" }, {}).authenticated, false);
});
