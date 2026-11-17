import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-radiance-jobs-"));
process.env.STUDIO_DATA_DIR = scratch;
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { jobs } = await import("./jobs.js");
const { runRadianceJob, orderedRadianceReferences } = await import("./radiance-jobs.js");
const { saveImportedWorkflow } = await import("./custom-workflows.js");
const { makePendingItems } = await import("./gallery/records.js");
const { putGalleryItems, galleryItems } = await import("./gallery/store.js");
const { mediaFile } = await import("./media-paths.js");
const sharp = (await import("sharp")).default;
const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } })
  .png()
  .toBuffer();
const records = new Map();
const store = {
  providerRecord: (_, id) => structuredClone(records.get(id)),
  saveProviderRecord: (_, id, value) => records.set(id, structuredClone(value)),
};
const worker = { id: "radiance", url: "http://fixture.invalid" };
const bodyFor = (id) => ({
  workflow: "custom:radiance-job-fixture",
  model: "custom:radiance-job-fixture",
  profileId: "custom:radiance-job-fixture",
  prompt: "A lighthouse",
  seed: "7",
  width: 1024,
  height: 1024,
  count: 1,
  clientJobId: id,
  createdAt: new Date().toISOString(),
  startedAt: Date.now(),
  comfyBackend: "radiance",
});
const pending = (id, body) => {
  jobs.set(id, { status: "queued", comfyBackend: "radiance", startedAt: body.startedAt });
  putGalleryItems(makePendingItems(id, body));
};
saveImportedWorkflow({
  studio: {
    id: "radiance-job-fixture",
    kind: "image",
    defaults: { model: "krea-2-turbo-iq8r" },
    controls: Object.fromEntries(
      ["prompt", "seed", "width", "height", "count", "model"].map((input) => [
        input,
        { node: "1", input },
      ]),
    ),
  },
  graph: {
    1: {
      class_type: "RadianceImageGenerate",
      inputs: { model: "krea-2-turbo-iq8r", steps: 8, cfg: 1 },
    },
    2: { class_type: "SaveImage", inputs: { images: ["1", 0] } },
  },
});

test("Stop during an accepted synchronous image retains the connection and saves the own result", async () => {
  const id = "stop-accepted";
  const body = bodyFor(id);
  pending(id, body);
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      images: async (_, __, signal) => {
        jobs.set(id, { ...jobs.get(id), status: "cancelling" });
        assert.equal(signal.aborted, false);
        return [png];
      },
    },
  });
  assert.equal(jobs.get(id).status, "done");
  const [output] = galleryItems({ jobId: id });
  assert.equal(output.status, "done");
  assert.equal(output.settings.profileId, body.profileId);
  const params = new URLSearchParams(output.url.split("?")[1]);
  assert.ok(mediaFile(params.get("filename"), params.get("subfolder")));
});

test("an image run records its queue wait, model load, sampling and save for Details", async () => {
  const id = "timed-image";
  const body = { ...bodyFor(id), queuedAt: Date.now() - 5000 };
  pending(id, body);
  let state = "parked";
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      models: async () => [{ id: "krea-2-turbo-iq8r", state }],
      images: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        state = "resident";
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return [png];
      },
    },
  });
  const { timing } = galleryItems({ jobId: id })[0];
  assert.ok(timing.queueMs >= 4900);
  assert.ok(timing.loadMs >= 1000, "the model loaded before it sampled");
  assert.ok(timing.samplingMs > 0 && timing.samplingMs < timing.runMs);
  assert.equal(timing.loadMs + timing.samplingMs, timing.runMs);
  for (const stage of ["setupMs", "saveMs"]) assert.ok(Number.isFinite(timing[stage]), stage);
  assert.equal(timing.downloadMs, undefined, "an image has no separate download");
});

test("a recorded video reconnects by exact ID and is deleted only after durable output publication", async () => {
  const id = "recover-video";
  const body = { ...bodyFor(id), kind: "video", frames: 192 };
  pending(id, body);
  records.set(id, {
    body,
    video: true,
    videoId: "video-fixture",
    values: {
      model: "minimax-h3-i8",
      prompt: body.prompt,
      width: 1344,
      height: 768,
      frames: 192,
      steps: 30,
      seed: 7,
    },
    outputs: [],
  });
  const calls = [];
  await runRadianceJob(id, body, worker, {
    store,
    recovered: true,
    pollMs: 1,
    client: {
      video: async (videoId) => {
        calls.push(["read", videoId]);
        return { id: videoId, status: "completed" };
      },
      videoContent: async (videoId) => {
        calls.push(["content", videoId]);
        return new Uint8Array([1, 2, 3]);
      },
      deleteVideo: async (videoId) => {
        assert.equal(galleryItems({ jobId: id })[0].status, "done");
        calls.push(["delete", videoId]);
      },
      createVideo: () => {
        throw new Error("must not resubmit");
      },
    },
  });
  assert.deepEqual(calls, [
    ["read", "video-fixture"],
    ["content", "video-fixture"],
    ["delete", "video-fixture"],
  ]);
  assert.equal(jobs.get(id).status, "done");
});

test("a missing remote video fails explicitly without a replacement generation", async () => {
  const id = "missing-video";
  const body = { ...bodyFor(id), kind: "video" };
  pending(id, body);
  records.set(id, {
    body,
    video: true,
    videoId: "gone-video",
    values: {
      model: "minimax-h3-i8",
      prompt: "Waves",
      width: 1344,
      height: 768,
      frames: 192,
      seed: 1,
    },
    outputs: [],
  });
  await runRadianceJob(id, body, worker, {
    store,
    recovered: true,
    client: {
      video: async () => {
        throw Object.assign(new Error("Radiance: no video gone-video"), { status: 404 });
      },
      createVideo: () => {
        throw new Error("must not resubmit");
      },
    },
  });
  assert.equal(jobs.get(id).status, "failed");
  assert.match(jobs.get(id).error, /no video/);
});

test("reference slot identity determines conditioning order after draft reorder", () => {
  saveImportedWorkflow({
    studio: {
      id: "ordered-refs",
      kind: "video",
      mediaInputs: [
        { id: "first", control: { node: "2", input: "image" } },
        { id: "last", control: { node: "3", input: "image" } },
      ],
    },
    graph: {
      1: { class_type: "RadianceVideoGenerate", inputs: {} },
      2: { class_type: "LoadImage", inputs: {} },
      3: { class_type: "LoadImage", inputs: {} },
    },
  });
  const refs = [
    { slot: "last", assetId: "b" },
    { slot: "first", assetId: "a" },
  ];
  assert.deepEqual(
    orderedRadianceReferences({ workflow: "custom:ordered-refs", referenceAssets: refs }),
    [refs[1], refs[0]],
  );
});
