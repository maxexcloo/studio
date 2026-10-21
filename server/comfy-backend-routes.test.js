import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(fs.readFileSync(path.join(here, "fixtures/object_info-comfyui-0.34.1.json"), "utf8"));
const imageInfo = structuredClone(source);
imageInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
imageInfo.UNETLoader.input.required.unet_name[0] = ["tessera-v0.3.1-turbo-opd-W8A8.safetensors"];
imageInfo.LoraLoader.input.required.lora_name[0] = ["private-lora.safetensors"];
imageInfo.GrokMedia = { input: { required: { prompt: ["STRING"], width: ["INT", { default: 1024, min: 256, max: 2048, step: 8 }], height: ["INT", { default: 1024, min: 256, max: 2048, step: 8 }] } } };
const videoInfo = structuredClone(source);
videoInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = [];
videoInfo.UNETLoader.input.required.unet_name[0] = ["minimax_h3_fl2va_pruned_int8_convrot.safetensors"];
videoInfo.CLIPLoader.input.required.clip_name[0] = ["qwen3vl_32b_h3.safetensors"];
videoInfo.VAELoader.input.required.vae_name[0] = ["minimax_h3_video_vae.safetensors", "minimax_h3_audio_vae.safetensors"];
const primary = await startFakeComfy({ objectInfo: imageInfo });
const video = await startFakeComfy({ objectInfo: videoInfo });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-backend-routes-"));
fs.mkdirSync(path.join(dataDir, "workflows"));
fs.writeFileSync(path.join(dataDir, "workflows/grok-video.json"), JSON.stringify({ heissUi: { id: "grok-video", kind: "video", family: "grok", controls: { prompt: { node: "1", input: "prompt" } } }, "1": { class_type: "GrokMedia", inputs: { prompt: "" } } }));
let server;
let base;

