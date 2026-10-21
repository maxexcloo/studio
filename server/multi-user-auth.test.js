import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-multi-user-auth-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_MULTI_USER = "1";
process.env.COMFY_URL = "http://127.0.0.1:9";
const { registerMultiUserAuthRoutes, accountForRequest } = await import("./multi-user-auth.js");

const routes = {};
registerMultiUserAuthRoutes({
  get: (route, handler) => { routes[`GET ${route}`] = handler; },
  post: (route, handler) => { routes[`POST ${route}`] = handler; },
  patch: (route, handler) => { routes[`PATCH ${route}`] = handler; }
}, { availableProfiles: async () => ["image-fast", "video"] });

function call(handler, req) {
  const res = {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}

const local = (body = {}) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8787" }, body });

test("only the local machine can bootstrap the first recovery administrator, once", async () => {
  const outsider = await call(routes["POST /api/accounts/bootstrap"], { ...local({ username: "recovery", password: "a secure recovery password" }), socket: { remoteAddress: "192.168.1.90" } });
  assert.equal(outsider.statusCode, 403);

  const created = await call(routes["POST /api/accounts/bootstrap"], local({ username: "recovery", password: "a secure recovery password" }));
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.account.role, "administrator");
  const cookie = [].concat(created.headers["Set-Cookie"])[0].split(";")[0];
  const signedIn = { ...local(), headers: { ...local().headers, cookie } };
  assert.equal(accountForRequest(signedIn).role, "administrator");
  const status = await call(routes["GET /api/accounts/status"], signedIn);
  assert.equal(status.body.account.id, accountForRequest(signedIn).userId);

  const repeated = await call(routes["POST /api/accounts/bootstrap"], local({ username: "second", password: "a secure second password" }));
  assert.equal(repeated.statusCode, 409);
  assert.equal(fs.existsSync(path.join(temporary, "data", "accounts.json")), true);
});

test("local password sign-in sets an HttpOnly session and sign-out revokes it", async () => {
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "RECOVERY", password: "a secure recovery password" }));
  assert.equal(signedIn.statusCode, 200);
  const cookie = [].concat(signedIn.headers["Set-Cookie"])[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=2592000/);
  const token = cookie.match(/studio_account=([^;]+)/)[1];
  const req = { ...local(), headers: { ...local().headers, cookie: `studio_account=${token}` } };
  assert.equal(accountForRequest(req).role, "administrator");

  await call(routes["POST /api/accounts/sign-out"], req);
  assert.equal(accountForRequest({ ...local(), headers: { ...local().headers, cookie: `studio_account=${token}` } }), null);
});

test("only an authenticated administrator can create profiles and approve ordinary accounts", async () => {
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const cookie = [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0];
  const admin = { ...local(), headers: { ...local().headers, cookie } };

  const createdProfile = await call(routes["POST /api/accounts/profiles"], {
    ...admin,
    body: { id: "artists", name: "Artists", generationProfiles: ["image-fast", "not-approved"], features: { gallery: true, loras: true } }
  });
  assert.deepEqual(createdProfile.body.profile.generationProfiles, ["image-fast"]);
  const createdUser = await call(routes["POST /api/accounts/users"], {
    ...admin,
    body: { username: "artist", password: "an approved user password", accessProfileId: "artists" }
  });
  assert.equal(createdUser.statusCode, 201);
  assert.equal(createdUser.body.account.role, "user");
  assert.equal(createdUser.body.account.accessProfileId, "artists");

  const anonymous = await call(routes["GET /api/accounts/admin"], local());
  assert.equal(anonymous.statusCode, 403);

  const endpoint = await call(routes["GET /api/accounts/mcp-token"], { ...admin, protocol: "https", get: () => "studio.example.test" });
  assert.equal(endpoint.body.endpoint, "https://studio.example.test/mcp");
  const createdToken = await call(routes["POST /api/accounts/mcp-token"], admin);
  const token = createdToken.body.token;
  const bearer = (method, routePath) => ({ ...local(), method, path: routePath, headers: { ...local().headers, authorization: `Bearer ${token}` } });
  assert.equal(accountForRequest(bearer("GET", "/api/models")).userId, accountForRequest(admin).userId);
  // A personal MCP token is not a general API or administrator credential.
  assert.equal(accountForRequest(bearer("GET", "/api/accounts/admin")), null);
  assert.equal(accountForRequest(bearer("POST", "/api/accounts/mcp-token")), null);
  assert.equal(accountForRequest(bearer("POST", "/api/shutdown")), null);
  const { canAdmin } = await import("./access.js");
  assert.equal(canAdmin(bearer("GET", "/comfy/view")), false);
  const revoked = await call(routes["POST /api/accounts/mcp-token/revoke"], admin);
  assert.equal(revoked.body.enabled, false);
  assert.equal(accountForRequest(bearer("GET", "/api/models")), null);
});

