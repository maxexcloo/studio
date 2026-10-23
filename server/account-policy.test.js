import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInAccessProfiles,
  effectiveAccountAccess,
  mayUseFeature,
  mayUseGenerationProfile,
  migrateCloudModels,
  normaliseAccessProfile,
  validAccountKey,
  visibleGenerationProfiles,
} from "./account-policy.js";

const available = ["image-fast", "image-quality", "video"];

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
        // Unmarked profiles predate NSFW Models, so it stays on until it is stored.
        nsfwModels: true,
        presets: false,
        // Prompt Assistant arrived on for every existing profile.
        promptAssistant: true,
      },
    },
  );
});

test("Prompt Assistant is on for built-ins and stored profiles until an administrator turns it off", () => {
  assert.equal(
    builtInAccessProfiles.every((profile) => profile.features.promptAssistant === true),
    true,
  );
  const stored = {
    id: "artists",
    name: "Artists",
    generationProfiles: [],
    features: { imageGeneration: true },
  };
  const user = { id: "u1", role: "user", accessProfileId: "artists" };
  assert.equal(
    mayUseFeature(effectiveAccountAccess(user, { artists: stored }), "promptAssistant"),
    true,
  );
  assert.equal(
    mayUseFeature(
      effectiveAccountAccess(user, {
        artists: { ...stored, features: { ...stored.features, promptAssistant: false } },
      }),
      "promptAssistant",
    ),
    false,
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

test("an access profile stored before Cloud Models keeps its old cloud grants until it is settled", () => {
  const grokVideo = { id: "custom:grok-video", family: "grok" };
  const grokImage = { id: "custom:grok-image", family: "grok" };
  const legacy = {
    name: "Old",
    generationProfiles: ["image-fast", "custom:grok-video"],
    features: { imageGeneration: true, videoGeneration: true },
  };
  const access = effectiveAccountAccess(
    { id: "a", role: "user", accessProfileId: "old" },
    { old: legacy },
  );
  assert.equal(mayUseGenerationProfile(access, grokVideo), true);
  assert.equal(mayUseGenerationProfile(access, grokImage), false);

  const settled = migrateCloudModels(legacy, ["custom:grok-video", "custom:grok-image"]);
  assert.equal(settled.features.cloudModels, true);
  assert.deepEqual(settled.generationProfiles, ["image-fast"]);
  assert.deepEqual(settled.retiredCloudGrants, ["custom:grok-video"]);
  const after = effectiveAccountAccess(
    { id: "a", role: "user", accessProfileId: "old" },
    { old: settled },
  );
  assert.equal(
    mayUseGenerationProfile(after, grokImage),
    true,
    "Cloud Models grants every cloud profile",
  );
  assert.equal(
    normaliseAccessProfile(settled).retiredCloudGrants[0],
    "custom:grok-video",
    "the old grants stay on record",
  );

  const none = migrateCloudModels(
    { name: "Local", generationProfiles: ["image-fast"], features: {} },
    ["custom:grok-video"],
  );
  assert.equal(none.features.cloudModels, false);
  assert.equal(none.retiredCloudGrants, undefined);
  assert.equal(
    migrateCloudModels(legacy, []),
    legacy,
    "without a known cloud profile nothing is settled",
  );
  assert.equal(
    migrateCloudModels(settled, ["custom:grok-video"]),
    settled,
    "a settled profile stays as it is",
  );
});

test("NSFW profiles need NSFW Models and All Models grants every local profile", () => {
  const nsfw = { id: "image-spicy", nsfw: true };
  const plain = { id: "image-plain" };
  const grok = { id: "grok-image", family: "grok" };
  const [administrator, user] = builtInAccessProfiles;
  const profiles = {
    administrator,
    user,
    granted: {
      name: "Granted",
      generationProfiles: ["image-spicy"],
      features: { nsfwModels: false },
    },
  };
  const as = (id) => effectiveAccountAccess({ id, role: "user", accessProfileId: id }, profiles);
  assert.deepEqual(visibleGenerationProfiles([nsfw, plain, grok], as("administrator")), [
    nsfw,
    plain,
    grok,
  ]);
  assert.deepEqual(visibleGenerationProfiles([nsfw, plain, grok], as("user")), [plain]);
  assert.equal(mayUseFeature(as("user"), "loras"), false);
  assert.equal(
    mayUseGenerationProfile(as("granted"), nsfw),
    false,
    "a grant alone does not open an NSFW profile",
  );
  const admin = effectiveAccountAccess({ id: "admin", role: "administrator" }, {});
  assert.equal(mayUseGenerationProfile(admin, nsfw), true);
});
