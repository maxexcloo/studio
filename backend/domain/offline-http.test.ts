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
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
const { startFakeComfy } = await import(new URL("../fixtures/fake-comfy.js", import.meta.url).href);

test(
  "cold configured models queue across restart and start only their selected offline worker",
  { timeout: 30_000 },
  async () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "studio-offline-"));
    const dataDir = path.join(temporary, "runtime");
    mkdirSync(path.join(dataDir, "workflows"), { recursive: true });
    const raw = {
      studio: {
        id: "cold",
        name: "Cold Model",
        family: "sdxl",
        kind: "image",
        mediaInputs: Array.from({ length: 10 }, (_, index) => ({
          id: `reference-${index + 1}`,
          kind: "image",
          max: 1,
          control: { node: String(100 + index), input: "image" },
        })),
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
    Object.assign(
      raw,
      Object.fromEntries(
        raw.studio.mediaInputs.map((slot) => [
          slot.control.node,
          {
            class_type: "LoadImage",
            inputs: { image: "" },
          },
        ]),
      ),
    );
    const profileFile = path.join(dataDir, "workflows", "cold.json");
    writeFileSync(profileFile, JSON.stringify(raw));
    const info = JSON.parse(
      readFileSync(
        new URL("../fixtures/object_info-comfyui-0.41.0-master-ce1e922.json", import.meta.url),
        "utf8",
      ),
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
    // The chosen worker's deployment is stopped, and its pod cannot get a GPU until allowed.
    const kube = fakeKubernetes([{ namespace: "comfyui", name: "chosen" }], {
      tickOnRead: true,
      onChange: (_name, ready) => chosen.setDown(!ready),
    });
    const deployment = kube.deployments.get("comfyui/chosen")!;
    deployment.unschedulable = "0/1 nodes are available: 1 cannot allocate all claims.";
    const starts = () => kube.log.filter((entry) => entry === "scale comfyui/chosen 1").length;
    const engine = createServer(kube.handle);
    engine.listen(0, "127.0.0.1");
    await once(engine, "listening");
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
          STUDIO_DEMO: "0",
          STUDIO_MULTI_USER: "1",
          STUDIO_ENABLE_GROK: "0",
          STUDIO_OUTPUT_STORAGE: "studio",
          STUDIO_MEDIA_DIR: path.join(dataDir, "media"),
          STUDIO_CLIPROXYAPI_URL: "",
          STUDIO_COMFY_OUTPUT_DIR: "",
          STUDIO_COMFY_INPUT_DIR: "",
          STUDIO_RUNTIME_AUTOMATIC: "1",
          STUDIO_KUBERNETES_GPUS: JSON.stringify({ gpu: 1 }),
          STUDIO_KUBERNETES_URL: `http://127.0.0.1:${(engine.address() as AddressInfo).port}`,
          STUDIO_KUBERNETES_WORKLOADS: JSON.stringify({
            chosen: {
              kind: "image",
              namespace: "comfyui",
              deployment: "chosen",
              pool: "gpu",
              gpus: 1,
              url: chosen.url,
            },
          }),
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
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "owned-reference.png");
      const uploaded = await fetch(base + "/api/reference-assets/upload", {
        method: "POST",
        headers: { cookie, "X-Studio": "1" },
        body: form,
      });
      assert.equal(uploaded.status, 201);
      const assetId = (await uploaded.json()).asset.id;
      const references = profile.mediaInputs.map((slot: any) => ({ slot: slot.id, assetId }));
      const input = {
        ...profile.defaults,
        profileId: profile.id,
        model: profile.model,
        workflow: profile.workflow,
        kind: "image",
        prompt: "Neutral white teapot",
        backendId: "chosen",
        allowFallback: false,
        referenceAssets: references,
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
      const excess = await request("/api/generate", {
        ...input,
        referenceAssets: [...references, references[0]],
      });
      assert.equal(excess.status, 400);
      assert.match((await excess.json()).error, /accepts at most 1 image/);
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
      const restored = await waitFor(
        accepted.jobId,
        (job) => job.status === "waiting" && /Waiting for a GPU/.test(job.reason || ""),
      );
      assert.equal(restored.backend, "chosen");
      assert.match(restored.reason, /^Waiting for chosen to start\. Waiting for a GPU: 0\/1 nodes/);
      assert.deepEqual(restored.input.referenceAssets, references);
      assert.equal(chosen.prompts.length + other.prompts.length, 0);
      const nextPrompt = chosen.nextPrompt();
      delete deployment.unschedulable;
      const submitted = await nextPrompt;
      assert.equal(submitted.client_id, accepted.jobId);
      assert.equal(chosen.uploads.length, 10);
      for (const [index, slot] of raw.studio.mediaInputs.entries())
        assert.equal(
          submitted.prompt[slot.control.node].inputs.image,
          `fixture-input-${index + 1}.png`,
        );
      const acknowledged = await waitFor(accepted.jobId, (job) => Boolean(job.providerJobId));
      assert.equal(acknowledged.backend, "chosen");
      assert.equal(starts(), 1);
      assert.equal(other.prompts.length, 0);
      chosen.finish(submitted.id, {
        outputs: { 8: { images: [{ filename: "own.png", type: "output", subfolder: "" }] } },
      });
      const saved = await waitFor(accepted.jobId, (job) => job.status === "completed");
      assert.equal(new URL(saved.outputs[0].url!, base).searchParams.get("type"), "media");
      assert.equal(chosen.prompts.length, 1);
      await stop();
      chosen.setDown(true);
      other.setDown(true);
      deployment.replicas = 0;
      deployment.pods = [];
      writeFileSync(
        profileFile,
        JSON.stringify({
          ...raw,
          studio: {
            ...raw.studio,
            name: "Current Studio Title",
            uncensored: true,
            defaults: { steps: 7 },
          },
        }),
      );
      await start();
      const reopened = await api("/api/models");
      const current = reopened.profiles.find((item: any) => item.id === profile.id);
      assert.equal(current.label, "Current Studio Title");
      assert.equal(current.defaults.steps, 7);
      assert.equal(current.uncensored, true);
      assert.equal(current.availability, "offline");
      assert.equal(current.ready, undefined);
    } finally {
      await stop();
      await Promise.all([chosen.close(), other.close()]);
      engine.closeAllConnections();
      await new Promise<void>((resolve) => engine.close(() => resolve()));
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