async function start(useVideo = true, enableGrok = true, restrictModels = false) {
  server = fork(path.join(here, "index.js"), [], { cwd: path.join(here, ".."), env: { ...process.env, PORT: "0", HOST: "127.0.0.1", COMFY_URL: primary.url, COMFY_VIDEO_URL: useVideo ? video.url : "", STUDIO_ENABLE_GROK: enableGrok ? "1" : "0", STUDIO_ENABLE_TESSERA: restrictModels ? "0" : "1", STUDIO_ENABLE_LORAS: restrictModels ? "0" : "1", HEISS_DATA_DIR: dataDir, COMFY_OUTPUT_DIR: "", HEISS_NO_BROWSER: "1", HEISS_LAN: "0", npm_lifecycle_event: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let errors = "";
  server.stderr.on("data", (chunk) => { errors += chunk; });
  const message = await new Promise((resolve, reject) => { server.once("message", resolve); server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${errors}`))); });
  base = message.url.replace("localhost", "127.0.0.1");
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
async function api(route, body) {
  const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const generation = (profile) => ({ ...profile.defaults, kind: profile.kind, profileId: profile.id, workflow: profile.workflow, model: profile.model, prompt: "a red ceramic teapot", count: 1 });

test.before(() => start());
test.after(async () => { await stop(); await primary.close(); await video.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("health keeps the studio connected while either configured backend is available", async () => {
  try {
    let status = (await api("/api/comfy/status")).body;
    assert.equal(status.connected, true);
    assert.equal(status.backends.primary.connected, true);
    assert.equal(status.backends.video.connected, true);
    assert.equal(status.backends.primary.url, primary.url);
    assert.equal(status.backends.video.url, video.url);
    primary.setDown(true);
    status = (await api("/api/comfy/status")).body;
    assert.equal(status.connected, true);
    assert.equal(status.backends.primary.connected, false);
    assert.equal(status.backends.video.connected, true);
    video.setDown(true);
    status = (await api("/api/comfy/status")).body;
    assert.equal(status.connected, false);
    primary.setDown(false);
    status = (await api("/api/comfy/status")).body;
    assert.equal(status.connected, true);
    assert.equal(status.backends.primary.connected, true);
    assert.equal(status.backends.video.connected, false);
  } finally {
    primary.setDown(false);
    video.setDown(false);
  }
});

test("the catalogue reports whether the local video worker answered, keeping Grok while it is off", async () => {
  try {
    let models = (await api("/api/models")).body;
    assert.deepEqual(models.backends.video, { configured: true, available: true });
    video.setDown(true);
    models = (await api("/api/models")).body;
    assert.deepEqual(models.backends.video, { configured: true, available: false });
    assert.equal(models.profiles.some((profile) => profile.family === "minimax_h3"), false);
    assert.ok(models.profiles.some((profile) => profile.id === "custom:grok-video"));
  } finally {
    video.setDown(false);
    await api("/api/comfy/status");
  }
});

test("a video worker that did not answer is not asked again on every catalogue load or run until a status check reaches it", { timeout: 10000 }, async () => {
  const h3 = (await api("/api/models")).body.profiles.find((profile) => profile.family === "minimax_h3");
  const probes = () => video.requests.filter((entry) => entry.pathname === "/object_info").length;
  try {
    video.setDown(true);
    assert.deepEqual((await api("/api/models")).body.backends.video, { configured: true, available: false });
    const before = probes();
    assert.deepEqual((await api("/api/models")).body.backends.video, { configured: true, available: false });
    assert.deepEqual((await api("/api/models?cached=1")).body.backends.video, { configured: true, available: false });
    assert.equal((await api("/api/generate", generation(h3))).status, 400);
    assert.equal(probes(), before);
    video.setDown(false);
    // Still remembered until something reaches the worker.
    assert.deepEqual((await api("/api/models")).body.backends.video, { configured: true, available: false });
    assert.equal((await api("/api/comfy/status")).body.backends.video.connected, true);
    const models = (await api("/api/models")).body;
    assert.deepEqual(models.backends.video, { configured: true, available: true });
    assert.ok(models.profiles.some((profile) => profile.family === "minimax_h3"));
    assert.ok(probes() > before);
  } finally {
    video.setDown(false);
    await api("/api/comfy/status");
  }
});

test("a model type choice shows in the cached catalogue straight away", async () => {
  const file = () => api("/api/models?cached=1").then(({ body }) => body.modelFiles.find((item) => item.name === "sd_xl_base_1.0.safetensors"));
  const original = (await file()).choice;
  const choice = (await api("/api/models?cached=1")).body.modelTypeChoices.checkpoint.map((item) => item.value).find((value) => value && value !== original);
  assert.ok(choice);
  const put = (type) => fetch(base + "/api/models/types", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "checkpoint", name: "sd_xl_base_1.0.safetensors", type }) });
  try {
    assert.equal((await put(choice)).status, 200);
    assert.equal((await file()).choice, choice);
  } finally {
    await put("");
  }
  assert.equal((await file()).choice, original);
});

test("HTTP catalogue and generate select the video node schema, keep Grok primary and cancel only target", { timeout: 10000 }, async () => {
  const models = (await api("/api/models")).body;
  const h3 = models.profiles.find((profile) => profile.family === "minimax_h3");
  const grok = models.profiles.find((profile) => profile.id === "custom:grok-video");
  assert.ok(h3?.ready, JSON.stringify(h3));
  assert.ok(grok);
  const videoQueued = video.nextPrompt();
  const accepted = await api("/api/generate", generation(h3));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const h3Prompt = await videoQueued;
  assert.equal(h3Prompt.client_id, accepted.body.jobId);
  assert.ok(Object.values(h3Prompt.prompt).some((node) => node.class_type === "MiniMaxH3ImageToVideo"));
  const grokQueued = primary.nextPrompt();
  const grokAccepted = await api("/api/generate", { ...generation(grok), comfyBackend: "video", COMFY_VIDEO_URL: video.url, family: "minimax_h3" });
  assert.equal(grokAccepted.status, 200, JSON.stringify(grokAccepted.body));
  const grokPrompt = await grokQueued;
  assert.equal(grokPrompt.client_id, grokAccepted.body.jobId);
  const status = (await api("/api/comfy/status")).body;
  assert.doesNotMatch(JSON.stringify(status), /red ceramic teapot/);
  const before = primary.requests.length;
  await api(`/api/jobs/${accepted.body.jobId}/cancel`, {});
  assert.equal(primary.requests.slice(before).some((entry) => entry.pathname === "/interrupt"), false);
  assert.ok(video.requests.some((entry) => entry.pathname === "/interrupt"));
  await api(`/api/jobs/${grokAccepted.body.jobId}/cancel`, {});
  primary.drop(grokPrompt.id);
  video.drop(h3Prompt.id);
});

test("completed secondary work recovers after a HEISS restart with prompt and backend provenance", { timeout: 10000 }, async () => {
  const h3 = (await api("/api/models")).body.profiles.find((profile) => profile.family === "minimax_h3");
  const queued = video.nextPrompt();
  const accepted = await api("/api/generate", generation(h3));
  assert.equal(accepted.status, 200);
  const prompt = await queued;
  await stop();
  video.finish(prompt.id, { outputs: { saved: { videos: [{ filename: "after-restart.mp4", type: "output" }] } } });
  await start();
  await api("/api/gallery/recover", {});
  const gallery = (await api("/api/gallery?limit=200")).body.items;
  const result = gallery.find((item) => item.jobId === accepted.body.jobId && item.status === "done");
  assert.ok(result);
  assert.equal(result.prompt, "a red ceramic teapot");
  assert.equal(result.settings.comfyBackend, "video");
  assert.equal(result.type, "video");
});

test("offline secondary hides H3 and refuses stale H3 requests without primary submission", { timeout: 10000 }, async () => {
  const h3 = (await api("/api/models")).body.profiles.find((profile) => profile.family === "minimax_h3");
  video.setDown(true);
  const count = primary.prompts.length;
  const catalogue = (await api("/api/models")).body;
  assert.equal(catalogue.profiles.some((profile) => profile.family === "minimax_h3"), false);
  // A failed catalogue refresh invalidates its backend cache.
  const response = await api("/api/generate", generation(h3));
  assert.equal(response.status, 400);
  assert.equal(primary.prompts.length, count);
  video.setDown(false);
  await api("/api/comfy/status");
});


test("an instance without video configuration cannot be redirected by request fields", { timeout: 10000 }, async () => {
  await stop();
  await start(false);
  const profiles = (await api("/api/models")).body.profiles;
  assert.equal(profiles.some((profile) => profile.family === "minimax_h3"), false);
  const grok = profiles.find((profile) => profile.id === "custom:grok-video");
  const secondaryCount = video.prompts.length;
  const queued = primary.nextPrompt();
  const accepted = await api("/api/generate", { ...generation(grok), comfyBackend: "video", COMFY_VIDEO_URL: video.url });
  assert.equal(accepted.status, 200);
  const prompt = await queued;
  assert.equal(video.prompts.length, secondaryCount);
  await api(`/api/jobs/${accepted.body.jobId}/cancel`, {});
  primary.drop(prompt.id);
});

test("SFW instances hide restricted models and LoRAs and reject saved Grok requests on either backend configuration", { timeout: 10000 }, async () => {
  const grok = (await api("/api/models")).body.profiles.find((profile) => profile.id === "custom:grok-video");
  assert.ok(grok);
  const before = (await api("/api/models")).body;
  assert.ok(before.modelFiles.some((file) => file.name.startsWith("tessera-")));
  assert.ok(before.loras.includes("private-lora.safetensors"));
  fs.writeFileSync(path.join(dataDir, "workflows/renamed-provider.json"), JSON.stringify({ heissUi: { id: "renamed-provider", family: "custom" }, "1": { class_type: "GrokMedia", inputs: { prompt: "" } } }));
  try {
    for (const useVideo of [true, false]) {
      await stop();
      await start(useVideo, false, true);
      const models = (await api("/api/models")).body;
      assert.equal(models.profiles.some((profile) => profile.family === "grok" || profile.id === "custom:renamed-provider"), false);
      assert.equal(models.profiles.some((profile) => profile.model.startsWith("tessera-")), false);
      assert.equal(models.modelFiles.some((file) => file.name.startsWith("tessera-")), false);
      assert.deepEqual(models.loras, []);
      assert.ok(models.profiles.every((profile) => !profile.capabilities.lora));
      assert.deepEqual((await api("/api/loras/info")).body.loras, {});
      assert.equal((await api("/api/loras/library")).body.found, false);
      assert.deepEqual((await api("/api/loras/saved-profile")).body.loras, []);
      assert.doesNotMatch(JSON.stringify((await api("/api/workflows")).body.workflows), /custom:grok-video|custom:renamed-provider/);
      const count = primary.prompts.length;
      const response = await api("/api/generate", generation(grok));
      assert.equal(response.status, 400);
      assert.equal(primary.prompts.length, count);
    }
  } finally {
    fs.rmSync(path.join(dataDir, "workflows/renamed-provider.json"));
    await stop();
    await start();
  }
  assert.ok((await api("/api/models")).body.profiles.some((profile) => profile.id === grok.id));
});

test("repeating an acknowledged client job ID does not queue another video", { timeout: 10000 }, async () => {
  const profile = (await api("/api/models")).body.profiles.find((item) => item.family === "minimax_h3");
  const body = { ...generation(profile), clientJobId: "animation-retry-once" };
  const promptCount = video.requests.filter((request) => request.pathname === "/prompt").length;
  const next = video.nextPrompt();
  const [first, concurrent] = await Promise.all([api("/api/generate", body), api("/api/generate", body)]);
  assert.equal(first.status, 200);
  assert.equal(concurrent.status, 200);
  assert.equal(concurrent.body.jobId, first.body.jobId);
  const queued = await next;
  const before = video.requests.filter((request) => request.pathname === "/prompt").length;
  assert.equal(before, promptCount + 1);
  const repeat = await api("/api/generate", body);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.jobId, first.body.jobId);
  assert.equal(video.requests.filter((request) => request.pathname === "/prompt").length, before);
  await api(`/api/jobs/${first.body.jobId}/cancel`, {});
  video.drop(queued.id);
});
