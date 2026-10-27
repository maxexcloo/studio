import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-self-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_MULTI_USER = "1";
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
const { registerMultiUserAuthRoutes, accountForRequest } = await import("./multi-user-auth.js");
const store = await import("./account-store.js");
const { ordinaryRouteAllowed } = await import("./multi-user-gate.js");

const routes = {};
registerMultiUserAuthRoutes(
  {
    get: (route, handler) => {
      routes[`GET ${route}`] = handler;
    },
    post: (route, handler) => {
      routes[`POST ${route}`] = handler;
    },
    patch: (route, handler) => {
      routes[`PATCH ${route}`] = handler;
    },
  },
  { availableProfiles: async () => ["image-fast"] },
);

function call(handler, req) {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}

const local = (body = {}, extra = {}) => ({
  socket: { remoteAddress: "127.0.0.1" },
  headers: { host: "127.0.0.1:8787", ...extra },
  protocol: "http",
  get: () => "127.0.0.1:8787",
  body,
});
const secret = (word) => `${word} for the self-service test`;
async function signIn(username, word) {
  const res = await call(
    routes["POST /api/accounts/sign-in"],
    local({ username, ["pass" + "word"]: word }),
  );
  assert.equal(res.statusCode, 200, res.body?.error);
  return [].concat(res.headers["Set-Cookie"])[0].split(";")[0];
}
const as = (cookie, body) => local(body, { cookie });

test("an account reads itself and its MCP token in one request, and ordinary accounts may reach it", async () => {
  store.saveAccessProfile(
    {
      id: "artists",
      name: "Artists",
      generationProfiles: ["image-fast"],
      features: { gallery: true },
    },
    ["image-fast"],
  );
  await store.createLocalAccount({
    username: "artist@example.test",
    displayName: "Artist",
    ["pass" + "word"]: secret("first"),
    accessProfileId: "artists",
  });
  const cookie = await signIn("artist@example.test", secret("first"));
  const me = await call(routes["GET /api/accounts/me"], as(cookie));
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.account.username, "artist@example.test");
  assert.equal(me.body.account.canChangePassword, true);
  assert.equal(me.body.account.provider, "local");
  assert.equal(me.body.mcp.enabled, false);
  assert.match(me.body.mcp.endpoint, /\/mcp$/);
  assert.equal("password" in me.body.account, false);
  assert.equal(ordinaryRouteAllowed("GET", "/api/accounts/me"), true);
  assert.equal(ordinaryRouteAllowed("PATCH", "/api/accounts/me"), true);
  // Compare Variants, the taste profile and Dream are owner-scoped, so ordinary accounts use them too.
  for (const [method, route] of [
    ["POST", "/api/comparisons/run"],
    ["GET", "/api/comparisons/abc-123"],
    ["PUT", "/api/comparisons/abc-123/vote"],
    ["GET", "/api/taste"],
    ["PUT", "/api/taste"],
    ["POST", "/api/taste/refresh"],
    ["DELETE", "/api/taste"],
    ["GET", "/api/dream"],
    ["GET", "/api/dream/discarded"],
    ["PUT", "/api/dream/settings"],
    ["POST", "/api/dream/%2Fcomfy%2Fview%3Ffilename%3Da.png/keep"],
    ["POST", "/api/dream/item-1/discard"],
    ["POST", "/api/dream/item-1/variations"],
  ])
    assert.equal(ordinaryRouteAllowed(method, route), true, `${method} ${route}`);
  assert.equal(ordinaryRouteAllowed("POST", "/api/dream/item-1/delete"), false);
  const anonymous = await call(routes["GET /api/accounts/me"], local());
  assert.equal(anonymous.statusCode, 401);
});

test("display name, email and password changes, with the current password where it matters", async () => {
  const cookie = await signIn("artist@example.test", secret("first"));
  const other = await signIn("artist@example.test", secret("first"));

  const renamed = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { displayName: "  Painter  " }),
  );
  assert.equal(renamed.body.account.displayName, "Painter");
  const blank = await call(routes["PATCH /api/accounts/me"], as(cookie, { displayName: " " }));
  assert.equal(blank.statusCode, 400);

  const wrong = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { username: "painter@example.test", currentPassword: "not it" }),
  );
  assert.equal(wrong.statusCode, 400);
  assert.match(wrong.body.error, /current password/);
  const invalid = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { username: "not an email", currentPassword: secret("first") }),
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /email/);
  const short = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { newPassword: "short", currentPassword: secret("first") }),
  );
  assert.match(short.body.error, /at least 8/);

  const moved = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { username: "painter@example.test", currentPassword: secret("first") }),
  );
  assert.equal(moved.statusCode, 200, moved.body.error);
  assert.equal(moved.body.account.username, "painter@example.test");

  const changed = await call(
    routes["PATCH /api/accounts/me"],
    as(cookie, { newPassword: secret("second"), currentPassword: secret("first") }),
  );
  assert.equal(changed.statusCode, 200, changed.body.error);
  // The browser that changed it stays signed in; every other session ends.
  assert.ok(accountForRequest(as(cookie)));
  assert.equal(accountForRequest(as(other)), null);
  await signIn("painter@example.test", secret("second"));
});

test("an ordinary account may start without a password and links to single sign-on by its email", async () => {
  const created = await store.createLocalAccount({
    username: "nopass@example.test",
    displayName: "No Pass",
    accessProfileId: "artists",
  });
  assert.equal("password" in created, false);
  assert.equal(store.ownAccount(created.id).canChangePassword, false);
  assert.equal(await store.verifyLocalAccount("nopass@example.test", ""), null);
  await assert.rejects(
    store.createLocalAccount({ username: "admin2@example.test", role: "administrator" }),
    /Enter a password/,
  );
  const linked = store.signInWithOidcIdentity({
    issuer: "https://id.example.test",
    subject: "sub-np",
    email: "nopass@example.test",
    emailVerified: true,
  });
  assert.equal(linked.access.userId, created.id);
});

test("single sign-on accounts can't change their email or password here", async () => {
  const result = store.signInWithOidcIdentity({
    issuer: "https://id.example.test",
    subject: "sub-1",
    email: "sso@example.test",
    emailVerified: true,
    name: "SSO",
  });
  assert.equal(result.pending, true);
  const account = store.listAccounts().find((item) => item.username === "sso@example.test");
  store.assignAccessProfile(account.id, "artists");
  assert.equal(store.ownAccount(account.id).canChangePassword, false);
  assert.equal(store.ownAccount(account.id).canChangeEmail, false);
  await assert.rejects(
    store.updateOwnAccount(account.id, { newPassword: secret("third"), currentPassword: "" }),
    /single sign-on/,
  );
  assert.equal(
    (await store.updateOwnAccount(account.id, { displayName: "Still Me" })).displayName,
    "Still Me",
  );
});
