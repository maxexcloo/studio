import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";
import { writeTestWorkflows } from "./fixtures/test-workflows.js";
import {
  backendUrl,
  currentComfyBackend,
  mergeWorkerModels,
  withComfyBackend,
} from "./comfy-backends.js";
import { reloadWorkers } from "./workers.js";

const primary = await startFakeComfy();
const video = await startFakeComfy();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backends-"));
const imageWorker = { id: "primary", capabilities: ["image", "upscale", "models"] };
const videoWorker = { id: "video", capabilities: ["video"] };
const bothWorkers = JSON.stringify([
  { ...imageWorker, url: primary.url },
  { ...videoWorker, url: video.url },
]);
process.env.STUDIO_WORKERS = bothWorkers;
process.env.STUDIO_DATA_DIR = temporary;
writeTestWorkflows(temporary);
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
  const common = {
    prompt: "a red ceramic teapot",
    negative: "",
    width: 512,
    height: 512,
    count: 1,
    steps: 4,
    cfg: 1,
    sampler: "euler",
    scheduler: "simple",
    seed: "1234",
    weightDtype: "default",
    comfyBackend: backend,
    createdAt: "2026-10-11T00:00:00Z",
  };
  if (backend === "video")
    return {
      ...common,
      kind: "video",
      family: "minimax_h3",
      workflow: "custom:test-video",
      profileId: "custom:test-video",
      model: "custom:test-video",
      frames: 124,
      fps: 24,
    };
  return {
    ...common,
    kind: "image",
    family: "sdxl",
    workflow: "custom:test-image",
    profileId: "custom:test-image",
    model: "custom:test-image",
  };
}

function queue(id, body) {
  const items = store.makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, {
    status: "queued",
    comfyBackend: body.comfyBackend,
    kind: body.kind,
    prompt: body.prompt,
    outputs: [],
    items,
  });
}

test(
  "concurrent image/video submissions, progress and completion stay on their own backends",
  { timeout: 10000 },
  async () => {
    // Written by the prompt assistant in chat: the record rides in extra_data, so a rebuild from history keeps it.
    const imageBody = {
      ...request("primary"),
      assistant: { preset: "cinematic", model: "cloud/text", source: "chat" },
    };
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
      video.send("video-one", {
        type: "progress",
        data: { value: 2, max: 4, prompt_id: videoPrompt.id, node: "1" },
      });
      await waitFor(() => jobs.get("video-one").progress?.value === 2);
      assert.notEqual(jobs.get("image-one").progress?.value, 2);
    }
    primary.finish(imagePrompt.id, {
      outputs: { saved: { images: [{ filename: "image.png", type: "output" }] } },
    });
    video.finish(videoPrompt.id, {
      outputs: { saved: { videos: [{ filename: "video.mp4", type: "output" }] } },
    });
    await Promise.all([imageRunning, videoRunning]);
    assert.equal(jobs.get("image-one").status, "done");
    assert.equal(jobs.get("video-one").status, "done");
    assert.equal(jobs.get("video-one").outputs[0].settings.comfyBackend, "video");
    assert.equal(jobs.get("image-one").outputs[0].type, "image");
    assert.equal(jobs.get("video-one").outputs[0].type, "video");
    const history = await withComfyBackend("video", () => comfy("/history"));
    const recovered = store
      .recordsFromComfyHistory(history)
      .find((item) => item.jobId === "video-one");
    assert.equal(recovered.prompt, videoBody.prompt);
    assert.equal(recovered.width, 512);
    assert.equal(recovered.settings.comfyBackend, "video");
    assert.equal(recovered.assistant, undefined);
    const primaryHistory = await withComfyBackend("primary", () => comfy("/history"));
    const rebuilt = store
      .recordsFromComfyHistory(primaryHistory)
      .find((item) => item.jobId === "image-one");
    assert.deepEqual(rebuilt?.assistant, {
      preset: "cinematic",
      model: "cloud/text",
      source: "chat",
    });
    assert.deepEqual(store.makePendingItems("x", imageBody)[0].assistant, imageBody.assistant);
  },
);

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
  video.drop(prompt.id);
  await running;
  assert.equal(jobs.get("video-cancel").status, "canceled");
  assert.equal(
    primary.requests.slice(before).some((item) => item.pathname === "/interrupt"),
    false,
  );
  assert.equal(
    video.requests.some((item) => item.pathname === "/interrupt"),
    true,
  );
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

const mergeBackendModels = (primaryModels, videoModels) =>
  mergeWorkerModels([
    { worker: imageWorker, models: primaryModels },
    { worker: videoWorker, models: videoModels },
  ]);

test("catalogue selects local video models from secondary", () => {
  const image = { id: "image", kind: "image", family: "sdxl" };
  const h3 = { id: "h3", kind: "video", family: "minimax_h3" };
  const recipe = { id: "custom:video-workflow", kind: "video", family: "minimax-h3" };
  assert.deepEqual(mergeBackendModels({ profiles: [recipe] }, { profiles: [recipe] }).profiles, [
    recipe,
  ]);
  assert.deepEqual(mergeBackendModels({ profiles: [recipe] }, { profiles: [] }).profiles, []);
  for (const family of ["wan21", "hunyuan15", "custom"]) {
    const localVideo = { id: `video:${family}`, kind: "video", family };
    assert.deepEqual(mergeBackendModels({ profiles: [localVideo] }, { profiles: [] }).profiles, []);
    assert.deepEqual(mergeBackendModels({ profiles: [] }, { profiles: [localVideo] }).profiles, [
      localVideo,
    ]);
  }
  const other = { id: "secondary-image", kind: "image", family: "sdxl" };
  assert.deepEqual(
    mergeBackendModels({ profiles: [image, h3] }, { profiles: [h3, other] }).profiles,
    [image, h3],
  );
  assert.deepEqual(mergeBackendModels({ profiles: [image, h3] }, { profiles: [] }).profiles, [
    image,
  ]);
  assert.equal(
    mergeBackendModels({ profiles: [image], defaults: { videoModel: "h3" } }, { profiles: [h3] })
      .defaults.videoModel,
    "h3",
  );
});

test("lost secondary configuration never silently falls back to primary", () => {
  process.env.STUDIO_WORKERS = JSON.stringify([{ ...imageWorker, url: primary.url }]);
  reloadWorkers();
  assert.throws(() => withComfyBackend("video", () => backendUrl()), /no longer configured/);
  process.env.STUDIO_WORKERS = bothWorkers;
  reloadWorkers();
  assert.equal(currentComfyBackend(), "primary");
  assert.equal(
    withComfyBackend("video", () => backendUrl()),
    video.url,
  );
});
