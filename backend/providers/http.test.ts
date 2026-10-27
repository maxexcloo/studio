import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { QueueJob } from "../../shared/queue.ts";
const { imageRecipe, readImageMetadata } = await import(
  new URL("../image-metadata.js", import.meta.url).href
);

test(
  "HTTP cloud generation discovers configured profiles and saves media with no Comfy worker",
  { timeout: 15_000 },
  async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-direct-cloud-"));
    const pixels = await sharp({
      create: { width: 32, height: 16, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    let submissions = 0;
    const providerPrompts: string[] = [];
    const provider = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({ data: [{ id: "grok-imagine-image-2.0" }] }));
        return;
      }
      if (req.url === "/v1/images/generations") {
        let body = "";
        for await (const chunk of req) body += chunk;
        providerPrompts.push(JSON.parse(body).prompt);
        submissions++;
        res.end(JSON.stringify({ data: [{ b64_json: pixels.toString("base64") }] }));
        return;
      }
      res.writeHead(404).end("{}");
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    mkdirSync(path.join(dataDir, "workflows"));
    writeFileSync(
      path.join(dataDir, "workflows", "cloud-image.json"),
      JSON.stringify({
        studio: {
          id: "cloud-image",
          name: "Cloud Image",
          family: "grok",
          kind: "image",
          promptComposition: { prefix: "Render: ", suffix: "Neutral studio light." },
          controls: {
            prompt: { node: "1", input: "prompt" },
            model: { node: "1", input: "model" },
            width: { node: "1", input: "width" },
            height: { node: "1", input: "height" },
            count: { node: "1", input: "count" },
          },
        },
        "1": {
          class_type: "GrokMedia",
          inputs: {
            model: "grok-imagine-image-2.0",
            prompt: "",
            width: 256,
            height: 256,
            count: 1,
          },
        },
      }),
    );
    const server = fork(fileURLToPath(new URL("../index.js", import.meta.url)), [], {
      env: {
        ...process.env,
        PORT: "0",
        HOST: "127.0.0.1",
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_DATA_DIR: dataDir,
        STUDIO_WORKERS: "[]",
        STUDIO_DEMO: "0",
        STUDIO_MULTI_USER: "1",
        STUDIO_RUNTIME_AUTOMATIC: "",
        STUDIO_CLIPROXYAPI_URL: providerUrl,
        STUDIO_CLIPROXYAPI_KEY: "fixture-value",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    try {
      const [{ url }] = (await once(server, "message")) as [{ url: string }];
      const base = url.replace("localhost", "127.0.0.1");
      let cookie = "";
      async function api(route: string, method = "GET", input?: object): Promise<any> {
        const response = await fetch(base + route, {
          method,
          headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          ...(input ? { body: JSON.stringify(input) } : {}),
        });
        assert.equal(response.ok, true, `${route}: ${response.status}`);
        const nextCookie = response.headers
          .getSetCookie()
          .find((value) => value.startsWith("studio_account="));
        if (nextCookie) cookie = nextCookie.split(";")[0];
        return await response.json();
      }
      const bootstrap = await api("/api/accounts/bootstrap", "POST", {
        username: "administrator",
        password: "fixture administrator password",
      });
      assert.equal(bootstrap.account.role, "administrator");
      const models = await api("/api/models");
      const profile = models.profiles.find(
        (entry: { id: string }) => entry.id === "custom:cloud-image",
      );
      assert.equal(profile.provider, "cliproxyapi");
      assert.deepEqual(profile.workerIds, []);
      const accepted = await api("/api/generate", "POST", {
        ...profile.defaults,
        model: profile.model,
        profileId: profile.id,
        kind: "image",
        prompt: "A white bird",
        clientJobId: "direct-cloud-fixture",
      });
      const deadline = Date.now() + 10_000;
      let job: QueueJob | undefined;
      while (Date.now() < deadline) {
        job = (await api("/api/queue")).jobs.find((entry: QueueJob) => entry.id === accepted.jobId);
        if (job?.status === "completed" || job?.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(job?.status, "completed", String(job?.reason));
      assert.equal(submissions, 1);
      const gallery = await api("/api/gallery");
      const output = gallery.items.find(
        (entry: { jobId: string }) => entry.jobId === accepted.jobId,
      );
      assert.equal(output.provider, "cliproxyapi");
      assert.equal(output.settings.modelName, "grok-imagine-image-2.0");
      // Chat shows the gallery's record, with its prompt and settings, not the provider's bare file.
      const [shown] = (await api(`/api/sessions/${accepted.sessionId}`)).jobs[0].items;
      assert.equal(shown.id, output.id);
      assert.equal(shown.prompt, "A white bird");
      assert.equal(shown.settings.modelName, "grok-imagine-image-2.0");
      const media = await fetch(base + output.url, { headers: { cookie } });
      assert.equal(media.ok, true);
      const downloaded = Buffer.from(await media.arrayBuffer());
      assert.deepEqual(
        await sharp(downloaded).raw().toBuffer(),
        await sharp(pixels).raw().toBuffer(),
      );
      const metadata = readImageMetadata(downloaded);
      const recipe = imageRecipe(metadata);
      assert.equal(recipe.prompt, "A white bird");
      assert.equal(
        recipe.resources.some(
          (resource: { name: string }) => resource.name === "grok-imagine-image-2.0",
        ),
        true,
      );
      assert.deepEqual(recipe.settings, { width: 32, height: 16 });
      const embedded = JSON.parse(metadata.text.civitai);
      assert.equal(embedded.provider, "cliproxyapi");
      assert.equal(embedded.profileId, profile.id);
      assert.equal(embedded.providerPrompt, "Render: A white bird\n\nNeutral studio light.");
      assert.equal(providerPrompts[0], embedded.providerPrompt);
      const administratorPreset = (
        await api("/api/user-presets", "POST", {
          title: "Administrator Preset",
          input: { prompt: "A bird" },
        })
      ).preset;
      await api("/api/accounts/profiles", "POST", {
        id: "artists",
        name: "Artists",
        allModels: true,
        features: { imageGeneration: true, gallery: true, cloudModels: false, nsfwModels: false },
      });
      await api("/api/accounts/users", "POST", {
        username: "artist",
        password: "fixture artist password",
        accessProfileId: "artists",
      });
      const administratorCookie = cookie;
      cookie = "";
      const artist = await api("/api/accounts/sign-in", "POST", {
        username: "artist",
        password: "fixture artist password",
      });
      assert.equal(artist.account.role, "user");
      const artistCookie = cookie;
      const privatePreset = await fetch(base + `/api/user-presets/${administratorPreset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ title: "Other User" }),
      });
      assert.equal(privatePreset.status, 404);
      const ownPreset = (
        await api("/api/user-presets", "POST", { title: "Birds", input: { prompt: "A bird" } })
      ).preset;
      const updatedPreset = (
        await api(`/api/user-presets/${ownPreset.id}`, "PATCH", {
          title: "Blue Birds",
          input: { prompt: "A blue bird" },
        })
      ).preset;
      assert.equal(updatedPreset.id, ownPreset.id);
      assert.equal(updatedPreset.title, "Blue Birds");
      assert.equal(updatedPreset.input.prompt, "A blue bird");
      assert.equal(
        (await api("/api/models")).profiles.some(
          (entry: { id: string }) => entry.id === profile.id,
        ),
        false,
      );
      const forbidden = await fetch(base + "/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ profileId: profile.id, prompt: "A private bird" }),
      });
      assert.equal(forbidden.status, 403);
      assert.equal(submissions, 1);
      assert.deepEqual((await api("/api/queue")).jobs, []);
      cookie = administratorCookie;
      await api("/api/accounts/profiles", "POST", {
        id: "artists",
        name: "Artists",
        allModels: true,
        features: { imageGeneration: true, gallery: true, cloudModels: true, nsfwModels: false },
      });
      cookie = artistCookie;
      const own = await api("/api/generate", "POST", {
        profileId: profile.id,
        model: profile.model,
        prompt: "An artist's bird",
      });
      const ownDeadline = Date.now() + 10_000;
      let ownJob: QueueJob | undefined;
      while (Date.now() < ownDeadline) {
        ownJob = (await api("/api/queue")).jobs.find((entry: QueueJob) => entry.id === own.jobId);
        if (ownJob?.status === "completed" || ownJob?.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ownJob?.status, "completed", String(ownJob?.reason));
      assert.equal(submissions, 2);
      assert.equal(
        (await api("/api/gallery")).items.every(
          (entry: { jobId: string }) => entry.jobId === own.jobId,
        ),
        true,
      );
    } finally {
      if (server.exitCode === null) {
        const exit = once(server, "exit");
        server.kill("SIGTERM");
        await exit;
      }
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
