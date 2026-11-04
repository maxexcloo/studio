import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInAccessProfile,
  effectiveAccountAccess,
  explicitWording,
  hasFullAccess,
  mayUseFeature,
  mayUseGenerationProfile,
  normaliseAccessProfile,
  validAccountKey,
  visibleGenerationProfiles,
} from "./account-policy.js";
import { createSuggestions } from "./domain/suggestions.ts";

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
        features: { cloudModels, uncensoredModels },
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
      // Chat and Dream stay on unless a group turns them off.
      features: {
        chat: true,
        cloudModels: false,
        dream: true,
        loras: true,
        uncensoredModels: false,
      },
    },
  );
});

test("the built-in User group has Chat and Dream but no cloud models, LoRAs or uncensored models, and administrators have every feature", () => {
  assert.deepEqual(builtInAccessProfile.features, {
    chat: true,
    cloudModels: false,
    dream: true,
    loras: false,
    uncensoredModels: false,
  });
  const admin = effectiveAccountAccess({ id: "a1", role: "administrator" }, {});
  assert.equal(mayUseFeature(admin, "loras"), true);
});

test("administrators receive current full access and ordinary users receive one assigned profile", () => {
  const profiles = {
    artists: {
      name: "Artists",
      generationProfiles: ["image-fast"],
      features: { loras: true },
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
      features: { cloudModels: true },
    },
    off: {
      name: "Off",
      generationProfiles: ["image-fast", "custom:grok-video"],
      features: { cloudModels: false },
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

test("an administrator that turns Cloud Models, LoRAs or Uncensored Models off loses them for its own use", () => {
  const grok = { id: "grok-image", family: "grok" };
  const spicy = { id: "image-spicy", uncensored: true };
  const drafted = { id: "image-draft", aiDrafted: true };
  const plain = { id: "image-plain" };
  const profiles = [grok, spicy, drafted, plain];
  const account = { id: "admin", role: "administrator" };
  const everything = effectiveAccountAccess(account, {}, null, { cloudModels: true });
  assert.equal(hasFullAccess(everything), true);
  assert.deepEqual(visibleGenerationProfiles(profiles, everything), profiles);
  const narrowed = effectiveAccountAccess(account, {}, null, {
    cloudModels: false,
    uncensoredModels: false,
  });
  assert.equal(narrowed.role, "administrator");
  assert.equal(hasFullAccess(narrowed), false, "generation checks its pick");
  // The model list (model/catalogue.js) and generation (generation-routes.js) use these checks.
  assert.deepEqual(visibleGenerationProfiles(profiles, narrowed), [drafted, plain]);
  assert.equal(mayUseGenerationProfile(narrowed, grok), false);
  assert.equal(mayUseGenerationProfile(narrowed, spicy), false);
  assert.equal(mayUseFeature(narrowed, "uncensoredModels"), false, "Dream's Spicy");
  assert.equal(mayUseFeature(narrowed, "loras"), true);
  const noLoras = effectiveAccountAccess(account, {}, null, { loras: false });
  assert.equal(mayUseFeature(noLoras, "loras"), false, "the picker, admission and Dream");
  assert.equal(mayUseFeature(noLoras, "cloudModels"), true);
});

test("suggestions are worded explicitly only with Spicy Prompts on and Uncensored Models", async () => {
  const groups = { open: { features: { uncensoredModels: true } }, plain: { features: {} } };
  const member = (accessProfileId, preferences = {}) =>
    effectiveAccountAccess(
      { id: accessProfileId, role: "user", accessProfileId },
      groups,
      null,
      preferences,
    );
  const access = { open: member("open"), plain: member("plain") };
  const preferences = { open: { spicyPrompts: false }, plain: { spicyPrompts: true } };
  const systems = [];
  const suggestions = createSuggestions({
    taste: { read: () => ({ summary: "Portraits.", signals: [] }) },
    writer: () => ({
      settings: () => ({}),
      model: async () => "text",
      chat: async ({ messages }) => {
        systems.push(messages[0].content);
        return { text: '{"steps": [{"label": "Closer", "request": "closer", "prompt": "A"}]}' };
      },
    }),
    online: async () => true,
    explicit: (owner) => explicitWording(access[owner], preferences[owner]),
    item: () => undefined,
    image: async () => null,
    save: () => {},
    ideas: () => true,
    nextSteps: () => true,
  });
  const draft = (owner) =>
    suggestions.suggest(owner, { surface: "draft", kind: "image", prompt: "A sultry portrait" });
  await draft("open");
  assert.doesNotMatch(systems[0], /Explicit content is allowed/, "off by default");
  preferences.open.spicyPrompts = true;
  await draft("open");
  assert.match(systems[1], /Explicit content is allowed/);
  await draft("plain");
  assert.doesNotMatch(systems[2], /Explicit content is allowed/, "ignored without Uncensored Models");
  // Turning Uncensored Models off for itself turns explicit wording off too.
  const optedOut = member("open", { uncensoredModels: false });
  assert.equal(explicitWording(optedOut, { spicyPrompts: true }), false);
  // Single-user mode has every feature, so only the preference counts.
  assert.equal(explicitWording(undefined, { spicyPrompts: true }), true);
  assert.equal(explicitWording(undefined, { spicyPrompts: false }), false);
});
