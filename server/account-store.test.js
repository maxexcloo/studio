import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-account-store-"));
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_URL = "http://127.0.0.1:9";
const store = await import("./account-store.js");

test("local account passwords and bearer sessions are stored only as verifiers", async () => {
  store.saveAccessProfile({ id: "artists", name: "Artists", generationProfiles: ["image-fast"], features: { gallery: true } }, ["image-fast", "video"]);
  const account = await store.createLocalAccount({ username: "artist.one", password: "a secure local password", accessProfileId: "artists" });
  assert.equal(account.role, "user");
  assert.equal("password" in account, false);
  assert.equal((await store.verifyLocalAccount("ARTIST.ONE", "a secure local password")).userId, account.id);
  assert.equal(await store.verifyLocalAccount("artist.one", "incorrect password"), null);

  const session = store.createAccountSession(account.id);
  assert.equal(store.accountSession(session.token).userId, account.id);
  const saved = fs.readFileSync(path.join(temporary, "data", "accounts.json"), "utf8");
  assert.equal(saved.includes("a secure local password"), false);
  assert.equal(saved.includes(session.token), false);
  assert.match(saved, /scrypt-n32768-r8-p1/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(temporary, "data", "accounts.json")).mode & 0o777, 0o600);

  store.revokeAccountSession(session.token);
  assert.equal(store.accountSession(session.token), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, "data", "accounts.json.bak"), "utf8")).sessions.length, 0);

  const mcp = store.rotateAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(mcp.token).userId, account.id);
  assert.equal(fs.readFileSync(path.join(temporary, "data", "accounts.json"), "utf8").includes(mcp.token), false);
  const rotated = store.rotateAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(mcp.token), null);
  assert.equal(store.verifyAccountMcpToken(rotated.token).userId, account.id);
  store.revokeAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(rotated.token), null);
});

test("profile assignment, duplicate names and account disabling fail closed", async () => {
  const admin = await store.createLocalAccount({ username: "recovery", password: "another secure password", role: "administrator" });
  await assert.rejects(store.createLocalAccount({ username: "RECOVERY", password: "a different secure password", role: "administrator" }), /already exists/);
  const user = await store.createLocalAccount({ username: "artist.two", password: "a third secure password", accessProfileId: "artists" });
  store.setAccountDisabled(user.id, true);
  assert.equal(await store.verifyLocalAccount("artist.two", "a third secure password"), null);
  assert.equal(store.accountSession(store.createAccountSession(admin.id).token).role, "administrator");
  assert.equal(store.listAccounts().some((account) => "password" in account), false);
});

test("ordinary accounts cannot be created without one existing profile", async () => {
  await assert.rejects(store.createLocalAccount({ username: "no.profile", password: "a valid long password", accessProfileId: "missing" }), /existing access profile/);
  // An ordinary account may go without a password (single sign-on only); an administrator may not.
  await assert.rejects(store.createLocalAccount({ username: "empty.pass", password: "" }), /existing access profile/);
  await assert.rejects(store.createLocalAccount({ username: "empty.admin", password: "", role: "administrator" }), /Enter a password/);
});

test("stored access profiles from before Cloud Models are settled once and their cloud grants kept on record", () => {
  const file = path.join(temporary, "data", "accounts.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  saved.profiles.legacy = { id: "legacy", name: "Legacy", generationProfiles: ["image-fast", "grok-video"], features: { videoGeneration: true } };
  saved.profiles.local = { id: "local", name: "Local", generationProfiles: ["image-fast"], features: { imageGeneration: true } };
  fs.writeFileSync(file, JSON.stringify(saved));
  store.resetAccountStoreForTests();

  assert.equal(store.migrateCloudModelAccess([]), false, "nothing settles without a known cloud profile");
  // Saving while the catalogue lacks cloud profiles keeps the old grant and leaves the profile unsettled.
  store.saveAccessProfile({ id: "legacy", name: "Legacy", generationProfiles: ["image-fast", "grok-video"], features: { videoGeneration: true } }, ["image-fast"]);
  assert.equal("cloudModels" in store.listAccessProfiles().find((item) => item.id === "legacy").features, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).profiles.legacy.features.cloudModels, undefined);

  assert.equal(store.migrateCloudModelAccess(["grok-video", "grok-image"]), true);
  const after = JSON.parse(fs.readFileSync(file, "utf8")).profiles;
  assert.equal(after.legacy.features.cloudModels, true);
  assert.deepEqual(after.legacy.generationProfiles, ["image-fast"]);
  assert.deepEqual(after.legacy.retiredCloudGrants, ["grok-video"]);
  assert.equal(after.local.features.cloudModels, false);
  assert.equal(store.migrateCloudModelAccess(["grok-video"]), false, "settled profiles stay as they are");

  // An administrator can then turn it off; a cloud id sent as a model grant is ignored.
  const off = store.saveAccessProfile({ id: "legacy", name: "Legacy", generationProfiles: ["image-fast", "grok-image"], features: { videoGeneration: true, cloudModels: false } }, ["image-fast"], ["grok-video", "grok-image"]);
  assert.equal(off.features.cloudModels, false);
  assert.deepEqual(off.generationProfiles, ["image-fast"]);
  assert.deepEqual(off.retiredCloudGrants, ["grok-video"]);
});

