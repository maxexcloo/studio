import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { QueueJob } from "../../shared/queue.ts";
const { startFakeComfy } = await import(new URL("../fixtures/fake-comfy.js", import.meta.url).href);

test(
  "cold configured models queue across restart and start only their selected offline worker",
  { timeout: 30_000 },
  async () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "studio-offline-"));
    const dataDir = path.join(temporary, "runtime");
    const config = path.join(temporary, "ai");
    mkdirSync(path.join(config, "profiles"), { recursive: true });
    const raw = {
      heissUi: {
        id: "cold",
        name: "Cold Model",
        family: "sdxl",
        kind: "image",
        controls: {
          model: { node: "1", input: "ckpt_name" },
          prompt: { node: "3", input: "text" },
          negative: { node: "4", input: "text" },
          width: { node: "5", input: "width" },
          height: { node: "5", input: "height" },
          count: { node: "5", input: "batch_size" },
          steps: { node: "6", input: "steps" },
          cfg: { node: "6", input: "cfg" },
          seed: { node: "6", input: "seed" },
          sampler: { node: "6", input: "sampler_name" },
          scheduler: { node: "6", input: "scheduler" },
        },
      },
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
      },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
      "4": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 64, height: 64, batch_size: 1 } },
      "6": {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["3", 0],
          negative: ["4", 0],
          latent_image: ["5", 0],
          steps: 2,
          cfg: 1,
          seed: 42,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
        },
      },
      "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
      "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "fixture" } },
    };
    const profileFile = path.join(config, "profiles", "cold.json");
    writeFileSync(profileFile, JSON.stringify(raw));
    const removedFile = path.join(config, "profiles", "removed.json");
    writeFileSync(
      removedFile,
      JSON.stringify({
        ...raw,
        heissUi: { ...raw.heissUi, id: "removed", name: "Removed Profile" },
      }),
    );
    writeFileSync(path.join(config, "models.json"), "[]");
    writeFileSync(path.join(config, "lora-catalogue.json"), "{}");
    writeFileSync(path.join(config, "prompting.json"), "{}");
    const info = JSON.parse(
      readFileSync(new URL("../fixtures/object_info-comfyui-0.34.1.json", import.meta.url), "utf8"),
    );
    info.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    const chosen = await startFakeComfy({
      objectInfo: info,
      outputFiles: new Map([["own.png", png]]),
    });
    const other = await startFakeComfy({ objectInfo: info });
    chosen.setDown(true);
    other.setDown(true);
    let allowStart = false,
      running = false,
      starts = 0;
    const engine = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/containers/chosen-container/json")
        return response.end(JSON.stringify({ State: { Running: running } }));
      if (request.url === "/containers/chosen-container/start") {
        if (!allowStart) return response.writeHead(503).end("{}");
        starts++;
        running = true;
        chosen.setDown(false);
        return response.writeHead(204).end();
      }
      response.writeHead(404).end("{}");
    });
    engine.listen(0, "127.0.0.1");
    await once(engine, "listening");
    writeFileSync(
      path.join(config, "workloads.json"),
      JSON.stringify({
        chosen: {
          kind: "image",
          placements: ["0"],
          studio: { container: "chosen-container", placement: "0", url: chosen.url },
        },
      }),
    );
    let child: ChildProcess | undefined,
      base = "",
      cookie = "";
    async function start() {
      child = fork(fileURLToPath(new URL("../index.js", import.meta.url)), [], {
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          STUDIO_ENV_FILE: "/dev/null",
          STUDIO_DATA_DIR: dataDir,
          STUDIO_CONFIG_DIR: config,
          STUDIO_DEMO: "0",
          STUDIO_MULTI_USER: "1",
          STUDIO_ENABLE_GROK: "0",
          STUDIO_ENABLE_BUILTIN_PROFILES: "1",
          STUDIO_OUTPUT_STORAGE: "studio",
          STUDIO_TEXT_ADMISSION_TOKEN: "",
          STUDIO_MEDIA_DIR: path.join(dataDir, "media"),
          STUDIO_CLIPROXYAPI_URL: "",
          CLIPROXYAPI_URL: "",
          COMFY_OUTPUT_DIR: "",
          COMFY_INPUT_DIR: "",
          STUDIO_RUNTIME_AUTOMATIC: "1",
          STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED: "1",
          STUDIO_TEXT_ADMISSION_ACKNOWLEDGED: "1",
          STUDIO_DOCKER_URL: `http://127.0.0.1:${(engine.address() as AddressInfo).port}`,
          STUDIO_WORKERS: JSON.stringify([
            { id: "chosen", name: "Chosen Worker", url: chosen.url, capabilities: ["image"] },
            { id: "other", name: "Other Worker", url: other.url, capabilities: ["image"] },
          ]),
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let errors = "";
      child.stderr!.on("data", (chunk) => {
        errors += String(chunk);
      });
      const ready = await Promise.race([
        once(child, "message").then(([message]) => message as { url: string }),
        once(child, "exit").then(([code]) => {
          throw new Error(`Fixture exited ${code}: ${errors}`);
        }),
      ]);
      base = ready.url.replace("localhost", "127.0.0.1");
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
    async function request(route: string, input?: unknown) {
      return fetch(base + route, {
        method: input === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", cookie },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
    }
    async function api(route: string, input?: unknown): Promise<any> {
      const response = await request(route, input);
      const result = await response.json();
      assert.equal(response.ok, true, `${route}: ${JSON.stringify(result)}`);
      const nextCookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("studio_account="));
      if (nextCookie) cookie = nextCookie.split(";")[0];
      return result;
    }
    async function waitFor(id: string, predicate: (job: QueueJob) => boolean) {
      const deadline = Date.now() + 12_000;
      let job: QueueJob | undefined;
      while (Date.now() < deadline) {
        job = (await api("/api/queue")).jobs.find((item: QueueJob) => item.id === id);
        if (job && predicate(job)) return job;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Queued fixture did not reach expected state: ${job?.status} ${job?.reason}`);
    }
    try {
      await start();
      await api("/api/accounts/bootstrap", {
        username: "administrator",
        password: "fixture administrator password",
      });
      const cold = await api("/api/models");
      const profile = cold.profiles.find((item: any) => item.id === "custom:cold");
      assert.ok(profile);
      assert.equal(profile.ready, undefined);
      assert.equal(profile.availability, "offline");
      assert.equal(profile.defaults.width, 64);
      assert.equal(
        cold.workers.every((worker: any) => !worker.available),
        true,
      );
      const input = {
        ...profile.defaults,
        profileId: profile.id,
        model: profile.model,
        workflow: profile.workflow,
        kind: "image",
        prompt: "Neutral white teapot",
        backendId: "chosen",
        allowFallback: false,
      };
      assert.equal((await request("/api/generate", { ...input, prompt: "" })).status, 400);
      assert.equal((await request("/api/generate", { ...input, width: 1e9 })).status, 400);
      assert.equal((await request("/api/generate", { ...input, count: 1e9 })).status, 400);
      assert.equal(
        (
          await request("/api/generate", {
            ...input,
            referenceAssets: [{ assetId: "foreign-reference" }],
          })
        ).status,
        400,
      );
      const session = (await api("/api/sessions", { title: "Validate Waiting Input" })).session;
      assert.equal(
        (await request(`/api/sessions/${session.id}/generations`, { ...input, prompt: "" })).status,
        400,
      );
      assert.equal(
        (
          await request("/api/generate", {
            ...input,
            profileId: "custom:missing",
            model: "custom:missing",
          })
        ).status,
        400,
      );
      const adminCookie = cookie;
      await api("/api/accounts/profiles", {
        id: "denied",
        name: "No Generation",
        allModels: true,
        features: { gallery: true, imageGeneration: false },
      });
      await api("/api/accounts/users", {
        username: "denied",
        password: "fixture denied password",
        accessProfileId: "denied",
      });
      cookie = "";
      await api("/api/accounts/sign-in", {
        username: "denied",
        password: "fixture denied password",
      });
      assert.equal((await request("/api/generate", input)).status, 403);
      const deniedSession = (await api("/api/sessions", { title: "Denied" })).session;
      assert.equal(
        (await request(`/api/sessions/${deniedSession.id}/generations`, input)).status,
        403,
      );
      cookie = adminCookie;
      const accepted = await api("/api/generate", input);
      const waiting = await waitFor(accepted.jobId, (job) => job.status === "waiting");
      assert.equal(waiting.backend, "chosen");
      await stop();
      other.setDown(false);
      await start();
      const restored = await waitFor(accepted.jobId, (job) => job.status === "waiting");
      assert.equal(restored.backend, "chosen");
      assert.equal(chosen.prompts.length + other.prompts.length, 0);
      const nextPrompt = chosen.nextPrompt();
      allowStart = true;
      const submitted = await nextPrompt;
      assert.equal(submitted.client_id, accepted.jobId);
      const acknowledged = await waitFor(accepted.jobId, (job) => Boolean(job.providerJobId));
      assert.equal(acknowledged.backend, "chosen");
      assert.equal(starts, 1);
      assert.equal(other.prompts.length, 0);
      chosen.finish(submitted.id, {
        outputs: { 8: { images: [{ filename: "own.png", type: "output", subfolder: "" }] } },
      });
      const saved = await waitFor(accepted.jobId, (job) => job.status === "completed");
      assert.equal(new URL(saved.outputs[0].url!, base).searchParams.get("type"), "media");
      assert.equal(chosen.prompts.length, 1);
      const observed = await api("/api/models");
      const builtin = observed.profiles.find((item: any) => !item.id.startsWith("custom:"));
      assert.ok(builtin);
      await stop();
      chosen.setDown(true);
      other.setDown(true);
      running = false;
      writeFileSync(
        path.join(dataDir, "per-model-workflows.json"),
        JSON.stringify([{ id: profile.id, model: profile.model, name: "Stale Runtime Title" }]),
      );
      writeFileSync(
        profileFile,
        JSON.stringify({
          ...raw,
          heissUi: {
            ...raw.heissUi,
            name: "Changed Seed Title",
            nsfw: true,
            defaults: { steps: 9 },
          },
        }),
      );
      writeFileSync(
        path.join(dataDir, "workflows", "cold.json"),
        JSON.stringify({
          ...raw,
          heissUi: {
            ...raw.heissUi,
            name: "Current Studio Title",
            nsfw: true,
            defaults: { steps: 7 },
          },
        }),
      );
      rmSync(removedFile);
      await start();
      const reopened = await api("/api/models");
      const current = reopened.profiles.find((item: any) => item.id === profile.id);
      assert.equal(current.label, "Current Studio Title");
      assert.equal(current.defaults.steps, 7);
      assert.equal(current.nsfw, true);
      assert.equal(
        reopened.profiles.some((item: any) => item.id === "custom:removed"),
        true,
        "removing an ai seed does not delete Studio’s existing runtime profile",
      );
      const cached = reopened.profiles.find((item: any) => item.id === builtin.id);
      assert.equal(cached.availability, "offline");
      assert.equal(cached.ready, undefined);
    } finally {
      await stop();
      await Promise.all([chosen.close(), other.close()]);
      engine.closeAllConnections();
      await new Promise<void>((resolve) => engine.close(() => resolve()));
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
