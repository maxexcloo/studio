import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-radiance-jobs-"));
process.env.STUDIO_DATA_DIR = scratch;
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { jobs, setTerminalJob } = await import("./jobs.js");
const { runRadianceJob, orderedRadianceReferences } = await import("./radiance-jobs.js");
const { saveImportedWorkflow } = await import("./custom-workflows.js");
const { makePendingItems } = await import("./gallery/records.js");
const { putGalleryItems, galleryItems } = await import("./gallery/store.js");
const { readImageMetadata } = await import("./image-metadata.js");
const { mediaFile } = await import("./media-paths.js");
const { recordGeneration } = await import("./timings.js");
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

test("Stop keeps accepted Radiance images and saves each with its own seed", async () => {
  const id = "stop-accepted";
  const body = { ...bodyFor(id), count: 2 };
  pending(id, body);
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      images: async (_, __, signal) => {
        jobs.set(id, { ...jobs.get(id), status: "cancelling" });
        assert.equal(signal.aborted, false);
        return [png, png];
      },
    },
  });
  assert.equal(jobs.get(id).status, "done");
  const outputs = galleryItems({ jobId: id }).sort((left, right) => left.index - right.index);
  assert.deepEqual(
    outputs.map((output) => output.settings.seed),
    ["7", "8"],
  );
  for (const output of outputs) {
    assert.equal(output.status, "done");
    assert.equal(output.settings.profileId, body.profileId);
    const params = new URLSearchParams(output.url.split("?")[1]);
    const file = mediaFile(params.get("filename"), params.get("subfolder"));
    assert.ok(file);
    assert.match(
      readImageMetadata(fs.readFileSync(file)).text.parameters,
      new RegExp(`Seed: ${output.settings.seed}(,|$)`),
    );
  }
});

test("an image run records its queue wait, observed model load, sampling and save", async (t) => {
  const id = "timed-image";
  const body = { ...bodyFor(id), queuedAt: Date.now() - 5000 };
  pending(id, body);
  const log = t.mock.method(console, "log", () => {});
  let state = "loading";
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
  const lines = log.mock.calls.map((call) => call.arguments[0]);
  const [line] = lines.filter((entry) => entry.includes("Radiance job timing "));
  assert.ok(line);
  const measured = JSON.parse(line.split("Radiance job timing ")[1]);
  assert.equal(measured.job, id);
  assert.equal(measured.model, "krea-2-turbo-iq8r");
  assert.equal(measured.initialModelState, "loading");
  assert.ok(measured.modelResidentAt >= measured.modelLoadingAt);
  assert.equal(measured.providerWaitMs, measured.modelResidentAt - measured.sentAt);
  assert.equal(measured.modelLoadMs, measured.modelResidentAt - measured.modelLoadingAt);
  assert.ok(measured.saveMs >= timing.saveMs);
  assert.equal(line.includes(body.prompt), false);
});

test("an image is saved even if the model timing lookup has not answered", async () => {
  const id = "image-without-model-timing";
  const body = bodyFor(id);
  pending(id, body);
  let signal;
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      models: (reading) => {
        signal = reading;
        return new Promise(() => {});
      },
      images: async () => [png],
    },
  });
  const [output] = galleryItems({ jobId: id });
  assert.equal(output.status, "done");
  assert.equal(output.timing.loadMs, undefined);
  assert.equal(signal.aborted, true);
});

test("a run ended by a forced Radiance restart keeps its ending when the dropped request fails", async () => {
  const id = "ended-by-restart";
  const body = bodyFor(id);
  pending(id, body);
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      images: async () => {
        setTerminalJob(id, { status: "failed", error: "Its worker was restarted while it ran." });
        throw new Error("socket hang up");
      },
    },
  });
  assert.equal(jobs.get(id).error, "Its worker was restarted while it ran.");
  assert.equal(galleryItems({ jobId: id })[0].failure, undefined);
});

test("an image shows estimated steps once its model is resident without polling during sampling", async () => {
  const id = "estimated-image";
  const body = bodyFor(id);
  pending(id, body);
  for (let index = 0; index < 3; index++)
    recordGeneration({
      body: { ...body, model: "krea-2-turbo-iq8r", steps: 8 },
      result: { runMs: 8000, stepMs: 1000, steps: 8, setupMs: 0, tailMs: 0 },
      radiance: true,
      warm: true,
    });
  let modelReads = 0;
  await runRadianceJob(id, body, worker, {
    store,
    client: {
      models: async () => {
        modelReads += 1;
        return [{ id: "krea-2-turbo-iq8r", state: "resident" }];
      },
      images: async () => {
        assert.equal(jobs.get(id).progress.phase, "Waiting for Model");
        await new Promise((resolve) => setImmediate(resolve));
        const { value, max, steps, estimated, endsAt } = jobs.get(id).progress;
        assert.ok(value < max);
        assert.equal(max, 8);
        assert.equal(steps, true);
        assert.equal(estimated, true);
        assert.ok(endsAt > Date.now());
        return [png];
      },
    },
  });
  assert.equal(modelReads, 1);
  assert.equal(jobs.get(id).status, "done");
});

test("a recorded video reconnects by exact ID and is deleted only after durable output publication", async (t) => {
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
  const phases = [];
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await runRadianceJob(id, body, worker, {
    store,
    recovered: true,
    pollMs: 1,
    client: {
      video: async (videoId) => {
        now += 1000;
        calls.push(["read", videoId]);
        if (jobs.get(id).progress) phases.push(jobs.get(id).progress);
        const sample = [
          { status: "queued" },
          { status: "in_progress", steps_done: 2, steps_total: 10, progress: 18 },
          { status: "in_progress", steps_done: 4, steps_total: 10, progress: 36 },
          { status: "in_progress", steps_done: 10, steps_total: 10, progress: 92 },
          { status: "completed" },
        ][calls.length - 1];
        return { id: videoId, ...sample };
      },
      videoContent: async (videoId) => {
        phases.push(jobs.get(id).progress);
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
    ...Array.from({ length: 5 }, () => ["read", "video-fixture"]),
    ["content", "video-fixture"],
    ["delete", "video-fixture"],
  ]);
  assert.deepEqual(
    phases.map((entry) => [entry.phase, entry.value, entry.max, entry.steps]),
    [
      ["Waiting for Execution", 0, 0, false],
      ["Generating", 2, 10, true],
      ["Generating", 4, 10, true],
      ["Decoding", 92, 100, false],
      ["Saving", 0, 0, false],
    ],
  );
  assert.equal(typeof phases[2].endsAt, "number");
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
