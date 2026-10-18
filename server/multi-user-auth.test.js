import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-multi-user-auth-"));
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.HEISS_MULTI_USER = "1";
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
  const token = cookie.match(/heiss_account=([^;]+)/)[1];
  const req = { ...local(), headers: { ...local().headers, cookie: `heiss_account=${token}` } };
  assert.equal(accountForRequest(req).role, "administrator");

  await call(routes["POST /api/accounts/sign-out"], req);
  assert.equal(accountForRequest({ ...local(), headers: { ...local().headers, cookie: `heiss_account=${token}` } }), null);
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
  assert.equal(accountForRequest({ ...local(), headers: { ...local().headers, authorization: `Bearer ${token}` } }).userId, accountForRequest(admin).userId);
  const revoked = await call(routes["POST /api/accounts/mcp-token/revoke"], admin);
  assert.equal(revoked.body.enabled, false);
  assert.equal(accountForRequest({ ...local(), headers: { ...local().headers, authorization: `Bearer ${token}` } }), null);
});
