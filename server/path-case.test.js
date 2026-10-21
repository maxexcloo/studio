import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gatedPath } from "./gated-path.js";

test("every casing of the API and ComfyUI prefixes is gated", () => {
  for (const value of ["/api/paths", "/API/paths", "/Api/x", "/comfy/view", "/COMFY/view", "/cOmFy"]) assert.equal(gatedPath(value), true, value);
  for (const value of ["/", "/assets/app.js", "/apix", "/media"]) assert.equal(gatedPath(value), value === "/apix");
});

const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

test("capitalised API paths reach no handler, with or without accounts", { timeout: 60_000 }, async (t) => {
  for (const multiUser of ["1", ""]) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-path-case-"));
    const port = await freePort();
    const child = spawn(process.execPath, ["server/index.js"], {
      env: { ...process.env, NODE_TEST_CONTEXT: "", COMFY_URL: "http://127.0.0.1:1", COMFY_VIDEO_URL: "", STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, ".env"), STUDIO_DEMO: "1", STUDIO_LAN: "0", HOST: "127.0.0.1", PORT: String(port), STUDIO_MULTI_USER: multiUser },
      stdio: "ignore"
    });
    t.after(() => { child.kill(); fs.rmSync(data, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(`${base}/api/ping`)).ok) break; } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const route of ["/API/paths", "/Api/workflows", "/API/comfy/status"]) {
      const response = await fetch(`${base}${route}`, { headers: { host: "evil.example" } });
      const text = await response.text();
      assert.equal(/outputDir|galleryDir|comfyUrl|"workflows"/.test(text), false, `${multiUser ? "multi" : "single"}-user ${route} leaked: ${text.slice(0, 120)}`);
    }
    const cancel = await fetch(`${base}/API/queue/cancel`, { method: "POST", headers: { "content-type": "text/plain", "sec-fetch-site": "cross-site" }, body: "{}" });
    assert.notEqual(cancel.status, 200, `${multiUser ? "multi" : "single"}-user cross-site POST was accepted`);
    child.kill();
  }
});
