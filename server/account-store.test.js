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
  await assert.rejects(store.createLocalAccount({ username: "empty.pass", password: "" }), /Enter a password/);
});