test("ordinary accounts keep stored profile grants and explicit administration changes", async () => {
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const admin = { ...local(), headers: { ...local().headers, cookie: [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0] } };
  const userSignIn = await call(routes["POST /api/accounts/sign-in"], { ...local({ username: "artist", password: "an approved user password" }), socket: { remoteAddress: "192.168.1.20" } });
  assert.equal(userSignIn.statusCode, 200);
  const userCookie = [].concat(userSignIn.headers["Set-Cookie"])[0].split(";")[0];
  const user = accountForRequest({ ...local(), headers: { ...local().headers, cookie: userCookie } });
  // Runtime access must not drop grants for lack of a discovery list.
  assert.deepEqual(user.generationProfiles, ["image-fast"]);

  const list = await call(routes["GET /api/accounts/admin"], admin);
  const artist = list.body.accounts.find((account) => account.username === "artist");
  const empty = await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: {} });
  assert.equal(empty.statusCode, 400);
  const disabled = await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { disabled: true } });
  assert.equal(disabled.body.account.disabled, true);
  const typo = await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { disable: false } });
  assert.equal(typo.statusCode, 400);
  const blocked = await call(routes["POST /api/accounts/sign-in"], { ...local({ username: "artist", password: "an approved user password" }), socket: { remoteAddress: "192.168.1.21" } });
  assert.equal(blocked.statusCode, 401);
  await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { disabled: false } });

  // Administrators no longer reset passwords; the account changes its own in Settings › Account.
  const reset = await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { password: "a replacement password" } });
  assert.equal(reset.statusCode, 400);

  // Saving while discovery is degraded keeps existing grants but adds no new unknown ones.
  const { saveAccessProfile } = await import("./account-store.js");
  const saved = saveAccessProfile({ id: "artists", name: "Artists", generationProfiles: ["image-fast", "new-unknown"], features: { gallery: true } }, []);
  assert.deepEqual(saved.generationProfiles, ["image-fast"]);
});

test("session cookies are Secure behind a TLS-terminating proxy", async () => {
  const signedIn = await call(routes["POST /api/accounts/sign-in"], { ...local({ username: "recovery", password: "a secure recovery password" }), headers: { host: "studio.example.test", "x-forwarded-proto": "https" } });
  assert.match([].concat(signedIn.headers["Set-Cookie"])[0], /; Secure/);
});

test("gateway identities map to accounts only through administrator links, and the internal credential stays on loopback MCP routes", async () => {
  const { gatewayAccountAccess, noteGatewayIdentity } = await import("./account-store.js");
  const { internalMcpHeaders } = await import("./multi-user-auth.js");
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const admin = { ...local(), headers: { ...local().headers, cookie: [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0] } };
  const artist = (await call(routes["GET /api/accounts/admin"], admin)).body.accounts.find((account) => account.username === "artist");

  assert.equal(gatewayAccountAccess("librechat-user-1"), null);
  noteGatewayIdentity("librechat-user-1");
  assert.deepEqual((await call(routes["GET /api/accounts/admin"], admin)).body.gateway.pending.map((item) => item.identity), ["librechat-user-1"]);
  const refused = await call(routes["POST /api/accounts/gateway-links"], { ...local({ identity: "librechat-user-1", accountId: artist.id }), socket: { remoteAddress: "192.168.1.30" } });
  assert.equal(refused.statusCode, 403);
  const linked = await call(routes["POST /api/accounts/gateway-links"], { ...admin, body: { identity: "librechat-user-1", accountId: artist.id } });
  assert.deepEqual(linked.body.gateway.links.map((item) => [item.identity, item.accountId]), [["librechat-user-1", artist.id]]);
  assert.deepEqual(linked.body.gateway.pending, []);
  const access = gatewayAccountAccess("librechat-user-1");
  assert.equal(access.userId, artist.id);
  assert.equal(access.credential, "mcp-token");

  const internal = (method, routePath, extra = {}) => ({ ...local(), method, path: routePath, headers: { ...local().headers, ...Object.fromEntries(Object.entries(internalMcpHeaders(artist.id)).map(([name, value]) => [name.toLowerCase(), value])), ...extra } });
  assert.equal(accountForRequest(internal("POST", "/api/generate")).userId, artist.id);
  assert.equal(accountForRequest(internal("GET", "/api/accounts/admin")), null);
  // Behind a proxy the request is not this computer, so the credential is refused.
  assert.equal(accountForRequest(internal("POST", "/api/generate", { "x-forwarded-for": "203.0.113.9" })), null);
  assert.equal(accountForRequest({ ...internal("POST", "/api/generate"), headers: { ...internal("POST", "/api/generate").headers, "x-studio-mcp-internal": "guessed" } }), null);

  await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { disabled: true } });
  assert.equal(gatewayAccountAccess("librechat-user-1"), null);
  assert.equal(accountForRequest(internal("POST", "/api/generate")), null);
  await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: artist.id }, body: { disabled: false } });
  const unlinked = await call(routes["POST /api/accounts/gateway-links"], { ...admin, body: { identity: "librechat-user-1" } });
  assert.deepEqual(unlinked.body.gateway.links, []);
  assert.equal(gatewayAccountAccess("librechat-user-1"), null);
});

