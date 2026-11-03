import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-store-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
const store = await import("./account-store.js");
const { readRuntimeDocument, writeRuntimeDocument } = await import("./persistence/runtime.ts");
const dataDir = path.join(temporary, "data");
const savedText = () => JSON.stringify(readRuntimeDocument(dataDir, "accounts"));

test("local account passwords and bearer sessions are stored only as verifiers", async () => {
  store.saveAccessProfile(
    {
      id: "artists",
      name: "Artists",
      generationProfiles: ["image-fast"],
      features: { gallery: true },
    },
    ["image-fast", "video"],
  );
  const account = await store.createLocalAccount({
    username: "artist.one",
    password: "a secure local password",
    accessProfileId: "artists",
  });
  assert.equal(account.role, "user");
  assert.equal("password" in account, false);
  assert.equal(
    (await store.verifyLocalAccount("ARTIST.ONE", "a secure local password")).userId,
    account.id,
  );
  assert.equal(await store.verifyLocalAccount("artist.one", "incorrect password"), null);

  const session = store.createAccountSession(account.id);
  assert.equal(store.accountSession(session.token).userId, account.id);
  const saved = savedText();
  assert.equal(saved.includes("a secure local password"), false);
  assert.equal(saved.includes(session.token), false);
  assert.match(saved, /scrypt-n32768-r8-p1/);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(path.join(dataDir, "studio.sqlite")).mode & 0o777, 0o600);

  store.revokeAccountSession(session.token);
  assert.equal(store.accountSession(session.token), null);
  assert.equal(readRuntimeDocument(dataDir, "accounts").sessions.length, 0);

  const mcp = store.rotateAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(mcp.token).userId, account.id);
  assert.equal(savedText().includes(mcp.token), false);
  const rotated = store.rotateAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(mcp.token), null);
  assert.equal(store.verifyAccountMcpToken(rotated.token).userId, account.id);
  store.revokeAccountMcpToken(account.id);
  assert.equal(store.verifyAccountMcpToken(rotated.token), null);
});

test("profile assignment, duplicate names and account disabling fail closed", async () => {
  const admin = await store.createLocalAccount({
    username: "recovery",
    password: "another secure password",
    role: "administrator",
  });
  await assert.rejects(
    store.createLocalAccount({
      username: "RECOVERY",
      password: "a different secure password",
      role: "administrator",
    }),
    /already exists/,
  );
  const user = await store.createLocalAccount({
    username: "artist.two",
    password: "a third secure password",
    accessProfileId: "artists",
  });
  store.setAccountDisabled(user.id, true);
  assert.equal(await store.verifyLocalAccount("artist.two", "a third secure password"), null);
  assert.equal(
    store.accountSession(store.createAccountSession(admin.id).token).role,
    "administrator",
  );
  assert.equal(
    store.listAccounts().some((account) => "password" in account),
    false,
  );
});

test("ordinary accounts cannot be created without one existing profile", async () => {
  await assert.rejects(
    store.createLocalAccount({
      username: "no.profile",
      password: "a valid long password",
      accessProfileId: "missing",
    }),
    /existing group/,
  );
  // An ordinary account may go without a password (single sign-on only); an administrator may not.
  assert.equal(
    (await store.createLocalAccount({ username: "empty.pass", password: "" })).accessProfileId,
    "user",
  );
  await assert.rejects(
    store.createLocalAccount({ username: "empty.admin", password: "", role: "administrator" }),
    /Enter a password/,
  );
});

test("the built-in User profile is added only where its ID is free, and an empty Administrator group is removed", () => {
  const saved = readRuntimeDocument(dataDir, "accounts");
  saved.profiles.user = {
    id: "user",
    name: "Our Users",
    generationProfiles: ["image-fast"],
    features: { gallery: true },
  };
  saved.profiles.administrator = { id: "administrator", name: "Administrator", allModels: true };
  writeRuntimeDocument(dataDir, "accounts", saved);
  store.resetAccountStoreForTests();
  assert.equal(store.ensureBuiltInAccessProfile(), false);
  const profiles = store.listAccessProfiles();
  assert.equal(
    profiles.find((item) => item.id === "user").name,
    "Our Users",
    "an existing profile is never replaced",
  );
  assert.equal(
    profiles.some((item) => item.id === "administrator"),
    false,
  );
});

test("new accounts start on the default access profile at once: local, single sign-on and chat gateway", async () => {
  store.saveAccessProfile({ id: "starter", name: "Starter", generationProfiles: ["image-fast"] }, [
    "image-fast",
  ]);
  // Without a choice, the built-in User group is the default; there is always one.
  assert.equal(store.defaultAccessProfileId(), "user");
  assert.throws(() => store.setDefaultAccessProfile("missing"), /existing group/);
  assert.throws(() => store.setDefaultAccessProfile(""), /existing group/);
  assert.equal(store.setDefaultAccessProfile("starter"), "starter");
  const local = await store.createLocalAccount({
    username: "local@example.com",
    password: "a valid long password",
  });
  assert.equal(local.accessProfileId, "starter");
  const profileOf = (username) => store.listAccounts().find((item) => item.username === username);

  const signedOn = store.signInWithOidcIdentity({
    issuer: "https://id.example",
    subject: "two",
    email: "two@example.com",
    emailVerified: true,
  });
  assert.equal(signedOn.access.authenticated, true);
  assert.equal(profileOf("two@example.com").accessProfileId, "starter");
  const chat = store.gatewayAccountAccess("chat-two", "chat.two@example.com");
  assert.equal(chat.authenticated, true);
  assert.equal(profileOf("chat.two@example.com").accessProfileId, "starter");
  assert.equal(profileOf("chat.two@example.com").identity.provider, "gateway");
  assert.equal(
    store.gatewayAccountAccess("chat-two").userId,
    chat.userId,
    "the identity stays linked to its new account",
  );
});
