import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";
import { backendUrl, currentComfyBackend, mergeWorkerModels, withComfyBackend } from "./comfy-backends.js";
import { reloadWorkers } from "./workers.js";

const primary = await startFakeComfy();
const video = await startFakeComfy();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backends-"));
process.env.COMFY_URL = primary.url;
process.env.COMFY_VIDEO_URL = video.url;
process.env.STUDIO_DATA_DIR = temporary;
process.env.COMFY_OUTPUT_DIR = "";
const { jobs, runJob } = await import("./jobs.js");
const { comfy } = await import("./comfy.js");
const store = await import("./gallery-store.js");
const { cancelPrompt } = await import("./comfy-queue.js");

test.after(async () => {
  await primary.close();
  await video.close();
  fs.rmSync(temporary, { recursive: true, force: true });
});

const waitFor = async (check) => {
  const until = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > until) throw new Error("Timed out waiting for fake ComfyUI");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

function request(backend) {
  const common = { prompt: "a red ceramic teapot", negative: "", width: 512, height: 512, count: 1, steps: 4, cfg: 1, sampler: "euler", scheduler: "simple", seed: "1234", weightDtype: "default", comfyBackend: backend, createdAt: "2026-10-11T00:00:00Z" };
  if (backend === "video") return { ...common, kind: "video", family: "minimax_h3", variant: "standard", source: "unet", workflow: "family:minimax_h3", profileId: "video:h3", model: "minimax_h3.safetensors", encoders: ["qwen3vl.safetensors"], vae: "h3-video.safetensors", audioVae: "h3-audio.safetensors", frames: 29, fps: 24 };
  return { ...common, kind: "image", family: "sdxl", variant: "standard", source: "checkpoint", workflow: "family:sdxl", profileId: "image:sdxl", model: "sd_xl_base_1.0.safetensors", bundled: { encoder: true, vae: true }, encoders: [], vae: "" };
}

function queue(id, body) {
  const items = store.makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, { status: "queued", comfyBackend: body.comfyBackend, kind: body.kind, prompt: body.prompt, outputs: [], items });
}

test("concurrent image/video submissions, progress and completion stay on their own backends", { timeout: 10000 }, async () => {
  const imageBody = request("primary");
  const videoBody = request("video");
  queue("image-one", imageBody);
  queue("video-one", videoBody);
  const imageQueued = primary.nextPrompt();
  const videoQueued = video.nextPrompt();
  const imageRunning = runJob("image-one", imageBody);
  const videoRunning = runJob("video-one", videoBody);
  const [imagePrompt, videoPrompt] = await Promise.all([imageQueued, videoQueued]);
  assert.equal(imagePrompt.client_id, "image-one");
  assert.equal(videoPrompt.client_id, "video-one");
  // Node 20 follows history without a built-in WebSocket; newer runtimes also report live progress.
  if (typeof WebSocket === "function") {
    await Promise.all([primary.socketFor("image-one"), video.socketFor("video-one")]);
    assert.equal(primary.connected("video-one"), false);
    assert.equal(video.connected("image-one"), false);
    video.send("video-one", { type: "progress", data: { value: 2, max: 4, prompt_id: videoPrompt.id, node: "1" } });
    await waitFor(() => jobs.get("video-one").progress?.value === 2);
    assert.notEqual(jobs.get("image-one").progress?.value, 2);
  }
  primary.finish(imagePrompt.id, { outputs: { saved: { images: [{ filename: "image.png", type: "output" }] } } });
  video.finish(videoPrompt.id, { outputs: { saved: { videos: [{ filename: "video.mp4", type: "output" }] } } });
  await Promise.all([imageRunning, videoRunning]);
  assert.equal(jobs.get("image-one").status, "done");
  assert.equal(jobs.get("video-one").status, "done");
  assert.equal(jobs.get("video-one").outputs[0].settings.comfyBackend, "video");
  assert.equal(jobs.get("image-one").outputs[0].type, "image");
  assert.equal(jobs.get("video-one").outputs[0].type, "video");
  const history = await withComfyBackend("video", () => comfy("/history"));
  const recovered = store.recordsFromComfyHistory(history).find((item) => item.jobId === "video-one");
  assert.equal(recovered.prompt, videoBody.prompt);
  assert.equal(recovered.width, 512);
  assert.equal(recovered.settings.comfyBackend, "video");
});