test("the built-in access profiles are added only where their IDs are free", () => {
  const file = path.join(temporary, "data", "accounts.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  saved.profiles.user = { id: "user", name: "Our Users", generationProfiles: ["image-fast"], features: { gallery: true } };
  fs.writeFileSync(file, JSON.stringify(saved));
  store.resetAccountStoreForTests();
  assert.deepEqual(store.ensureBuiltInAccessProfiles(), ["administrator"]);
  const profiles = store.listAccessProfiles();
  assert.equal(profiles.find((item) => item.id === "user").name, "Our Users", "an existing profile is never replaced");
  const administrator = profiles.find((item) => item.id === "administrator");
  assert.equal(administrator.allModels, true);
  assert.equal(Object.values(administrator.features).every(Boolean), true);
  assert.deepEqual(store.ensureBuiltInAccessProfiles(), []);
});

test("the old global switches become per-profile values once, never widening access", () => {
  const file = path.join(temporary, "data", "accounts.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  delete saved.featureOptionsMigrated;
  saved.profiles.mixed = { id: "mixed", name: "Mixed", generationProfiles: ["image-fast"], features: { imageGeneration: true, loras: true, cloudModels: true } };
  saved.profiles.plain = { id: "plain", name: "Plain", generationProfiles: ["image-fast"], features: { imageGeneration: true, loras: false } };
  fs.writeFileSync(file, JSON.stringify(saved));
  store.resetAccountStoreForTests();
  assert.equal(store.migrateFeatureOptionAccess({ loras: false, cloudModels: true }), true);
  const after = JSON.parse(fs.readFileSync(file, "utf8")).profiles;
  assert.equal(after.mixed.features.loras, false, "LoRAs were off for everyone, so they stay off");
  assert.equal(after.mixed.features.cloudModels, true, "Cloud Models was on, so the profile keeps its own value");
  assert.equal(after.plain.features.loras, false);
  assert.equal(after.plain.features.cloudModels, undefined, "nothing is turned on");
  assert.equal(store.migrateFeatureOptionAccess({ loras: false, cloudModels: false }), false, "it runs once");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).profiles.mixed.features.cloudModels, true);
});

test("new accounts start on the default access profile: local, single sign-on and chat gateway", async () => {
  store.saveAccessProfile({ id: "starter", name: "Starter", generationProfiles: ["image-fast"], features: { imageGeneration: true } }, ["image-fast"]);
  assert.equal(store.defaultAccessProfileId(), "");
  // Without a default, a new sign-on account waits and an unknown gateway email gets nothing.
  assert.deepEqual(store.signInWithOidcIdentity({ issuer: "https://id.example", subject: "one", email: "one@example.com", emailVerified: true }), { pending: true });
  assert.equal(store.gatewayAccountAccess("chat-one", "chat.one@example.com"), null);
  await assert.rejects(store.createLocalAccount({ username: "nodefault@example.com", password: "a valid long password" }), /existing access profile/);

  assert.throws(() => store.setDefaultAccessProfile("missing"), /existing access profile/);
  assert.equal(store.setDefaultAccessProfile("starter"), "starter");
  const local = await store.createLocalAccount({ username: "local@example.com", password: "a valid long password" });
  assert.equal(local.accessProfileId, "starter");
  const signedOn = store.signInWithOidcIdentity({ issuer: "https://id.example", subject: "two", email: "two@example.com", emailVerified: true });
  const profileOf = (username) => store.listAccounts().find((item) => item.username === username);
  assert.equal(signedOn.access.authenticated, true);
  assert.equal(profileOf("two@example.com").accessProfileId, "starter");
  assert.equal(profileOf("two@example.com").pending, undefined);
  const chat = store.gatewayAccountAccess("chat-two", "chat.two@example.com");
  assert.equal(chat.authenticated, true);
  assert.equal(profileOf("chat.two@example.com").accessProfileId, "starter");
  assert.equal(profileOf("chat.two@example.com").identity.provider, "gateway");
  assert.equal(store.gatewayAccountAccess("chat-two").userId, chat.userId, "the identity stays linked to its new account");
  assert.equal(store.setDefaultAccessProfile(""), "");
});