test("a forwarded gateway email links its identity to the enabled account with that username, and never creates one", async () => {
  const { gatewayAccountAccess, noteGatewayIdentity } = await import("./account-store.js");
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const admin = { ...local(), headers: { ...local().headers, cookie: [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0] } };
  const create = async (username) => (await call(routes["POST /api/accounts/users"], { ...admin, body: { username, password: "an approved user password", accessProfileId: "artists" } })).body.account;
  const painter = await create("Painter@Example.test");
  const retired = await create("retired@example.test");
  await call(routes["PATCH /api/accounts/users/:id"], { ...admin, params: { id: retired.id }, body: { disabled: true } });
  const accounts = (await call(routes["GET /api/accounts/admin"], admin)).body.accounts.length;

  // Case-insensitive, and recorded like an administrator's link.
  assert.equal(gatewayAccountAccess("librechat-painter", "painter@EXAMPLE.test").userId, painter.id);
  assert.equal(gatewayAccountAccess("librechat-painter").userId, painter.id);
  const gateway = (await call(routes["GET /api/accounts/admin"], admin)).body.gateway;
  assert.deepEqual(gateway.links.filter((item) => item.identity === "librechat-painter").map((item) => item.accountId), [painter.id]);
  assert.ok(gateway.links.find((item) => item.identity === "librechat-painter").linkedAt);

  // A disabled account is not linked; an unknown email stays pending and creates nothing.
  assert.equal(gatewayAccountAccess("librechat-retired", "retired@example.test"), null);
  assert.equal(gatewayAccountAccess("librechat-stranger", "stranger@example.test"), null);
  noteGatewayIdentity("librechat-retired");
  noteGatewayIdentity("librechat-stranger");
  const after = (await call(routes["GET /api/accounts/admin"], admin)).body;
  assert.equal(after.accounts.length, accounts);
  assert.equal(after.gateway.links.some((item) => ["librechat-retired", "librechat-stranger"].includes(item.identity)), false);
  assert.deepEqual(after.gateway.pending.map((item) => item.identity).filter((identity) => identity !== "librechat-user-1").sort(), ["librechat-retired", "librechat-stranger"]);
  // An email never overrides an existing link.
  assert.equal(gatewayAccountAccess("librechat-painter", "stranger@example.test").userId, painter.id);
});

test("administrators can dismiss a pending gateway identity, which returns only if the gateway sends it again", async () => {
  const { noteGatewayIdentity } = await import("./account-store.js");
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const admin = { ...local(), headers: { ...local().headers, cookie: [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0] } };
  const pending = async () => (await call(routes["GET /api/accounts/admin"], admin)).body.gateway.pending.map((item) => item.identity);
  noteGatewayIdentity("librechat-probe");
  assert.ok((await pending()).includes("librechat-probe"));

  const refused = await call(routes["POST /api/accounts/gateway-pending/dismiss"], { ...local({ identity: "librechat-probe" }), socket: { remoteAddress: "192.168.1.30" } });
  assert.equal(refused.statusCode, 403);
  assert.ok((await pending()).includes("librechat-probe"));

  const dismissed = await call(routes["POST /api/accounts/gateway-pending/dismiss"], { ...admin, body: { identity: "librechat-probe" } });
  assert.equal(dismissed.body.ok, true);
  assert.equal(dismissed.body.gateway.pending.some((item) => item.identity === "librechat-probe"), false);
  assert.equal((await pending()).includes("librechat-probe"), false);
  const missing = await call(routes["POST /api/accounts/gateway-pending/dismiss"], { ...admin, body: { identity: "librechat-probe" } });
  assert.equal(missing.statusCode, 400);

  noteGatewayIdentity("librechat-probe");
  assert.ok((await pending()).includes("librechat-probe"));
});

