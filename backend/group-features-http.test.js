import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// A member of a group saved without Chat or Dream settings, as groups were before they existed, and a
// member of a group that turns both off.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-group-features-"));
let child;
let base = "";
const cookies = { member: "", limited: "" };

async function call(route, { method = "GET", body, cookie = "" } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const next = response.headers.getSetCookie().find((value) => value.startsWith("studio_account="));
  return { status: response.status, body: await response.json(), cookie: next?.split(";")[0] };
}

before(async () => {
  child = fork(fileURLToPath(new URL("./index.js", import.meta.url)), [], {
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      HOST: "127.0.0.1",
      STUDIO_ENV_FILE: "/dev/null",
      STUDIO_DATA_DIR: directory,
      STUDIO_DEMO: "1",
      STUDIO_MULTI_USER: "1",
      STUDIO_WORKERS: "[]",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const [ready] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => {
      throw new Error("The fixture exited before readiness.");
    }),
  ]);
  base = ready.url.replace("localhost", "127.0.0.1");
  const { cookie: admin } = await call("/api/accounts/bootstrap", {
    method: "POST",
    body: { username: "administrator", password: "fixture administrator password" },
  });
  for (const group of [
    { id: "plain", name: "Plain", allModels: true },
    { id: "limited", name: "Limited", allModels: true, features: { chat: false, dream: false } },
  ]) {
    const saved = await call("/api/accounts/profiles", {
      method: "POST",
      cookie: admin,
      body: group,
    });
    assert.equal(saved.status, 200, saved.body.error);
  }
  for (const [name, group] of [
    ["member", "plain"],
    ["limited", "limited"],
  ]) {
    const username = `${name}@example.com`;
    const password = `fixture ${name} password`;
    const created = await call("/api/accounts/users", {
      method: "POST",
      cookie: admin,
      body: { username, password, accessProfileId: group },
    });
    assert.equal(created.status, 201, created.body.error);
    cookies[name] = (
      await call("/api/accounts/sign-in", { method: "POST", body: { username, password } })
    ).cookie;
  }
});

after(async () => {
  const stopped = child.exitCode === null ? once(child, "exit") : undefined;
  child.kill("SIGTERM");
  await stopped;
  fs.rmSync(directory, { recursive: true, force: true });
});

test("Dream is on unless the account's group turns it off", { timeout: 30_000 }, async () => {
  assert.equal((await call("/api/dream", { cookie: cookies.member })).status, 200);
  const refused = await call("/api/dream", { cookie: cookies.limited });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "Dream is unavailable for this account.");
});

test("Chat is on unless the account's group turns it off", { timeout: 30_000 }, async () => {
  const off = "Chat is off for this account.";
  assert.notEqual((await call("/api/chat/status", { cookie: cookies.member })).body.reason, off);
  assert.equal((await call("/api/chat/status", { cookie: cookies.limited })).body.reason, off);
  const refused = await call("/api/sessions/any/chat", { cookie: cookies.limited });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, off);
});
