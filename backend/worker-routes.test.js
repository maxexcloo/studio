import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// Workers end to end: zero workers, several from STUDIO_WORKERS (locked), Studio's own list, and routing by capability.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/object_info-comfyui-0.34.1.json"), "utf8"),
);
const imageInfo = structuredClone(source);
imageInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
const videoInfo = structuredClone(source);
videoInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = [];
videoInfo.UNETLoader.input.required.unet_name[0] = [
  "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
];
videoInfo.CLIPLoader.input.required.clip_name[0] = ["qwen3vl_32b_h3.safetensors"];
videoInfo.VAELoader.input.required.vae_name[0] = [
  "minimax_h3_video_vae.safetensors",
  "minimax_h3_audio_vae.safetensors",
];
const stopped = await startFakeComfy({ objectInfo: imageInfo });
const images = await startFakeComfy({ objectInfo: imageInfo });
const videos = await startFakeComfy({ objectInfo: videoInfo });
stopped.setDown(true);

let server;
let base;
let dataDir;

async function start(environment) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-worker-routes-"));
  const env = {
    ...process.env,
    PORT: "0",
    HOST: "127.0.0.1",
    STUDIO_DATA_DIR: dataDir,
    STUDIO_COMFY_OUTPUT_DIR: "",
    STUDIO_ENABLE_GROK: "0",
    npm_lifecycle_event: "",
    ...environment,
  };
  if (!("STUDIO_WORKERS" in environment)) delete env.STUDIO_WORKERS;
  server = fork(path.join(here, "index.js"), [], {
    cwd: path.join(here, ".."),
    env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const message = await new Promise((resolve, reject) => {
    server.once("message", resolve);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${errors}`)));
  });
  base = message.url.replace("localhost", "127.0.0.1");
}
async function stop() {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
async function api(route, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const generation = (profile) => ({
  ...profile.defaults,
  kind: profile.kind,
  profileId: profile.id,
  workflow: profile.workflow,
  model: profile.model,
  prompt: "a red ceramic teapot",
  count: 1,
});

test.after(async () => {
  await stop();
  await Promise.all([stopped.close(), images.close(), videos.close()]);
});

test(
  "zero workers: Studio runs, says so plainly and refuses generation",
  { timeout: 20000 },
  async () => {
    await start({ STUDIO_WORKERS: "[]" });
    try {
      const health = await api("/api/health");
      assert.equal(health.status, 503);
      assert.equal(health.body.noWorkers, true);
      const models = (await api("/api/models")).body;
      assert.match(models.reason, /No workers are set up/);
      assert.equal(models.backends.video.configured, false);
      const refused = await api("/api/generate", {
        kind: "image",
        prompt: "a teapot",
        profileId: "anything",
        count: 1,
      });
      assert.equal(refused.status, 503);
      assert.equal(refused.body.reason, "no-worker");
      assert.match(refused.body.error, /No workers are set up/);
      const upscale = await api("/api/upscale/status");
      assert.equal(upscale.status, 503);
      assert.match(upscale.body.error, /No workers are set up/);
      assert.deepEqual((await api("/api/workers")).body.workers, []);
      assert.equal((await api("/api/workers")).body.deployment.variable, "STUDIO_WORKERS");
    } finally {
      await stop();
    }
  },
);

test(
  "STUDIO_WORKERS: locked workers, capability routing to an online worker, and Studio's own additions",
  { timeout: 30000 },
  async () => {
    await start({
      STUDIO_WORKERS: JSON.stringify([
        { id: "stopped", name: "Stopped GPU", url: stopped.url, capabilities: ["image"] },
        { id: "images", name: "Image GPU", url: images.url, capabilities: ["image", "upscale"] },
        { id: "videos", name: "Video GPU", url: videos.url, capabilities: ["video"] },
      ]),
    });
    try {
      const listed = (await api("/api/workers")).body;
      assert.deepEqual(
        listed.workers.map((worker) => [worker.id, worker.locked, worker.source]),
        [
          ["stopped", true, "deployment"],
          ["images", true, "deployment"],
          ["videos", true, "deployment"],
        ],
      );
      assert.deepEqual(
        listed.capabilities.map((item) => item.id),
        ["image", "video", "upscale", "models"],
      );

      // Images skip the stopped worker for the first online one with the capability; video goes to the video worker.
      const models = (await api("/api/models")).body;
      assert.equal(models.backends.video.available, true);
      const sdxl = models.profiles.find(
        (profile) => profile.kind === "image" && profile.ready !== false,
      );
      const h3 = models.profiles.find((profile) => profile.family === "minimax_h3");
      assert.ok(sdxl && h3, JSON.stringify(models.profiles.map((profile) => profile.id)));
      const imageQueued = images.nextPrompt();
      const accepted = await api("/api/generate", generation(sdxl));
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal((await imageQueued).client_id, accepted.body.jobId);
      assert.equal(stopped.prompts.length, 0);
      const videoQueued = videos.nextPrompt();
      const videoAccepted = await api("/api/generate", generation(h3));
      assert.equal(videoAccepted.status, 200, JSON.stringify(videoAccepted.body));
      const videoPrompt = await videoQueued;
      assert.equal(videoPrompt.client_id, videoAccepted.body.jobId);
      // Cancelling follows the job's own worker.
      await api(`/api/jobs/${videoAccepted.body.jobId}/cancel`, {});
      assert.ok(videos.requests.some((entry) => entry.pathname === "/interrupt"));
      assert.equal(
        images.requests.some((entry) => entry.pathname === "/interrupt"),
        false,
      );

      // Upscale goes to the worker with Upscale, not the default (first image) worker.
      const before = images.requests.filter((entry) => entry.pathname === "/object_info").length;
      const upscale = await api("/api/upscale/status?fresh=1");
      assert.equal(upscale.status, 200, JSON.stringify(upscale.body));
      assert.ok(
        images.requests.filter((entry) => entry.pathname === "/object_info").length > before,
      );

      // Locked workers can't be changed; Studio's own are added beside them and kept in the data folder.
      const locked = await api(
        "/api/workers",
        {
          workers: [
            {
              id: "images",
              name: "Image GPU",
              url: "http://elsewhere:8188",
              capabilities: ["image"],
            },
          ],
        },
        "PUT",
      );
      assert.equal(locked.status, 400);
      assert.match(locked.body.error, /deployment configuration/);
      const saved = await api(
        "/api/workers",
        { workers: [{ name: "Spare", url: images.url, capabilities: ["upscale"] }] },
        "PUT",
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual(
        saved.body.workers.map((worker) => [worker.id, worker.locked]),
        [
          ["stopped", true],
          ["images", true],
          ["videos", true],
          ["spare", false],
        ],
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(dataDir, "workers.json"), "utf8")).workers.map(
          (worker) => worker.id,
        ),
        ["spare"],
      );

      // Test asks a saved worker or a typed address, and saves nothing.
      assert.equal((await api("/api/workers/test", { id: "videos" })).body.reachable, true);
      assert.equal((await api("/api/workers/test", { id: "stopped" })).body.reachable, false);
      assert.equal((await api("/api/workers/test", { url: "not a url at all" })).status, 400);
      videos.drop(videoPrompt.id);
    } finally {
      await stop();
    }
  },
);

test(
  "only workers with the capability run a job: video with no video worker is refused, never sent elsewhere",
  { timeout: 20000 },
  async () => {
    await start({
      STUDIO_WORKERS: JSON.stringify([
        { id: "images", name: "Image GPU", url: images.url, capabilities: ["image"] },
      ]),
    });
    try {
      const refused = await api("/api/generate", {
        kind: "video",
        prompt: "a teapot",
        profileId: "video:anything",
        workflow: "family:minimax_h3",
        model: "minimax_h3.safetensors",
        count: 1,
      });
      assert.equal(refused.status, 503, JSON.stringify(refused.body));
      assert.match(refused.body.error, /No worker can run videos/);
      const upscale = await api("/api/upscale/status");
      assert.equal(upscale.status, 503);
      assert.match(upscale.body.error, /No worker can upscale/);
    } finally {
      await stop();
    }
  },
);