test("cancel a video without interrupting primary image work", async () => {
  const body = request("video");
  queue("video-cancel", body);
  const queued = video.nextPrompt();
  const running = runJob("video-cancel", body);
  const prompt = await queued;
  await waitFor(() => jobs.get("video-cancel").promptId);
  const before = primary.requests.length;
  await withComfyBackend(jobs.get("video-cancel").comfyBackend, () => cancelPrompt(prompt.id));
  jobs.set("video-cancel", { ...jobs.get("video-cancel"), status: "canceling" });
  await running;
  assert.equal(jobs.get("video-cancel").status, "canceled");
  assert.equal(primary.requests.slice(before).some((item) => item.pathname === "/interrupt"), false);
  assert.equal(video.requests.some((item) => item.pathname === "/interrupt"), true);
});

test("video failure stays a video failure and is never retried on primary", async () => {
  const body = request("video");
  queue("video-error", body);
  const queued = video.nextPrompt();
  const running = runJob("video-error", body);
  const prompt = await queued;
  const before = primary.prompts.length;
  video.finish(prompt.id, { error: { exception_message: "test GPU error" } });
  await running;
  assert.equal(jobs.get("video-error").status, "error");
  assert.equal(primary.prompts.length, before);
});

// The legacy pair as workers: COMFY_URL runs images, COMFY_VIDEO_URL local video.
const imageWorker = { id: "primary", capabilities: ["image", "upscale", "models"] };
const videoWorker = { id: "video", capabilities: ["video"] };
const mergeBackendModels = (primaryModels, videoModels) => mergeWorkerModels([{ worker: imageWorker, models: primaryModels }, { worker: videoWorker, models: videoModels }]);

test("catalogue selects local video models from secondary and keeps Grok on primary", () => {
  const image = { id: "image", kind: "image", family: "sdxl" };
  const h3 = { id: "h3", kind: "video", family: "minimax_h3" };
  const recipe = { id: "custom:video-workflow", kind: "video", family: "minimax-h3" };
  assert.deepEqual(mergeBackendModels({ profiles: [recipe] }, { profiles: [recipe] }).profiles, [recipe]);
  assert.deepEqual(mergeBackendModels({ profiles: [recipe] }, { profiles: [] }).profiles, []);
  for (const family of ["wan21", "hunyuan15", "custom"]) {
    const localVideo = { id: `video:${family}`, kind: "video", family };
    assert.deepEqual(mergeBackendModels({ profiles: [localVideo] }, { profiles: [] }).profiles, []);
    assert.deepEqual(mergeBackendModels({ profiles: [] }, { profiles: [localVideo] }).profiles, [localVideo]);
  }
  const grok = { id: "grok", kind: "video", family: "grok" };
  const other = { id: "secondary-image", kind: "image", family: "sdxl" };
  assert.deepEqual(mergeBackendModels({ profiles: [image, h3, grok] }, { profiles: [h3, other] }).profiles, [image, grok, h3]);
  assert.deepEqual(mergeBackendModels({ profiles: [image, h3, grok] }, { profiles: [] }).profiles, [image, grok]);
  assert.equal(mergeBackendModels({ profiles: [image, grok], defaults: { videoModel: "h3" } }, { profiles: [h3] }).defaults.videoModel, "h3");
});

test("lost secondary configuration never silently falls back to primary", () => {
  const configured = process.env.COMFY_VIDEO_URL;
  delete process.env.COMFY_VIDEO_URL;
  reloadWorkers();
  assert.throws(() => withComfyBackend("video", () => backendUrl()), /no longer configured/);
  process.env.COMFY_VIDEO_URL = configured;
  reloadWorkers();
  assert.equal(currentComfyBackend(), "primary");
  assert.equal(withComfyBackend("video", () => backendUrl()), video.url);
});
