import assert from "node:assert/strict";
import test from "node:test";
import { enforceMultiUserRequest } from "./multi-user-gate.js";

function call(path, account = null, method = "GET") {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
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
  let continued = false;
  enforceMultiUserRequest(
    { path, method },
    res,
    () => {
      continued = true;
    },
    { accountForRequest: () => account },
  );
  return { res, continued };
}

test("account mode requires identity on loopback and exposes only sign-in/bootstrap routes", () => {
  const anonymous = call("/api/gallery");
  assert.equal(anonymous.res.statusCode, 401);
  assert.equal(anonymous.res.headers["X-Studio-Sign-In"], "1");
  assert.equal(call("/api/accounts/status").continued, true);
  assert.equal(call("/api/accounts/bootstrap").continued, true);
  // Container liveness and readiness probes carry no account.
  assert.equal(call("/api/ping").continued, true);
  assert.equal(call("/api/ready").continued, true);
});

test("ordinary accounts reach only reviewed owner-scoped routes; administrators reach everything", () => {
  const user = { userId: "user", role: "user" };
  for (const [method, path] of [
    ["GET", "/api/gallery"],
    ["GET", "/api/gallery/filters"],
    ["POST", "/api/generate"],
    ["GET", "/api/jobs/abc-1"],
    ["POST", "/api/jobs/abc-1/cancel"],
    ["GET", "/api/reference-assets/a1/thumbnail"],
    ["POST", "/api/reference-assets/upload"],
    ["POST", "/api/reference-assets/a1/gallery"],
    ["GET", "/api/loras/library"],
    ["GET", "/api/services/status"],
    ["GET", "/comfy/view"],
    ["HEAD", "/comfy/thumb"],
    ["POST", "/api/accounts/mcp-token/revoke"],
    ["POST", "/api/suggestions"],
  ])
    assert.equal(call(path, user, method).continued, true, `${method} ${path}`);
  for (const [method, path] of [
    ["GET", "/api/presets"],
    ["POST", "/api/models/downloads"],
    ["GET", "/api/accounts/admin"],
    ["POST", "/api/accounts/users"],
    ["POST", "/comfy/prompt"],
    ["GET", "/comfy/history"],
    ["DELETE", "/api/loras"],
    ["GET", "/api/logs"],
    ["POST", "/api/runtime/restart"],
  ]) {
    const denied = call(path, user, method);
    assert.equal(denied.continued, false, `${method} ${path}`);
    assert.equal(denied.res.statusCode, 403, `${method} ${path}`);
  }
  assert.equal(
    call("/comfy/prompt", { userId: "admin", role: "administrator" }, "POST").continued,
    true,
  );
});
