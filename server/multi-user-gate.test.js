import assert from "node:assert/strict";
import test from "node:test";
import { enforceMultiUserRequest } from "./multi-user-gate.js";

function call(path, account = null, method = "GET") {
  const res = {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let continued = false;
  enforceMultiUserRequest({ path, method }, res, () => { continued = true; }, { accountForRequest: () => account });
  return { res, continued };
}

test("account mode requires identity on loopback and exposes only sign-in/bootstrap routes", () => {
  const anonymous = call("/api/gallery");
  assert.equal(anonymous.res.statusCode, 401);
  assert.equal(anonymous.res.headers["X-HEISS-Sign-In"], "1");
  assert.equal(call("/api/accounts/status").continued, true);
  assert.equal(call("/api/accounts/bootstrap").continued, true);
  // Container liveness and readiness probes carry no account.
  assert.equal(call("/api/ping").continued, true);
  assert.equal(call("/api/ready").continued, true);
});

test("ordinary accounts reach only reviewed owner-scoped routes; administrators reach everything", () => {
  const user = { userId: "user", role: "user" };
  for (const [method, path] of [
    ["GET", "/api/gallery"], ["GET", "/api/gallery/delta"], ["POST", "/api/generate"], ["GET", "/api/jobs/abc-1"],
    ["POST", "/api/jobs/abc-1/cancel"], ["GET", "/api/reference-assets/a1/thumbnail"], ["POST", "/api/reference-assets/upload"],
    ["GET", "/api/loras/library"], ["GET", "/api/comfy/status"], ["GET", "/api/ai-control"], ["GET", "/api/ai-control/status"], ["GET", "/comfy/view"], ["HEAD", "/comfy/thumb"], ["POST", "/api/accounts/mcp-token/revoke"]
  ]) assert.equal(call(path, user, method).continued, true, `${method} ${path}`);
  for (const [method, path] of [
    ["POST", "/api/gallery/clear"], ["GET", "/api/gallery/trash"], ["GET", "/api/presets"], ["GET", "/api/library/file"],
    ["POST", "/api/shutdown"], ["GET", "/api/accounts/admin"], ["POST", "/api/accounts/users"], ["PUT", "/api/sizes"],
    ["PUT", "/api/workflows/preferences"], ["POST", "/comfy/prompt"], ["GET", "/comfy/history"],
    ["DELETE", "/api/loras"], ["POST", "/api/start-image"], ["GET", "/api/logs"],
    ["POST", "/api/ai-control/plan"], ["POST", "/api/ai-control/apply"], ["POST", "/api/ai-control/restart"], ["GET", "/api/ai-control/jobs/abc"]
  ]) {
    const denied = call(path, user, method);
    assert.equal(denied.continued, false, `${method} ${path}`);
    assert.equal(denied.res.statusCode, 403, `${method} ${path}`);
  }
  assert.equal(call("/api/gallery/clear", { userId: "admin", role: "administrator" }, "POST").continued, true);
  assert.equal(call("/comfy/prompt", { userId: "admin", role: "administrator" }, "POST").continued, true);
});
