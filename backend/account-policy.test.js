import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInAccessProfile,
  effectiveAccountAccess,
  mayUseFeature,
  mayUseGenerationProfile,
  normaliseAccessProfile,
  validAccountKey,
  visibleGenerationProfiles,
} from "./account-policy.js";

const available = ["image-fast", "image-quality", "video"];

test("direct provider profiles enforce Cloud Models and uncensored grants even with neutral profile IDs", () => {
  const profile = {
    id: "custom:neutral-provider",
    family: "custom",
    provider: "cliproxyapi",
    uncensored: true,
  };
  const user = { id: "artist", role: "user", accessProfileId: "artists" };
  const access = (cloudModels, uncensoredModels) =>
    effectiveAccountAccess(user, {
      artists: {
        id: "artists",
        name: "Artists",
        allModels: true,
        features: { cloudModels, uncensoredModels, imageGeneration: true },
      },
    });
  assert.equal(mayUseGenerationProfile(access(false, true), profile), false);
  assert.equal(mayUseGenerationProfile(access(true, false), profile), false);
  assert.equal(mayUseGenerationProfile(access(true, true), profile), true);
  assert.equal(
    mayUseGenerationProfile(
      effectiveAccountAccess({ id: "admin", role: "administrator" }, {}),
      profile,
    ),
    true,
  );
});

test("account keys accept only bounded server-safe identifiers", () => {
  assert.equal(validAccountKey("user-23"), true);
  assert.equal(validAccountKey("custom:portrait-mode"), true);
  for (const value of ["", "../user", "User", "a/b", "a".repeat(129), null])
    assert.equal(validAccountKey(value), false);
});

test("access profiles contain only currently available generation profiles and known feature switches", () => {
  assert.deepEqual(
    normaliseAccessProfile(
      {
        id: "artists",
        name: " Artists ",
        generationProfiles: ["image-fast", "unapproved", "image-fast", 3],
        features: { loras: true, admin: true, unknown: true },
      },
      available,
    ),
    {
      id: "artists",
      name: "Artists",
      generationProfiles: ["image-fast"],
      allModels: false,
      features: {
        loras: true,
        imageGeneration: false,
        videoGeneration: false,
        imageReferences: false,
        videoReferences: false,
        gallery: false,
        promptHistory: false,
        cloudModels: false,
        uncensoredModels: false,
        presets: false,
        promptAssistant: false,
        upscale: false,
      },
    },
  );
});

test("Prompt Assistant is on for built-ins and follows each stored profile", () => {
  assert.equal(builtInAccessProfile.features.promptAssistant, true);
  assert.equal(builtInAccessProfile.features.upscale, true);
  const stored = {
    id: "artists",
    name: "Artists",
    generationProfiles: [],
    features: { imageGeneration: true },
  };
  const user = { id: "u1", role: "user", accessProfileId: "artists" };
  assert.equal(
    mayUseFeature(effectiveAccountAccess(user, { artists: stored }), "promptAssistant"),
    false,
  );
  assert.equal(
    mayUseFeature(
      effectiveAccountAccess(user, {
        artists: { ...stored, features: { ...stored.features, promptAssistant: true } },
      }),
      "promptAssistant",
    ),
    true,
  );
  assert.equal(
    mayUseFeature(
      effectiveAccountAccess({ id: "a1", role: "administrator" }, {}),
      "promptAssistant",
    ),
    true,
  );
});

test("administrators receive current full access and ordinary users receive one assigned profile", () => {
  const profiles = {
    artists: {
      name: "Artists",
      generationProfiles: ["image-fast"],
      features: { loras: true, gallery: true },
    },
  };
  const admin = effectiveAccountAccess({ id: "admin", role: "administrator" }, profiles, available);
  assert.equal(mayUseGenerationProfile(admin, "video"), true);

  const user = effectiveAccountAccess(
    { id: "user-1", role: "user", accessProfileId: "artists" },
    profiles,
    available,
  );
  assert.equal(user.userId, "user-1");
  assert.equal(mayUseGenerationProfile(user, "image-fast"), true);
  assert.equal(mayUseGenerationProfile(user, "image-quality"), false);
  assert.equal(mayUseFeature(user, "loras"), true);
  assert.deepEqual(
    visibleGenerationProfiles(
      available.map((id) => ({ id })),
      user,
    ),
    [{ id: "image-fast" }],
  );
});

test("disabled, unknown-role, and unassigned accounts do not authenticate", () => {
  assert.equal(
    effectiveAccountAccess({ id: "disabled", role: "user", disabled: true }, {}).authenticated,
    false,
  );
  assert.equal(
    effectiveAccountAccess({ id: "unassigned", role: "user" }, {}).reason,
    "profile-unassigned",
  );
  assert.equal(effectiveAccountAccess({ id: "unknown", role: "owner" }, {}).authenticated, false);
});

test("cloud profiles follow the Cloud Models feature, never a grant of their own", () => {
  const grok = { id: "custom:grok-video", family: "grok", kind: "video" };
  const local = { id: "image-fast", family: "flux" };
  const profiles = {
    on: {
      name: "On",
      generationProfiles: ["image-fast"],
      features: { imageGeneration: true, cloudModels: true },
    },
    off: {
      name: "Off",
      generationProfiles: ["image-fast", "custom:grok-video"],
      features: { imageGeneration: true, cloudModels: false },
    },
  };
  const on = effectiveAccountAccess({ id: "a", role: "user", accessProfileId: "on" }, profiles);
  const off = effectiveAccountAccess({ id: "b", role: "user", accessProfileId: "off" }, profiles);
  assert.equal(mayUseGenerationProfile(on, grok), true);
  assert.equal(
    mayUseGenerationProfile(off, grok),
    false,
    "a stray grant does not open a cloud profile",
  );
  assert.equal(mayUseGenerationProfile(off, local), true);
  assert.deepEqual(visibleGenerationProfiles([grok, local], on), [grok, local]);
  assert.deepEqual(visibleGenerationProfiles([grok, local], off), [local]);
  const admin = effectiveAccountAccess({ id: "admin", role: "administrator" }, profiles);
  assert.equal(mayUseGenerationProfile(admin, grok), true);
  assert.equal(mayUseFeature(admin, "cloudModels"), true);
});

test("uncensored profiles need Uncensored Models and All Models grants every local profile", () => {
  const uncensored = { id: "image-spicy", uncensored: true };
  const plain = { id: "image-plain" };
  const grok = { id: "grok-image", family: "grok" };
  const user = builtInAccessProfile;
  const profiles = {
    everything: {
      ...user,
      features: { ...user.features, cloudModels: true, uncensoredModels: true },
    },
    user,
    granted: {
      name: "Granted",
      generationProfiles: ["image-spicy"],
      features: { uncensoredModels: false },
    },
  };
  const as = (id) => effectiveAccountAccess({ id, role: "user", accessProfileId: id }, profiles);
  assert.deepEqual(visibleGenerationProfiles([uncensored, plain, grok], as("everything")), [
    uncensored,
    plain,
    grok,
  ]);
  assert.deepEqual(visibleGenerationProfiles([uncensored, plain, grok], as("user")), [plain]);
  assert.equal(mayUseFeature(as("user"), "loras"), false);
  assert.equal(
    mayUseGenerationProfile(as("granted"), uncensored),
    false,
    "a grant alone does not open an uncensored profile",
  );
  const admin = effectiveAccountAccess({ id: "admin", role: "administrator" }, {});
  assert.equal(mayUseGenerationProfile(admin, uncensored), true);
});
