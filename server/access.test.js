import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-access-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_URL = "http://127.0.0.1:9";
// Devices are only ever let in with LAN mode on.
process.env.STUDIO_ALLOW_LAN = "1";

const access = await import("./access.js");
const { createGuessLimiter } = await import("./guess-limit.js");

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, getHeader(name) { return this.headers[name]; } };
}
/** A request from `address` carrying the cookies a response set (and any given). */
function request(address, res = null, extra = "") {
  const cookies = [].concat(res?.headers["Set-Cookie"] || []).map((line) => line.split(";")[0]).filter((pair) => !/=$/.test(pair));
  return { socket: { remoteAddress: address }, headers: { cookie: [...cookies, extra].filter(Boolean).join("; "), "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1" } };
}

test("the studio password is its own, and setting it signs every device out", async () => {
  assert.equal(access.studioPasswordSet(), false);
  assert.equal(await access.checkStudioPassword("anything at all"), false);
  await assert.rejects(() => access.setStudioPassword("short"), /8 characters/);
  await access.setStudioPassword("studio password 1");
  assert.equal(access.studioPasswordSet(), true);
  assert.equal(await access.checkStudioPassword("studio password 1"), true);
  assert.equal(await access.checkStudioPassword("studio password 2"), false);
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, "data", "access.json"), "utf8"));
  assert.ok(!JSON.stringify(saved).includes("studio password 1"), "only a scrypt hash is kept");

  const res = response();
  access.startDeviceSession(request("192.168.1.40"), res);
  assert.ok(access.deviceSession(request("192.168.1.40", res)));
  await access.setStudioPassword("studio password 2");
  access.reloadAccess();
  assert.equal(access.deviceSession(request("192.168.1.40", res)), null);
});

test("a device session lives in an HttpOnly cookie, a week at most, and only its hash is kept", () => {
  const res = response();
  const session = access.startDeviceSession(request("192.168.1.40"), res);
  const cookie = [].concat(res.headers["Set-Cookie"]).join("\n");
  assert.match(cookie, /studio_device=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=604800/);
  assert.doesNotMatch(cookie, /Secure/, "plain http has no Secure");
  const token = cookie.match(/studio_device=([^;]+)/)[1];
  const saved = fs.readFileSync(path.join(temporary, "data", "access.json"), "utf8");
  assert.ok(!saved.includes(token), "the token itself is never stored");
  assert.equal(session.label, "iPhone · Safari");
  assert.equal(access.deviceSession(request("192.168.1.40", res))?.id, session.id);
  assert.equal(access.deviceSession(request("192.168.1.40", null, "studio_device=forged")), null);

  const secure = response();
  access.startDeviceSession({ ...request("192.168.1.41"), socket: { remoteAddress: "192.168.1.41", encrypted: true } }, secure);
  assert.match([].concat(secure.headers["Set-Cookie"]).join("\n"), /Secure/);
});

test("a device signed in under the old HEISS UI cookie stays signed in and moves to the new cookie", () => {
  const res = response();
  const session = access.startDeviceSession(request("192.168.1.42"), res);
  const token = [].concat(res.headers["Set-Cookie"]).join("\n").match(/studio_device=([^;]+)/)[1];
  const old = request("192.168.1.42", null, `heiss_device=${token}`);
  assert.equal(access.deviceSession(old)?.id, session.id, "the old cookie still signs in");
  const moved = response();
  assert.equal(access.migrateDeviceCookie(old, moved), true);
  const cookies = [].concat(moved.headers["Set-Cookie"]);
  assert.ok(cookies.some((line) => line.startsWith(`studio_device=${token};`) && /HttpOnly/.test(line) && !/Max-Age=0\b/.test(line)), "the same session under the new name");
  assert.ok(cookies.some((line) => line.startsWith("heiss_device=;") && /Max-Age=0\b/.test(line)), "the old name cleared");
  // With the new cookie there is nothing left to move.
  const fresh = request("192.168.1.42", null, `studio_device=${token}`);
  assert.equal(access.deviceSession(fresh)?.id, session.id);
  assert.equal(access.migrateDeviceCookie(fresh, response()), false);
  // A forged old cookie gets nothing.
  assert.equal(access.migrateDeviceCookie(request("192.168.1.42", null, "heiss_device=forged"), response()), false);
});