test("MCP admin routes take only an administrator's own token, or a gateway-linked administrator while Chat Gateway Admin Tools is on", async () => {
  const { rotateAccountMcpToken } = await import("./account-store.js");
  const { internalMcpHeaders, mcpAdminRouteAllowed } = await import("./multi-user-auth.js");
  const { canAdmin } = await import("./access.js");
  const { fromChat } = await import("./route-access.js");
  const signedIn = await call(routes["POST /api/accounts/sign-in"], local({ username: "recovery", password: "a secure recovery password" }));
  const admin = { ...local(), headers: { ...local().headers, cookie: [].concat(signedIn.headers["Set-Cookie"])[0].split(";")[0] } };
  const adminId = accountForRequest(admin).userId;
  const artist = (await call(routes["GET /api/accounts/admin"], admin)).body.accounts.find((account) => account.username === "artist");
  const bearer = (token, method, routePath) => ({ ...local(), method, path: routePath, headers: { ...local().headers, authorization: `Bearer ${token}` } });
  const internal = (accountId, method, routePath) => ({ ...local(), method, path: routePath, headers: { ...local().headers, ...Object.fromEntries(Object.entries(internalMcpHeaders(accountId)).map(([name, value]) => [name.toLowerCase(), value])) } });

  assert.equal(mcpAdminRouteAllowed("POST", "/api/library/imports"), true);
  assert.equal(mcpAdminRouteAllowed("PUT", "/api/profiles/editable/flux-fast"), true);
  // Nothing that deletes or replaces files, and no account or GPU administration.
  for (const [method, routePath] of [["POST", "/api/models/downloads/replace"], ["DELETE", "/api/loras"], ["POST", "/api/models/manifest/restore"], ["GET", "/api/accounts/admin"], ["POST", "/api/library/imports/x/folder"]]) assert.equal(mcpAdminRouteAllowed(method, routePath), false, `${method} ${routePath}`);

  const adminToken = (await call(routes["POST /api/accounts/mcp-token"], admin)).body.token;
  const asAdmin = accountForRequest(bearer(adminToken, "POST", "/api/library/imports"));
  assert.equal(asAdmin.credential, "mcp-admin");
  assert.equal(canAdmin({ studioAccount: asAdmin }), true);
  assert.equal(fromChat({ studioAccount: asAdmin }), true);
  assert.equal(accountForRequest(bearer(adminToken, "GET", "/api/accounts/admin")), null);
  assert.equal(accountForRequest(bearer(adminToken, "GET", "/api/models")).credential, "mcp-token");
  assert.equal(accountForRequest(bearer(adminToken, "GET", "/api/reference-assets/asset-1/media")).credential, "mcp-token", "an upload's pixels, for its owner");
  const artistToken = rotateAccountMcpToken(artist.id).token;
  assert.equal(accountForRequest(bearer(artistToken, "POST", "/api/library/imports")), null);

  // The switch is off by default: a gateway-linked administrator's loopback calls stay out.
  assert.equal((await call(routes["GET /api/accounts/admin"], admin)).body.gateway.adminTools, false);
  assert.equal(accountForRequest(internal(adminId, "POST", "/api/library/imports")), null);
  assert.equal(accountForRequest(internal(adminId, "POST", "/api/generate")).credential, "mcp-token");
  const refused = await call(routes["POST /api/accounts/gateway-admin"], { ...local({ on: true }), socket: { remoteAddress: "192.168.1.30" } });
  assert.equal(refused.statusCode, 403);
  assert.equal((await call(routes["POST /api/accounts/gateway-admin"], { ...admin, body: { on: "yes" } })).statusCode, 400);
  assert.equal((await call(routes["POST /api/accounts/gateway-admin"], { ...admin, body: { on: true } })).body.adminTools, true);
  assert.equal(accountForRequest(internal(adminId, "POST", "/api/library/imports")).credential, "mcp-admin");
  assert.equal(accountForRequest(internal(artist.id, "POST", "/api/library/imports")), null);
  await call(routes["POST /api/accounts/gateway-admin"], { ...admin, body: { on: false } });
  assert.equal(accountForRequest(internal(adminId, "POST", "/api/library/imports")), null);
});
