import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";
import { writeTestWorkflows } from "./fixtures/test-workflows.js";

// A whole run against a stand-in ComfyUI: the graph is queued, progress
// arrives over the socket (Node 22+, where WebSocket is built in; Node 20
// relies on polling alone), history reports the images, and the gallery
// placeholder becomes the finished item.
const fake = await startFakeComfy();
process.env.STUDIO_WORKERS = JSON.stringify([
  { id: "primary", url: fake.url, capabilities: ["image", "video", "upscale", "models"] },
]);
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-run-"));
writeTestWorkflows(process.env.STUDIO_DATA_DIR);
const { jobs, runJob } = await import("./jobs.js");
const store = await import("./gallery/store.js");
const { makePendingItems } = await import("./gallery/records.js");
const { registerJobRoutes } = await import("./job-routes.js");
const { openDatabase } = await import("./persistence/runtime.ts");
const { createGenerationQueueAdapter } = await import("./domain/generation-adapter.ts");
const { GenerationQueue } = await import("./domain/queue.ts");
const { Store } = await import("./domain/store.ts");
test.after(() => fake.close());

const socketsBuiltIn = typeof WebSocket === "function";

function sdxlRequest(overrides = {}) {
  return {
    kind: "image",
    family: "sdxl",
    workflow: "custom:test-image",
    profileId: "custom:test-image",
    model: "custom:test-image",
    prompt: "a lighthouse in fog",
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
    ...overrides,
  };
}

function queue(id, body) {
  const items = makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, {
    status: "queued",
    kind: body.kind,
    prompt: body.prompt,
    outputs: [],
    items,
    startedAt: Date.now(),
  });
}

const waitFor = async (check, what, ms = 5000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("a run goes from queued through progress to a finished gallery image", async () => {
  const id = "job-success";
  const body = sdxlRequest();
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  assert.equal(prompt.client_id, id, "progress for this run reaches this run's socket");
  const sampler = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "KSampler");
  assert.ok(sampler, "the graph was built and sent");
  assert.equal(sampler[1].inputs.steps, 4);
  assert.equal(sampler[1].inputs.seed, 1234);

  if (socketsBuiltIn) {
    await fake.socketFor(id);
    fake.send(id, { type: "execution_start", data: { prompt_id: prompt.id } });
    fake.send(id, {
      type: "progress",
      data: { value: 2, max: 4, prompt_id: prompt.id, node: sampler[0] },
    });
    await waitFor(() => jobs.get(id)?.progress?.value === 2, "progress from the socket");
    assert.equal(jobs.get(id).status, "running");
    assert.equal(store.gallery.find((item) => item.jobId === id).progress.max, 4);
    assert.equal(jobs.get(id).progress.phase, "Step");
  }

  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  fake.finish(prompt.id, {
    outputs: {
      [save]: { images: [{ filename: "image_00001_.png", subfolder: "studio", type: "output" }] },
    },
  });
  if (socketsBuiltIn)
    fake.send(id, { type: "executing", data: { node: null, prompt_id: prompt.id } });
  await running;

  const job = jobs.get(id);
  assert.equal(job.status, "done");
  assert.equal(job.outputs.length, 1);
  const item = store.gallery.find((entry) => entry.jobId === id);
  assert.equal(item.status, "done");
  assert.equal(item.url, "/comfy/view?filename=image_00001_.png&subfolder=studio&type=output");
  assert.equal(
    item.thumbnailUrl,
    "/comfy/thumb?filename=image_00001_.png&subfolder=studio&type=output",
  );
  assert.equal(item.settings.steps, 4);
});

