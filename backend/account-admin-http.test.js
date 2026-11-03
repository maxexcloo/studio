import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// An administrator and members of a group that grants Cloud Models and Uncensored Models.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-admin-"));
let child;
let base = "";
let admin = "";

async function call(route, { method = "GET", body, cookie = "" } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", "x-studio": "1", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const next = response.headers.getSetCookie().find((value) => value.startsWith("studio_account="));
  return { status: response.status, body: await response.json(), cookie: next?.split(";")[0] };
}
const signIn = async (username, password) =>
  (await call("/api/accounts/sign-in", { method: "POST", body: { username, password } })).cookie;
async function member(name) {
  const username = `${name}@example.com`;
  const created = await call("/api/accounts/users", {
    method: "POST",
    cookie: admin,
    body: { username, password: `fixture ${name} password`, accessProfileId: "open" },
  });
  assert.equal(created.status, 201, created.body.error);
  return {
    id: created.body.account.id,
    cookie: await signIn(username, `fixture ${name} password`),
  };
}
const accountRoute = (id) => `/api/accounts/users/${encodeURIComponent(id)}`;

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
  admin = (
    await call("/api/accounts/bootstrap", {
      method: "POST",
      body: { username: "administrator", password: "fixture administrator password" },
    })
  ).cookie;
  const saved = await call("/api/accounts/profiles", {
    method: "POST",
    cookie: admin,
    body: {
      id: "open",
      name: "Open",
      allModels: true,
      features: { cloudModels: true, uncensoredModels: true },
    },
  });
  assert.equal(saved.status, 200, saved.body.error);
});

after(async () => {
  const stopped = child.exitCode === null ? once(child, "exit") : undefined;
  child.kill("SIGTERM");
  await stopped;
  fs.rmSync(directory, { recursive: true, force: true });
});

test(
  "a member turns granted Cloud and Uncensored Models off for itself",
  { timeout: 30_000 },
  async () => {
    const { cookie } = await member("chooser");
    const features = async () =>
      (await call("/api/accounts/status", { cookie })).body.account.features;
    const shown = await call("/api/preferences", { cookie });
    assert.deepEqual(shown.body.grants, { cloudModels: true, uncensoredModels: true });
    assert.deepEqual(shown.body.saved, []);
    assert.equal((await features()).cloudModels, true);
    const off = await call("/api/preferences", {
      method: "PATCH",
      cookie,
      body: { cloudModels: false, tileCaptions: true },
    });
    assert.equal(off.status, 200, off.body.error);
    assert.deepEqual(off.body.saved, ["cloudModels", "tileCaptions"]);
    assert.equal((await features()).cloudModels, false);
    assert.equal((await features()).uncensoredModels, true);
    // An administrator's grants are its role, not a group, so it has nothing to turn off here.
    const refused = await call("/api/preferences", {
      method: "PATCH",
      cookie: admin,
      body: { uncensoredModels: false },
    });
    assert.equal(refused.status, 400);
    assert.equal(
      (
        await call("/api/preferences", {
          method: "PATCH",
          cookie: admin,
          body: { tileCaptions: true },
        })
      ).body.preferences.tileCaptions,
      true,
    );
  },
);

test(
  "administrators change roles, reset passwords and delete accounts, never their own",
  { timeout: 30_000 },
  async () => {
    const promoted = await member("promoted");
    const self = (await call("/api/accounts/me", { cookie: admin })).body.account.id;
    const patch = (id, body) => call(accountRoute(id), { method: "PATCH", cookie: admin, body });

    assert.equal((await patch(self, { role: "user" })).status, 400);
    assert.equal(
      (await patch(promoted.id, { role: "administrator" })).body.account.role,
      "administrator",
    );
    const promotedAdmin = await call("/api/accounts/admin", { cookie: promoted.cookie });
    assert.equal(promotedAdmin.status, 200, JSON.stringify(promotedAdmin.body));
    const demoted = await patch(promoted.id, { role: "user" });
    assert.equal(
      demoted.body.account.accessProfileId,
      "user",
      "a new user joins the default group",
    );

    const reset = await member("reset");
    assert.equal((await patch(reset.id, { password: "short" })).status, 400);
    assert.equal((await patch(reset.id, { password: "a fresh fixture password" })).status, 200);
    assert.equal((await call("/api/accounts/me", { cookie: reset.cookie })).status, 401);
    assert.ok(await signIn("reset@example.com", "a fresh fixture password"));

    const removed = await member("removed");
    const own = await call(accountRoute(self), { method: "DELETE", cookie: admin });
    assert.equal(own.status, 400, JSON.stringify(own.body));
    assert.equal(
      (await call(accountRoute(removed.id), { method: "DELETE", cookie: admin })).status,
      200,
    );
    assert.equal((await call("/api/accounts/me", { cookie: removed.cookie })).status, 401);
    assert.equal(await signIn("removed@example.com", "fixture removed password"), undefined);
    const { accounts } = (await call("/api/accounts/admin", { cookie: admin })).body;
    assert.equal(
      accounts.some((account) => account.id === removed.id),
      false,
    );
  },
);
