import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { startFakeComfy } from "./fixtures/fake-comfy.js";
import { writeTestWorkflows } from "./fixtures/test-workflows.js";

const fake = await startFakeComfy();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-terminal-progress-"));
process.env.STUDIO_WORKERS = JSON.stringify([
  { id: "primary", url: fake.url, capabilities: ["image", "video", "upscale", "models"] },
]);
process.env.STUDIO_DATA_DIR = temporary;
writeTestWorkflows(temporary);
process.env.STUDIO_OUTPUT_STORAGE = "studio";
process.env.STUDIO_COMFY_OUTPUT_DIR = "";
const nativeFetch = globalThis.fetch;
const NativeWebSocket = globalThis.WebSocket;
const sockets = new Map();
if (NativeWebSocket)
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url) {
      super(url);
      sockets.set(new URL(url).searchParams.get("clientId"), this);
    }
  };
const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
  .png()
  .toBuffer();
let reachedCleanup;
const cleanupReached = new Promise((resolve) => {
  reachedCleanup = resolve;
});
let releaseCleanup;
const cleanupReleased = new Promise((resolve) => {
  releaseCleanup = resolve;
});
globalThis.fetch = async (url, options = {}) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/view") return new Response(png, { headers: { "content-type": "image/png" } });
  if (pathname === "/studio/worker/delete") return Response.json({ deleted: 1 });
  if (pathname === "/history" && options.method === "POST") {
    reachedCleanup();
    await cleanupReleased;
  }
  return nativeFetch(url, options);
};
const { jobs, runJob } = await import("./jobs.js");
const store = await import("./gallery-store.js");
test.after(async () => {
  releaseCleanup();
  globalThis.fetch = nativeFetch;
  globalThis.WebSocket = NativeWebSocket;
  await fake.close();
  await store.flushGallery();
  fs.rmSync(temporary, { recursive: true, force: true });
});

// Wait for the async progress listener's continuation as well as socket delivery.
async function message(id, event) {
  const received = new Promise((resolve) =>
    sockets.get(id).addEventListener("message", () => queueMicrotask(resolve), { once: true }),
  );
  fake.send(id, event);
  await received;
}

test(
  "saved results stay terminal when late progress and errors arrive before worker cleanup closes the socket",
  { skip: !NativeWebSocket },
  async () => {
    const id = "terminal-late-progress";
    const body = {
      kind: "image",
      family: "sdxl",
      workflow: "custom:test-image",
      profileId: "custom:test-image",
      model: "custom:test-image",
      prompt: "a lighthouse",
      negative: "",
      width: 1024,
      height: 1024,
      count: 1,
      steps: 4,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      seed: "1234",
      weightDtype: "default",
    };
    const items = store.makePendingItems(id, body);
    store.setGallery(items, { persist: false });
    jobs.set(id, { status: "queued", kind: "image", outputs: [], items, startedAt: Date.now() });
    const queued = fake.nextPrompt();
    const running = runJob(id, body);
    const prompt = await queued;
    await fake.socketFor(id);
    const sampler = Object.entries(prompt.prompt).find(
      ([, node]) => node.class_type === "KSampler",
    )[0];
    const save = Object.entries(prompt.prompt).find(
      ([, node]) => node.class_type === "SaveImage",
    )[0];
    fake.finish(prompt.id, {
      outputs: {
        [save]: { images: [{ filename: "saved.png", subfolder: "studio", type: "output" }] },
      },
    });
    fake.send(id, { type: "execution_success", data: { prompt_id: prompt.id } });
    await cleanupReached;
    try {
      assert.equal(jobs.get(id).status, "done");
      assert.equal(store.gallery[0].status, "done");
      assert.match(store.gallery[0].url, /type=media/);
      const completed = { ...store.gallery[0] };
      const terminalAt = jobs.get(id).terminalAt;
      await message(id, {
        type: "progress",
        data: { node: sampler, value: 3, max: 4, prompt_id: prompt.id },
      });
      assert.equal(jobs.get(id).status, "done");
      assert.deepEqual(store.gallery[0], completed);
      await message(id, {
        type: "execution_error",
        data: { prompt_id: prompt.id, exception_message: "late worker error" },
      });
      await message(id, { type: "execution_interrupted", data: { prompt_id: prompt.id } });
      assert.equal(jobs.get(id).status, "done");
      assert.equal(jobs.get(id).terminalAt, terminalAt);
      assert.deepEqual(store.gallery[0], completed);
    } finally {
      releaseCleanup();
      await running;
    }
  },
);
