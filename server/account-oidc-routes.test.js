import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-oidc-routes-"));
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_MULTI_USER = "1";
process.env.COMFY_URL = "http://127.0.0.1:9";
const { registerMultiUserAuthRoutes, accountForRequest } = await import("./multi-user-auth.js");
const store = await import("./account-store.js");

let identity = null;
const routes = {};
registerMultiUserAuthRoutes({
  get: (route, handler) => { routes[`GET ${route}`] = handler; },
  post: (route, handler) => { routes[`POST ${route}`] = handler; },
  patch: (route, handler) => { routes[`PATCH ${route}`] = handler; }
}, {
  oidcClient: {
    label: "Pocket ID",
    start: async () => ({ url: "https://id.example.test/authorize?state=s1", state: "s1" }),
    finish: async ({ state, expectedState }) => { if (state !== expectedState) throw new Error("mismatch"); return identity; }
  }
});

function call(handler, req) {
  const res = {
    headers: {}, statusCode: 200, body: null, location: "",
    setHeader(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}
const browser = (cookie = "", query = {}) => ({ socket: { remoteAddress: "192.168.1.40" }, headers: { host: "studio.example.test", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) }, query });

test("single sign-on sets a Lax state cookie, then signs approved identities in", async () => {
  assert.deepEqual((await call(routes["GET /api/accounts/status"], browser())).body.oidc, { label: "Pocket ID" });
  const started = await call(routes["GET /api/accounts/oidc/start"], browser());
  assert.equal(started.location, "https://id.example.test/authorize?state=s1");
  const stateCookie = [].concat(started.headers["Set-Cookie"])[0];
  assert.match(stateCookie, /SameSite=Lax/);
  assert.match(stateCookie, /Path=\/api\/accounts\/oidc/);
  const cookie = stateCookie.split(";")[0];

  identity = { issuer: "https://id.example.test", subject: "new-person", email: "new@example.test", emailVerified: true };
  const elsewhere = await call(routes["GET /api/accounts/oidc/callback"], browser("", { code: "c", state: "s1" }));
  assert.equal(elsewhere.location, "/?sign-in=failed");
  const pending = await call(routes["GET /api/accounts/oidc/callback"], browser(cookie, { code: "c", state: "s1" }));
  assert.equal(pending.location, "/?sign-in=pending");
  assert.equal([].concat(pending.headers["Set-Cookie"]).some((value) => value.startsWith("studio_account=") && !value.startsWith("studio_account=;")), false);

  store.saveAccessProfile({ id: "artists", name: "Artists", generationProfiles: [], features: { gallery: true } }, []);
  store.assignAccessProfile(store.listAccounts().find((account) => account.pending).id, "artists");
  const approved = await call(routes["GET /api/accounts/oidc/callback"], browser(cookie, { code: "c", state: "s1" }));
  assert.equal(approved.location, "/");
  const session = [].concat(approved.headers["Set-Cookie"]).find((value) => value.startsWith("studio_account=") && !value.startsWith("studio_account=;"));
  assert.match(session, /SameSite=Strict/);
  assert.equal(accountForRequest({ ...browser(session.split(";")[0]), path: "/api/gallery", method: "GET" }).role, "user");
});
