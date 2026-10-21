import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-setup-token-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_MULTI_USER = "1";
process.env.STUDIO_SETUP_TOKEN = "a-deployment-setup-token-of-sufficient-length";
process.env.COMFY_URL = "http://127.0.0.1:9";
const { checkSetupToken, registerMultiUserAuthRoutes } = await import("./multi-user-auth.js");

const routes = {};
registerMultiUserAuthRoutes({
  get: (route, handler) => { routes[`GET ${route}`] = handler; },
  post: (route, handler) => { routes[`POST ${route}`] = handler; },
  patch: (route, handler) => { routes[`PATCH ${route}`] = handler; }
});

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

// A container platform reaches HEISS through a proxy: never "this computer".
const remote = (body) => ({ socket: { remoteAddress: "10.0.0.5" }, headers: { host: "studio.example.test", "x-forwarded-for": "203.0.113.4" }, body });

test("a deployment setup token creates the first administrator remotely, once", async () => {
  const status = await call(routes["GET /api/accounts/status"], remote({}));
  assert.equal(status.body.setupTokenAccepted, true);
  const wrong = await call(routes["POST /api/accounts/bootstrap"], remote({ username: "recovery", password: "a secure recovery password", setupToken: "guessed" }));
  assert.equal(wrong.statusCode, 403);
  const created = await call(routes["POST /api/accounts/bootstrap"], remote({ username: "recovery", password: "a secure recovery password", setupToken: process.env.STUDIO_SETUP_TOKEN }));
  assert.equal(created.statusCode, 201);
  const again = await call(routes["POST /api/accounts/bootstrap"], remote({ username: "second", password: "a secure second password", setupToken: process.env.STUDIO_SETUP_TOKEN }));
  assert.equal(again.statusCode, 409);
  assert.equal((await call(routes["GET /api/accounts/status"], remote({}))).body.setupTokenAccepted, undefined);
});

test("a setup token shorter than 32 characters is refused, not ignored", () => {
  assert.throws(() => checkSetupToken("too-short"), /STUDIO_SETUP_TOKEN must be at least 32 characters/);
  assert.doesNotThrow(() => checkSetupToken(undefined));
  assert.doesNotThrow(() => checkSetupToken("x".repeat(32)));
});
