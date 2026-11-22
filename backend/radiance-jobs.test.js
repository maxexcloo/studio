import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-radiance-jobs-"));
process.env.STUDIO_DATA_DIR = scratch;
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { jobs, setTerminalJob } = await import("./jobs.js");
const { runRadianceJob, recoverRadianceJob, orderedRadianceReferences } =
  await import("./radiance-jobs.js");
const { createGenerationQueueAdapter } = await import("./domain/generation-adapter.ts");
const { GenerationQueue } = await import("./domain/queue.ts");
const { Store } = await import("./domain/store.ts");
const { workloadQueue } = await import("./domain/workload-queue.ts");
const { fakeKubernetes } = await import("./fixtures/fake-kubernetes.ts");
const { openDatabase } = await import("./persistence/runtime.ts");
const { RuntimeController, memoryStore } = await import("./runtime/controller.ts");
const { KubernetesEngine } = await import("./runtime/kubernetes.ts");
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
        if (calls.length === 4) jobs.set(id, { ...jobs.get(id), status: "cancelling" });
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
        assert.match(jobs.get(id).error, /Radiance is finishing accepted work/);
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
      ["Finishing accepted work", 92, 100, false],
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

test("a recorded Radiance pinning failure survives process loss and retries once after the old pod leaves", async (t) => {
  const filename = path.join(scratch, "memory-recovery.sqlite");
  const db = new Store(openDatabase(filename));
  const owner = "";
  const session = db.createSession(owner).id;
  const id = "pending-memory-recovery";
  const body = bodyFor(id);
  const resource = "worker:radiance";
  const original = db.enqueue(owner, session, body, "image", undefined, resource, id);
  db.save({ ...original, status: "starting" });
  const historical = db.enqueue(owner, session, body, "image", undefined, resource);
  const refusal = "Radiance: Tables placed in host memory cannot be pinned.";
  db.save({ ...historical, status: "failed", reason: refusal });
  pending(id, body);
  const pinFailure = {
    models: async () => [],
    images: async () => {
      throw new Error(refusal);
    },
  };
  await runRadianceJob(id, body, worker, { store: db, client: pinFailure });
  assert.equal(db.job(owner, id).status, "starting");
  db.close();
  jobs.delete(id);

  const restored = new Store(openDatabase(filename));
  t.after(() => restored.close());
  const submitted = [];
  const queue = new GenerationQueue(
    restored,
    createGenerationQueueAdapter({
      jobs,
      items: (job) => galleryItems({ jobId: job.id }),
      recover: async (job) => recoverRadianceJob(job, restored),
      submitGeneration: async (job) => {
        submitted.push(job.id);
        return { status: 200, payload: {} };
      },
    }),
  );
  await queue.tick();
  assert.equal(restored.job(owner, id).reason, refusal);
  assert.deepEqual(
    restored.pendingMemoryRecoveries().map((job) => job.id),
    [id],
  );
  assert.deepEqual(submitted, []);

  const workload = {
    id: "radiance",
    label: "Radiance",
    backend: "radiance",
    kind: "image",
    namespace: "radiance",
    deployment: "radiance",
    pool: "gpu",
    gpus: 2,
    url: worker.url,
  };
  const kube = fakeKubernetes([{ namespace: "radiance", name: "radiance", replicas: 1 }]);
  const engine = new KubernetesEngine(kube.request);
  const placement = memoryStore();
  const controller = (sleep = async () => kube.tick()) => {
    const runtime = new RuntimeController({
      engine,
      store: placement,
      workloads: [workload],
      pools: { gpu: 2 },
      radianceIdle: async () => true,
      sleep,
    });
    runtime.useQueue(
      workloadQueue({
        queue,
        leases: new Map(),
        admitting: new Set(),
        workloads: (job) => [job.backend],
      }),
    );
    return runtime;
  };
  // Lose the process after it scales down, with its old pod still terminating.
  const waitingForPod = Promise.withResolvers();
  const prior = controller(() => {
    waitingForPod.resolve();
    return new Promise(() => {});
  });
  await prior.restartWhenIdle();
  await waitingForPod.promise;
  const runtime = controller();
  assert.equal(placement.read().operations[0].status, "interrupted");
  await runtime.restartWhenIdle();
  assert.equal(restored.job(owner, id).replacementJobId, undefined);
  kube.tick();
  await runtime.reconcile();
  await runtime.settled;
  assert.deepEqual(kube.log, [
    "scale radiance/radiance 0",
    "gone radiance/radiance",
    "scale radiance/radiance 1",
  ]);
  const replacement = restored.job(owner, id).replacementJobId;
  assert.ok(replacement);
  assert.equal(restored.job(owner, replacement).retried, true);
  assert.equal(restored.job(owner, historical.id).replacementJobId, undefined);
  assert.deepEqual(restored.pendingMemoryRecoveries(), []);
  await controller().restartWhenIdle();
  assert.equal(kube.log.length, 3);

  await queue.tick();
  assert.deepEqual(submitted, [replacement]);
  const replacementBody = bodyFor(replacement);
  pending(replacement, replacementBody);
  await runRadianceJob(replacement, replacementBody, worker, {
    store: restored,
    client: pinFailure,
  });
  await queue.tick();
  assert.equal(restored.job(owner, replacement).status, "failed");
  assert.deepEqual(restored.pendingMemoryRecoveries(), []);
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
