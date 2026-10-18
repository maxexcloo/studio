import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-oidc-"));
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.HEISS_MULTI_USER = "1";
process.env.COMFY_URL = "http://127.0.0.1:9";
const { createOidcClient, oidcConfigFromEnv } = await import("./oidc.js");
const store = await import("./account-store.js");

const issuer = "https://id.example.test";
const config = { issuer, clientId: "heiss", clientSecret: "", redirectUri: "https://studio.example.test/api/accounts/oidc/callback", label: "Pocket ID", scopes: "openid email profile" };
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", alg: "RS256", use: "sig" };

function idToken(claims, { kid = "key-1", key = privateKey } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function provider(claimsFor) {
  const exchanges = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target === `${issuer}/.well-known/openid-configuration`) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (target === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (target === `${issuer}/token`) {
      const body = new URLSearchParams(String(init.body));
      exchanges.push(body);
      return Response.json({ id_token: claimsFor(body) });
    }
    return new Response("not found", { status: 404 });
  };
  return { client: createOidcClient(config, { fetchImpl }), exchanges };
}

const nonceOf = (url) => new URL(url).searchParams.get("nonce");
const baseClaims = (nonce, extra = {}) => ({ iss: issuer, aud: "heiss", sub: "subject-1", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "n@excloo.com", email_verified: true, ...extra });

test("configuration needs issuer, client and HTTPS callback", () => {
  assert.equal(oidcConfigFromEnv({}), null);
  assert.throws(() => oidcConfigFromEnv({ HEISS_OIDC_ISSUER: "http://id.example.test", HEISS_OIDC_CLIENT_ID: "heiss", HEISS_OIDC_REDIRECT_URI: "https://studio.example.test/cb" }));
  assert.equal(oidcConfigFromEnv({ HEISS_OIDC_ISSUER: `${issuer}/`, HEISS_OIDC_CLIENT_ID: "heiss", HEISS_OIDC_REDIRECT_URI: "https://studio.example.test/cb" }).issuer, issuer);
});

test("a PKCE sign-in verifies the signed identity token once", async () => {
  let nonce = "";
  const { client, exchanges } = provider(() => idToken(baseClaims(nonce)));
  const { url, state } = await client.start();
  nonce = nonceOf(url);
  const params = new URL(url).searchParams;
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("redirect_uri"), config.redirectUri);
  const identity = await client.finish({ code: "code-1", state, expectedState: state });
  assert.deepEqual([identity.subject, identity.email, identity.emailVerified], ["subject-1", "n@excloo.com", true]);
  const verifier = exchanges[0].get("code_verifier");
  assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), params.get("code_challenge"));
  await assert.rejects(client.finish({ code: "code-1", state, expectedState: state }), /expired/);
});

test("forged, mismatched or stale identity tokens are refused", async () => {
  const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const [label, make] of [
    ["wrong signature", (nonce) => idToken(baseClaims(nonce), { key: otherKey })],
    ["wrong audience", (nonce) => idToken(baseClaims(nonce, { aud: "someone-else" }))],
    ["wrong issuer", (nonce) => idToken(baseClaims(nonce, { iss: "https://evil.example.test" }))],
    ["expired", (nonce) => idToken(baseClaims(nonce, { exp: Math.floor(Date.now() / 1000) - 3600 }))],
    ["wrong nonce", () => idToken(baseClaims("another-nonce"))]
  ]) {
    let nonce = "";
    const { client } = provider(() => make(nonce));
    const { url, state } = await client.start();
    nonce = nonceOf(url);
    await assert.rejects(client.finish({ code: "c", state, expectedState: state }), Error, label);
  }
  const { client } = provider(() => "");
  const { state } = await client.start();
  await assert.rejects(client.finish({ code: "c", state, expectedState: "a-different-browser" }), /started elsewhere/);
});

test("verified emails link to matching accounts; other identities wait for approval", async () => {
  store.saveAccessProfile({ id: "artists", name: "Artists", generationProfiles: ["image-fast"], features: { gallery: true } }, ["image-fast"]);
  const legacy = await store.createLocalAccount({ username: "n@excloo.com", password: "a legacy studio password", accessProfileId: "artists" });
  const linked = store.signInWithOidcIdentity({ issuer, subject: "subject-1", email: "N@excloo.com", emailVerified: true });
  assert.equal(linked.access.userId, legacy.id);
  // The link is by subject from now on, even if the email changes.
  assert.equal(store.signInWithOidcIdentity({ issuer, subject: "subject-1", email: "changed@example.test", emailVerified: true }).access.userId, legacy.id);

  const unverified = store.signInWithOidcIdentity({ issuer, subject: "subject-2", email: "studio", emailVerified: false });
  assert.equal(unverified.pending, true);
  const pending = store.listAccounts().find((account) => account.pending);
  assert.match(pending.username, /^oidc-/);
  assert.equal(pending.role, "user");
  store.assignAccessProfile(pending.id, "artists");
  assert.equal(store.signInWithOidcIdentity({ issuer, subject: "subject-2" }).access.userId, pending.id);

  store.setAccountDisabled(legacy.id, true);
  assert.equal(store.signInWithOidcIdentity({ issuer, subject: "subject-1" }).refused, true);
});
