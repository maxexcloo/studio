import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

/** Cookies a browser would keep from a response's Set-Cookie headers. */
function keep(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim());
    const [name, ...rest] = pair.split("=");
    const value = rest.join("=");
    if (!value || attributes.some((attribute) => /^max-age=0$/i.test(attribute))) jar.delete(name); else jar.set(name, value);
  }
}
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

test("Sign Out ends the browser's session behind a proxy, with single sign-on configured", { timeout: 60_000 }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-sign-out-"));
  const port = await freePort();
  const setupToken = crypto.randomBytes(24).toString("base64url");
  const child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env, NODE_TEST_CONTEXT: "", COMFY_URL: "http://127.0.0.1:1", COMFY_VIDEO_URL: "", STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, "env"),
      STUDIO_DEMO: "1", STUDIO_LAN: "0", STUDIO_NO_BROWSER: "1", HOST: "127.0.0.1", PORT: String(port), STUDIO_ALLOWED_HOSTS: "studio.example",
      STUDIO_MULTI_USER: "1", STUDIO_SETUP_TOKEN: setupToken,
      STUDIO_OIDC_ISSUER: "https://identity.example", STUDIO_OIDC_CLIENT_ID: "studio", STUDIO_OIDC_REDIRECT_URI: "https://studio.example/api/accounts/oidc/callback", STUDIO_OIDC_LABEL: "Pocket ID"
    },
    stdio: "ignore"
  });
  t.after(async () => { const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exited; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${base}/api/ping`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // As the deployment sees a browser: through the TLS-terminating proxy, from the studio's own page.
  const jar = new Map();
  const browser = (route, init = {}) => fetch(`${base}${route}`, { ...init, headers: { host: "studio.example", "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin", cookie: cookieHeader(jar), ...init.headers } });
  const status = async () => (await (await browser("/api/accounts/status")).json());

  const bootstrap = await browser("/api/accounts/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin@example.com", displayName: "Admin", password: crypto.randomBytes(12).toString("base64url"), setupToken }) });
  assert.equal(bootstrap.status, 201);
  keep(jar, bootstrap);
  assert.equal((await status()).signedIn, true);
  assert.deepEqual((await status()).oidc, { label: "Pocket ID" });

  // A plain same-origin POST, as from the browser console, signs out too.
  const out = await browser("/api/accounts/sign-out", { method: "POST" });
  assert.equal(out.status, 200);
  const cleared = out.headers.getSetCookie().find((line) => line.startsWith("studio_account="));
  assert.match(cleared, /^studio_account=;.*Max-Age=0.*Secure/);
  const token = jar.get("studio_account");
  keep(jar, out);
  assert.equal(jar.has("studio_account"), false);
  const after = await status();
  assert.equal(after.signedIn, false);
  assert.equal(after.account, null);
  // Nothing signs the browser back in: the old token is dead, and the gate asks for sign-in.
  jar.set("studio_account", token);
  assert.equal((await status()).signedIn, false);
  const gallery = await browser("/api/gallery?limit=1");
  assert.equal(gallery.status, 401);
  assert.equal(gallery.headers.get("x-heiss-sign-in"), "1");
  // Another site still can't sign anyone out.
  const crossSite = await browser("/api/accounts/sign-out", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.status, 403);
});
