import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the site preview confines static files and preserves demo board sessions", { timeout: 15000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const sibling = fs.mkdtempSync(path.join(root, "docs-preview-"));
  fs.writeFileSync(path.join(sibling, "private.txt"), "outside the website");
  t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["scripts/site-preview.mjs", "--demo"], {
    cwd: root,
    env: { ...process.env, BOARD_ADMIN_PASSWORD: "preview-test-password", PORT: "0" },
    stdio: ["ignore", "pipe", "ignore"]
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  const origin = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => reject(new Error("The site preview stopped before listening")));
    child.stdout.on("data", (chunk) => {
      const address = chunk.toString().match(/Website on (http:\/\/127\.0\.0\.1:\d+)/);
      if (address) resolve(address[1]);
    });
  });
  const escaped = await fetch(`${origin}/..%2f${path.basename(sibling)}/private.txt`);
  assert.notEqual(escaped.status, 200);
  assert.notEqual(await escaped.text(), "outside the website");
  assert.ok((await fetch(`${origin}/%ZZ`)).status >= 400);
  assert.equal((await fetch(`${origin}/`)).status, 200);
  const head = await fetch(`${origin}/board/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /text\/html/);
  assert.equal(await head.text(), "");
  const board = await (await fetch(`${origin}/api/board/`)).json();
  assert.ok(board.cards.length > 0);
  const login = await fetch(`${origin}/api/board`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ action: "login", password: "preview-test-password" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.match(cookie, /hb_admin=/);
  const signedIn = await (await fetch(`${origin}/api/board?view=all`, { headers: { cookie } })).json();
  assert.equal(signedIn.admin, true);
});
