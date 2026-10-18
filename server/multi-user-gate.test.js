import assert from "node:assert/strict";
import test from "node:test";
import { enforceMultiUserRequest } from "./multi-user-gate.js";

function call(path, account = null) {
  const res = {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let continued = false;
  enforceMultiUserRequest({ path }, res, () => { continued = true; }, { accountForRequest: () => account });
  return { res, continued };
}

test("account mode requires identity on loopback and exposes only sign-in/bootstrap routes", () => {
  const anonymous = call("/api/gallery");
  assert.equal(anonymous.res.statusCode, 401);
  assert.equal(anonymous.res.headers["X-HEISS-Sign-In"], "1");
  assert.equal(call("/api/accounts/status").continued, true);
  assert.equal(call("/api/accounts/bootstrap").continued, true);
});

test("ordinary accounts cannot enter shared data stores or raw ComfyUI, administrators can", () => {
  const user = { userId: "user", role: "user" };
  assert.equal(call("/api/gallery", user).res.body.reason, "ownership-pending");
  assert.equal(call("/comfy/prompt", user).res.statusCode, 403);
  assert.equal(call("/api/gallery", { userId: "admin", role: "administrator" }).continued, true);
  assert.equal(call("/comfy/prompt", { userId: "admin", role: "administrator" }).continued, true);
});
