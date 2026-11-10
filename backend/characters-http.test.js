import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

test(
  "character cards belong to their account, hold its own images and follow the Characters grant",
  { timeout: 30_000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-characters-http-"));
    const child = fork(fileURLToPath(new URL("./index.js", import.meta.url)), [], {
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
    t.after(async () => {
      const stopped = child.exitCode === null ? once(child, "exit") : undefined;
      child.kill("SIGTERM");
      await stopped;
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error("The fixture exited before readiness.");
      }),
    ]);
    const base = ready.url.replace("localhost", "127.0.0.1");
    async function call(route, { method = "GET", body, cookie = "" } = {}) {
      const response = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json", "X-Studio": "1", cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const next = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("studio_account="));
      return { status: response.status, body: await response.json(), cookie: next?.split(";")[0] };
    }
    const { cookie: admin } = await call("/api/accounts/bootstrap", {
      method: "POST",
      body: { username: "administrator", password: "fixture administrator password" },
    });
    for (const group of [
      { id: "plain", name: "Plain", allModels: true },
      { id: "limited", name: "Limited", allModels: true, features: { characters: false } },
    ])
      assert.equal(
        (await call("/api/accounts/profiles", { method: "POST", cookie: admin, body: group }))
          .status,
        200,
      );
    const cookies = {};
    for (const [name, group] of [
      ["artist", "plain"],
      ["other", "plain"],
      ["limited", "limited"],
    ]) {
      const credentials = { username: name, password: `fixture ${name} password` };
      await call("/api/accounts/users", {
        method: "POST",
        cookie: admin,
        body: { ...credentials, accessProfileId: group },
      });
      cookies[name] = (
        await call("/api/accounts/sign-in", { method: "POST", body: credentials })
      ).cookie;
    }
    const upload = async (cookie, background) => {
      const form = new FormData();
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background } })
        .png()
        .toBuffer();
      form.append("image", new Blob([bytes], { type: "image/png" }), "face.png");
      const response = await fetch(base + "/api/reference-assets/upload", {
        method: "POST",
        headers: { cookie, "X-Studio": "1" },
        body: form,
      });
      return (await response.json()).asset;
    };
    const front = await upload(cookies.artist, "red");
    const side = await upload(cookies.artist, "green");
    const theirs = await upload(cookies.other, "blue");
    const card = {
      name: "Mara",
      description: "red-haired ranger, green cloak, scar over left eye",
      referenceIds: [front.id, side.id],
    };
    const created = await call("/api/characters", {
      method: "POST",
      cookie: cookies.artist,
      body: card,
    });
    assert.equal(created.status, 201, created.body.error);
    const { id } = created.body.character;
    assert.deepEqual(
      created.body.character.references.map((asset) => asset.id),
      [front.id, side.id],
    );
    // Another account's image, none, or more than four are refused.
    for (const referenceIds of [[theirs.id], [], [front.id, side.id, "a", "b", "c"]]) {
      const refused = await call("/api/characters", {
        method: "POST",
        cookie: cookies.artist,
        body: { ...card, referenceIds },
      });
      assert.equal(refused.status, 400);
    }
    const updated = await call(`/api/characters/${id}`, {
      method: "PUT",
      cookie: cookies.artist,
      body: { ...card, name: "Mara the Ranger", referenceIds: [side.id] },
    });
    assert.equal(updated.status, 200);
    const listed = (await call("/api/characters", { cookie: cookies.artist })).body.characters;
    assert.deepEqual(
      listed.map((item) => [item.name, item.referenceIds]),
      [["Mara the Ranger", [side.id]]],
    );
    // Cards are per account, and a group without Characters is refused.
    assert.deepEqual(
      (await call("/api/characters", { cookie: cookies.other })).body.characters,
      [],
    );
    const foreign = await call(`/api/characters/${id}`, {
      method: "DELETE",
      cookie: cookies.other,
    });
    assert.equal(foreign.status, 404, foreign.body.error);
    const limited = await call("/api/characters", { cookie: cookies.limited });
    assert.deepEqual(
      [limited.status, limited.body.error],
      [403, "Characters are off for this account."],
    );
    // A deleted gallery image drops out of the card rather than breaking it.
    await call(`/api/gallery/${encodeURIComponent(side.galleryItemId)}`, {
      method: "DELETE",
      cookie: cookies.artist,
    });
    const [kept] = (await call("/api/characters", { cookie: cookies.artist })).body.characters;
    assert.deepEqual([kept.references.length, kept.missing], [0, 1]);
    assert.equal(
      (await call(`/api/characters/${id}`, { method: "DELETE", cookie: cookies.artist })).status,
      200,
    );
    assert.deepEqual(
      (await call("/api/characters", { cookie: cookies.artist })).body.characters,
      [],
    );
  },
);