test("a run ComfyUI fails is kept as a failure that says why", async () => {
  const id = "job-oom";
  const body = sdxlRequest({ width: 2048, height: 2048 });
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  fake.finish(prompt.id, {
    error: {
      exception_message: "Allocation on device 0 would exceed allowed memory. (out of memory)",
      exception_type: "torch.OutOfMemoryError",
      node_type: "KSampler",
      node_id: "5",
      traceback: ["line 1\n"],
    },
  });
  await running;
  const job = jobs.get(id);
  assert.equal(job.status, "failed");
  assert.equal(job.failure.title, "The GPU ran out of memory");
  assert.equal(job.failure.nodeType, "KSampler");
  const item = store.gallery.find((entry) => entry.jobId === id);
  assert.equal(item.status, "failed");
  assert.equal(item.filename, "The GPU ran out of memory");
});

test("a run that ends without an image is a failure, not a vanished tile", async () => {
  const id = "job-empty";
  const body = sdxlRequest();
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  fake.finish(prompt.id, { outputs: {} });
  await running;
  assert.equal(jobs.get(id).status, "failed");
  assert.equal(jobs.get(id).failure.title, "No image was saved");
  assert.equal(store.gallery.filter((entry) => entry.jobId === id).length, 1);
});

test("a cancel before dispatch finishes without submitting provider work", async () => {
  const id = "job-cancel";
  const body = sdxlRequest();
  queue(id, body);
  jobs.set(id, { ...jobs.get(id), status: "cancelling" });
  const submitted = fake.prompts.length;
  await runJob(id, body);
  assert.equal(fake.prompts.length, submitted);
  assert.equal(jobs.get(id).status, "cancelled");
  assert.equal(store.gallery.find((entry) => entry.jobId === id).status, "cancelled");
});

test(
  "cancelling the queue during Smart upscale keeps the picture",
  { skip: !socketsBuiltIn },
  async () => {
    const id = "job-upscale-cancel";
    const body = sdxlRequest();
    const records = new Store(openDatabase(":memory:"));
    records.enqueue("", records.createSession("").id, body, "image", undefined, undefined, id);
    const queued = fake.nextPrompt();
    let running;
    const generations = new GenerationQueue(
      records,
      createGenerationQueueAdapter({
        async submitGeneration() {
          queue(id, body);
          // The run's own save feeds the upscale, as planRunUpscale pairs them.
          const prepare = (graph) => ({
            graph,
            pairs: [
              {
                base: Object.entries(graph).find(([, node]) => node.class_type === "SaveImage")[0],
                upscale: "upscale",
              },
            ],
          });
          running = runJob(id, body, { prepare });
          return { status: 200, payload: { items: [] } };
        },
        jobs,
        gallery: () => store.gallery,
        accountForOwner: () => null,
        flushGallery: async () => undefined,
        cancelPrompt: async () => {
          fake.send(id, { type: "execution_interrupted", data: { prompt_id: prompt.id } });
        },
      }),
    );
    const routes = new Map();
    registerJobRoutes(
      { get() {}, post: (route, handler) => routes.set(route, handler) },
      { store: records, queue: generations },
    );
    await generations.tick();
    const prompt = await queued;
    await fake.socketFor(id);
    const save = Object.entries(prompt.prompt).find(
      ([, node]) => node.class_type === "SaveImage",
    )[0];
    fake.send(id, {
      type: "executed",
      data: {
        prompt_id: prompt.id,
        node: save,
        output: { images: [{ filename: "kept_00001_.png", subfolder: "studio", type: "output" }] },
      },
    });
    await waitFor(() => jobs.get(id)?.keepsPicture, "the saved picture");
    await routes.get("/api/queue/cancel")({ params: {} }, { json() {} });
    await running;
    const item = store.gallery.find((entry) => entry.jobId === id);
    assert.equal(item.status, "done");
    assert.equal(item.url, "/comfy/view?filename=kept_00001_.png&subfolder=studio&type=output");
    assert.equal(item.upscale.status, "cancelled");
    await generations.tick();
    assert.equal(records.job("", id).status, "completed");
    assert.equal(records.job("", id).outputs.length, 1);
    records.close();
  },
);