test("sign out all devices ends every session, and nothing brings them back", () => {
  const first = response();
  const second = response();
  access.startDeviceSession(request("192.168.1.40"), first);
  access.startDeviceSession(request("192.168.1.50"), second);
  assert.ok(access.endAllDeviceSessions() >= 2);
  access.reloadAccess();
  assert.equal(access.deviceSession(request("192.168.1.40", first)), null);
  assert.equal(access.deviceSession(request("192.168.1.50", second)), null);
  const backup = fs.readFileSync(path.join(temporary, "data", "access.json.bak"), "utf8");
  assert.deepEqual(JSON.parse(backup).sessions, [], "the backup copy does not keep them either");
});

test("admin: always this computer, a signed-in device only when trusted, a proxy never on its own", () => {
  const res = response();
  access.startDeviceSession(request("192.168.1.40"), res);
  const phone = () => request("192.168.1.40", res);
  assert.equal(access.canAdmin(request("127.0.0.1")), true);
  assert.equal(access.devicesMayAdmin(), false, "off by default");
  assert.equal(access.canAdmin(phone()), false);
  access.setDevicesMayAdmin(true);
  assert.equal(access.canAdmin(phone()), true);
  assert.equal(access.canAdmin(request("192.168.1.99")), false, "not signed in");
  const proxied = { ...request("127.0.0.1"), headers: { "x-forwarded-for": "203.0.113.4" } };
  assert.equal(access.canAdmin(proxied), false);
  access.setDevicesMayAdmin(false);
  assert.equal(access.canAdmin(phone()), false);
});

test("the Connection settings are for signed-in devices only, though /api/access/ is open before signing in", async () => {
  const { registerAccessRoutes } = await import("./access-routes.js");
  const routes = {};
  registerAccessRoutes({ get: (route, handler) => { routes[route] = handler; }, post: () => {} });
  const call = (req) => {
    const res = { ...response(), statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    routes["/api/access/devices"](req, res);
    return res;
  };
  const stranger = call(request("192.168.1.77"));
  assert.equal(stranger.statusCode, 401);
  assert.equal(stranger.body.adminFromDevices, undefined);
  const signedIn = response();
  access.startDeviceSession(request("192.168.1.78"), signedIn);
  assert.equal(call(request("192.168.1.78", signedIn)).body.ok, true);
  assert.equal(call(request("127.0.0.1")).body.ok, true);
});

test("guessing: a few free tries, then doubling lockouts, one try at a time, and this computer untouched", async () => {
  let clock = 0;
  const limiter = createGuessLimiter({ freeTries: 3, baseMs: 1000, now: () => clock });
  const wrong = () => Promise.resolve(false);
  for (let index = 0; index < 2; index += 1) assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 0);
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 1000);
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).reason, "locked");
  clock += 1000;
  assert.equal((await limiter.attempt("192.168.1.40", false, wrong)).retryAfterMs, 2000);
  // Another address and this computer are not held up by it.
  assert.equal((await limiter.attempt("192.168.1.41", false, wrong)).reason, "wrong");
  for (let index = 0; index < 20; index += 1) assert.equal((await limiter.attempt("127.0.0.1", true, wrong)).retryAfterMs, 0);
  assert.equal((await limiter.attempt("127.0.0.1", true, () => Promise.resolve("key"))).value, "key");
  // Parallel guesses from one address: only one is checked.
  let release;
  const slow = limiter.attempt("192.168.1.60", false, () => new Promise((resolve) => { release = resolve; }));
  assert.equal((await limiter.attempt("192.168.1.60", false, wrong)).reason, "busy");
  release(true);
  assert.equal((await slow).ok, true);
});
