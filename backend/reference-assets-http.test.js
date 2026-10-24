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
  "exact reference metadata restores owned uploads and generated aliases while enforcing account features",
  { timeout: 30_000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-reference-http-"));
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
        throw new Error("Reference fixture exited before readiness.");
      }),
    ]);
    const base = ready.url.replace("localhost", "127.0.0.1");
    let cookie = "";
    async function request(route, method = "GET", body) {
      return fetch(base + route, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function api(route, method = "GET", body) {
      const response = await request(route, method, body);
      assert.equal(response.ok, true, `${method} ${route}: ${response.status}`);
      const nextCookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("studio_account="));
      if (nextCookie) cookie = nextCookie.split(";")[0];
      return response.json();
    }
    await api("/api/accounts/bootstrap", "POST", {
      username: "administrator",
      password: "fixture administrator password",
    });
    const administratorCookie = cookie;
    const features = {
      imageGeneration: true,
      videoGeneration: true,
      imageReferences: true,
      videoReferences: true,
      gallery: true,
    };
    async function profile(changes = {}) {
      cookie = administratorCookie;
      await api("/api/accounts/profiles", "POST", {
        id: "artists",
        name: "Artists",
        allModels: true,
        features: { ...features, ...changes },
      });
    }
    await profile();
    await api("/api/accounts/users", "POST", {
      username: "artist",
      password: "fixture artist password",
      accessProfileId: "artists",
    });
    cookie = "";
    await api("/api/accounts/sign-in", "POST", {
      username: "artist",
      password: "fixture artist password",
    });
    const artistCookie = cookie;
    const bytes = await sharp({
      create: { width: 32, height: 16, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), "saved-reference.png");
    const uploaded = await fetch(base + "/api/reference-assets/upload", {
      method: "POST",
      headers: { cookie, "X-Studio": "1" },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const upload = (await uploaded.json()).asset;
    const metadata = (id) => api(`/api/reference-assets/${encodeURIComponent(id)}`);
    assert.deepEqual((await metadata(upload.id)).asset, upload);
    const saveRoute = `/api/reference-assets/${encodeURIComponent(upload.id)}/gallery`;
    const saved = (await api(saveRoute, "POST")).item;
    assert.equal((await api(saveRoute, "POST")).item.id, saved.id);
    const savedItems = (await api("/api/gallery")).items.filter((item) => item.id === saved.id);
    assert.equal(savedItems.length, 1);
    assert.deepEqual(
      [savedItems[0].type, savedItems[0].width, savedItems[0].height],
      ["image", 32, 16],
    );
    const savedMedia = await request(saved.url);
    assert.equal(savedMedia.status, 200);
    assert.deepEqual(Buffer.from(await savedMedia.arrayBuffer()), bytes);
    const generated = [];
    for (const kind of ["image", "video"]) {
      const ack = await api("/api/generate", "POST", {
        kind,
        profileId: kind === "image" ? "mock-flux-schnell" : "mock-wan-video",
        prompt: "Neutral reference fixture",
        width: 256,
        height: 256,
        steps: 2,
      });
      const deadline = Date.now() + 10_000;
      let job;
      while (Date.now() < deadline) {
        job = (await api("/api/queue")).jobs.find((item) => item.id === ack.jobId);
        if (["completed", "failed", "cancelled"].includes(job.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(job.status, "completed");
      generated.push((await api("/api/gallery")).items.find((item) => item.jobId === ack.jobId));
    }
    const [image, video] = generated;
    const imageAsset = (
      await api("/api/reference-assets/from-gallery", "POST", { galleryItemId: image.id })
    ).asset;
    const lastFrame = (
      await api("/api/reference-assets/from-gallery", "POST", {
        galleryItemId: video.id,
        frame: "last",
      })
    ).asset;
    assert.deepEqual((await metadata(imageAsset.id)).asset, imageAsset);
    assert.deepEqual((await metadata(lastFrame.id)).asset, lastFrame);
    const legacy = (await metadata(image.id)).asset;
    assert.equal(legacy.id, image.id);
    assert.equal(legacy.url, imageAsset.url);
    assert.equal(legacy.width, imageAsset.width);
    cookie = administratorCookie;
    for (const id of [upload.id, imageAsset.id, lastFrame.id])
      assert.equal((await request(`/api/reference-assets/${encodeURIComponent(id)}`)).status, 404);
    await profile({ gallery: false });
    cookie = artistCookie;
    assert.equal((await request(saveRoute, "POST")).status, 403);
    assert.equal((await metadata(upload.id)).asset.id, upload.id);
    assert.equal(
      (await request(`/api/reference-assets/${encodeURIComponent(imageAsset.id)}`)).status,
      404,
    );
    assert.equal(
      (await request(`/api/reference-assets/${encodeURIComponent(lastFrame.id)}`)).status,
      404,
    );
    await profile({ imageReferences: false, videoReferences: true });
    cookie = artistCookie;
    assert.equal((await metadata(upload.id)).asset.id, upload.id);
    assert.equal((await metadata(lastFrame.id)).asset.id, lastFrame.id);
    await profile({ imageReferences: false, videoReferences: false });
    cookie = artistCookie;
    for (const id of [upload.id, imageAsset.id, lastFrame.id])
      assert.equal((await request(`/api/reference-assets/${encodeURIComponent(id)}`)).status, 404);
  },
);
