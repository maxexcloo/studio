import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GenerationQueue, type JobObservation, type QueueAdapter } from "./queue.ts";
import { queuePriority, RewriteStore } from "./store.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(filename = ":memory:") {
  const store = new RewriteStore(filename);
  const submitted: string[] = [];
  const observations = new Map<string, JobObservation>();
  const events: string[] = [];
  const adapter: QueueAdapter = {
    async submit(job) {
      submitted.push(job.id);
      return { status: "running", providerJobId: `provider-${job.id}` };
    },
    async observe(job) {
      return observations.get(job.id);
    },
    async cancel(job) {
      observations.set(job.id, { status: "cancelled" });
    },
    async saveOutputs(job) {
      events.push(`saved:${job.id}`);
    },
    async settled(job) {
      events.push(`released:${job.id}`);
    },
  };
  return {
    store,
    submitted,
    observations,
    events,
    adapter,
    queue: new GenerationQueue(store, adapter),
  };
}

test("sessions and queue records are scoped to the authenticated owner", () => {
  const { store } = fixture();
  try {
    const session = store.createSession("alice", "Image Session");
    const job = store.enqueue("alice", session.id, { prompt: "A bird" }, "image");
    assert.equal(store.session("bob", session.id), undefined);
    assert.equal(store.job("bob", job.id), undefined);
    assert.deepEqual(store.jobs("bob"), []);
    assert.throws(() => store.enqueue("bob", session.id, {}, "image"), /Session not found/);
    assert.throws(
      () => store.enqueue("bob", store.createSession("bob").id, {}, "refine", job.id),
      /Parent generation not found/,
    );
  } finally {
    store.close();
  }
});

test("conflicting work waits until outputs save; independent cloud work proceeds", async () => {
  const { store, queue, submitted, observations, events } = fixture();
  try {
    const session = store.createSession("alice");
    const image = store.enqueue("alice", session.id, {}, "image");
    const refine = store.enqueue("alice", session.id, {}, "refine", image.id);
    const cloud = store.enqueue("alice", session.id, {}, "image", undefined, "cloud");
    await queue.tick();
    assert.deepEqual(submitted, [image.id, cloud.id]);
    assert.equal(store.job("alice", refine.id)?.status, "waiting");
    observations.set(image.id, { status: "completed", outputs: [{ url: "/media/bird.png" }] });
    await queue.tick();
    assert.equal(store.job("alice", image.id)?.status, "completed");
    assert.deepEqual(events, [`saved:${image.id}`, `released:${image.id}`]);
    assert.deepEqual(submitted, [image.id, cloud.id, refine.id]);
  } finally {
    store.close();
  }
});

test("failed output persistence retains saving state and blocks conflicting work", async () => {
  const { store, queue, adapter, observations, submitted } = fixture();
  try {
    const session = store.createSession("alice");
    const first = store.enqueue("alice", session.id, {}, "image");
    const next = store.enqueue("alice", session.id, {}, "refine");
    await queue.tick();
    observations.set(first.id, { status: "completed", outputs: [{ url: "/media/a.png" }] });
    adapter.saveOutputs = async () => {
      throw new Error("Disk full");
    };
    await queue.tick();
    assert.equal(store.job("alice", first.id)?.status, "saving");
    assert.match(store.job("alice", first.id)?.reason || "", /Disk full/);
    assert.deepEqual(submitted, [first.id]);
    assert.equal(store.job("alice", next.id)?.status, "waiting");
    adapter.saveOutputs = async () => ({
      status: "completed",
      outputs: [{ url: "/comfy/view?filename=saved.png&type=media" }],
    });
    await queue.tick();
    assert.equal(store.job("alice", first.id)?.status, "completed");
    assert.equal(
      store.job("alice", first.id)?.outputs[0].url,
      "/comfy/view?filename=saved.png&type=media",
    );
    assert.deepEqual(submitted, [first.id, next.id]);
  } finally {
    store.close();
  }
});

test("restart follows only recorded provider jobs and never resubmits uncertain acceptance", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-queue-"));
  const filename = path.join(dir, "studio.sqlite");
  const first = fixture(filename);
  const session = first.store.createSession("alice");
  const accepted = first.store.enqueue("alice", session.id, {}, "image");
  const queued = first.store.enqueue("alice", session.id, {}, "refine");
  await first.queue.tick();
  first.store.close();
  const restored = fixture(filename);
  try {
    await restored.queue.tick();
    assert.deepEqual(restored.submitted, []);
    assert.equal(restored.store.job("alice", queued.id)?.status, "waiting");
    assert.equal(
      restored.store.job("alice", accepted.id)?.providerJobId,
      `provider-${accepted.id}`,
    );
    restored.observations.set(accepted.id, {
      status: "completed",
      outputs: [{ url: "/media/a.png" }],
    });
    await restored.queue.tick();
    assert.deepEqual(restored.submitted, [queued.id]);
  } finally {
    restored.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Completes running work tick by tick until the queue is idle. */
async function drain({ store, queue, observations }: ReturnType<typeof fixture>, passes = 20) {
  for (let pass = 0; pass < passes; pass++) {
    for (const job of store.jobs())
      if (job.status === "running") observations.set(job.id, { status: "completed" });
    await queue.tick();
    if (!store.jobs().some((job) => !["completed", "failed", "cancelled"].includes(job.status)))
      return;
  }
}
const mcp = (queueSet: string) => ({ priority: queuePriority.mcp, queueSet });

test("manual requests run before queued MCP work, FIFO within each tier", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const session = store.createSession("alice");
    const enqueue = (origin = {}) =>
      store.enqueue(
        "alice",
        session.id,
        {},
        "image",
        undefined,
        undefined,
        undefined,
        undefined,
        origin,
      ).id;
    const order = [enqueue(mcp("a")), enqueue(mcp("b")), enqueue(), enqueue()];
    await drain(queue);
    assert.deepEqual(queue.submitted, [order[2], order[3], order[0], order[1]]);
  } finally {
    store.close();
  }
});

test("a started MCP set stays contiguous and its order survives restart", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-queue-"));
  const filename = path.join(dir, "studio.sqlite");
  const first = fixture(filename);
  const session = first.store.createSession("alice");
  const enqueue = (store: RewriteStore, origin = {}) =>
    store.enqueue(
      "alice",
      session.id,
      {},
      "image",
      undefined,
      undefined,
      undefined,
      undefined,
      origin,
    ).id;
  const a1 = enqueue(first.store, mcp("a"));
  const a2 = enqueue(first.store, mcp("a"));
  const b1 = enqueue(first.store, mcp("b"));
  await first.queue.tick();
  assert.deepEqual(first.submitted, [a1]);
  const manual = enqueue(first.store);
  first.store.close();
  const restored = fixture(filename);
  try {
    await drain(restored);
    assert.deepEqual(restored.submitted, [a2, manual, b1]);
  } finally {
    restored.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Enqueues an image job loading `model` (and optional LoRAs) with an optional queue origin. */
const loading =
  (store: RewriteStore, sessionId: string) =>
  (model: string, origin = {}, loras?: unknown[]) =>
    store.enqueue(
      "alice",
      sessionId,
      { model, ...(loras ? { loras } : {}) },
      "image",
      undefined,
      undefined,
      undefined,
      undefined,
      origin,
    ).id;

test("queued work reusing the loaded model and LoRAs runs first within its tier", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const enqueue = loading(store, store.createSession("alice").id);
    const first = enqueue("a");
    await queue.queue.tick();
    const other = enqueue("b");
    const withLora = enqueue("a", {}, [{ name: "ink", strength: 1 }]);
    const reuse = enqueue("a");
    await drain(queue);
    assert.deepEqual(queue.submitted, [first, reuse, other, withLora]);
  } finally {
    store.close();
  }
});

test("reuse overtakes an older job at most three times, also across a restart", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-queue-"));
  const filename = path.join(dir, "studio.sqlite");
  const first = fixture(filename);
  const enqueue = loading(first.store, first.store.createSession("alice").id);
  const loaded = enqueue("a");
  await first.queue.tick();
  const other = enqueue("b");
  const reuse = [enqueue("a"), enqueue("a"), enqueue("a"), enqueue("a"), enqueue("a")];
  await drain(first, 2);
  assert.deepEqual(first.submitted, [loaded, reuse[0], reuse[1]]);
  first.store.close();
  const restored = fixture(filename);
  try {
    await drain(restored);
    assert.deepEqual(restored.submitted, [reuse[2], other, reuse[3], reuse[4]]);
  } finally {
    restored.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reuse never puts MCP work before manual requests or splits a started MCP set", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const enqueue = loading(store, store.createSession("alice").id);
    const running = enqueue("a");
    await queue.queue.tick();
    const reusingMcp = enqueue("a", mcp("u"));
    const manual = enqueue("b");
    const setFirst = enqueue("b", mcp("s"));
    const setSecond = enqueue("a", mcp("s"));
    const later = enqueue("b", mcp("t"));
    await drain(queue);
    assert.deepEqual(queue.submitted, [running, manual, setFirst, setSecond, reusingMcp, later]);
  } finally {
    store.close();
  }
});

test("pending cancellation avoids submission and failed retries get distinct IDs", async () => {
  const { store, queue, adapter, submitted } = fixture();
  try {
    const session = store.createSession("alice");
    const pending = store.enqueue("alice", session.id, {}, "image");
    await queue.cancel("alice", pending.id);
    await queue.tick();
    assert.deepEqual(submitted, []);
    const failed = store.enqueue("alice", session.id, { prompt: "bird" }, "image");
    adapter.submit = async () => ({ status: "failed", reason: "Worker unavailable." });
    await queue.tick();
    assert.equal(store.job("alice", failed.id)?.status, "failed");
    const retry = queue.retry("alice", failed.id)!;
    assert.notEqual(retry.id, failed.id);
    assert.equal(retry.input.clientJobId, retry.id);
    assert.equal(retry.sessionId, session.id);
    assert.equal(await queue.cancel("bob", retry.id), undefined);
  } finally {
    store.close();
  }
});

test("a slow submission does not block a later independent resource or duplicate acceptance", async () => {
  const { store, queue, adapter, submitted } = fixture();
  const started = deferred();
  const release = deferred();
  try {
    const session = store.createSession("alice");
    const cloud = store.enqueue("alice", session.id, {}, "image", undefined, "cloud");
    adapter.submit = async (job) => {
      submitted.push(job.id);
      if (job.id === cloud.id) {
        started.resolve();
        await release.promise;
      }
      return { status: "running" };
    };
    const firstTick = queue.tick();
    await started.promise;
    const gpu = store.enqueue("alice", session.id, {}, "image");
    await queue.tick();
    assert.deepEqual(submitted, [cloud.id, gpu.id]);
    release.resolve();
    await firstTick;
  } finally {
    release.resolve();
    await queue.stop();
    store.close();
  }
});

test("cancellation while readiness is pending releases its acquired runtime admission", async () => {
  const { store, queue, adapter, events, submitted } = fixture();
  const checking = deferred();
  const ready = deferred();
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image");
    adapter.eligible = async () => {
      checking.resolve();
      await ready.promise;
      return undefined;
    };
    const tick = queue.tick();
    await checking.promise;
    await queue.cancel("alice", job.id);
    ready.resolve();
    await tick;
    assert.deepEqual(submitted, []);
    assert.deepEqual(events, [`released:${job.id}`]);
  } finally {
    ready.resolve();
    await queue.stop();
    store.close();
  }
});

test("editable user presets are independent from profiles and owner scoped", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-presets-"));
  const filename = path.join(directory, "studio.sqlite");
  let store = new RewriteStore(filename);
  try {
    const preset = store.createPreset("alice", "Birds", {
      prompt: "A bird",
      profileId: "unchanged-profile-id",
    });
    assert.deepEqual(store.presets("alice"), [preset]);
    assert.deepEqual(store.presets("bob"), []);
    assert.equal(store.updatePreset("bob", preset.id, { title: "Other User" }), undefined);
    const updated = store.updatePreset("alice", preset.id, {
      title: "Blue Birds",
      input: { prompt: "A blue bird", profileId: "unchanged-profile-id" },
    });
    store.close();
    store = new RewriteStore(filename);
    assert.deepEqual(store.presets("alice"), [updated]);
    assert.equal(store.deletePreset("bob", preset.id), false);
    assert.equal(store.deletePreset("alice", preset.id), true);
    assert.deepEqual(store.presets("alice"), []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable admission enforces the existing per-user job limit across cloud and GPU work", () => {
  const { store } = fixture();
  try {
    const session = store.createSession("alice");
    const first = store.enqueue(
      "alice",
      session.id,
      {},
      "image",
      undefined,
      "provider:cliproxyapi",
      undefined,
      1,
    );
    assert.throws(
      () => store.enqueue("alice", session.id, {}, "image", undefined, "local-media", undefined, 1),
      { status: 429 },
    );
    store.save({ ...first, status: "completed" });
    assert.equal(
      store.enqueue("alice", session.id, {}, "image", undefined, "local-media", undefined, 1)
        .status,
      "queued",
    );
  } finally {
    store.close();
  }
});

test("the writing stage streams into the item, then queues the written prompt", async () => {
  const { store, adapter, submitted } = fixture();
  const step = deferred();
  const queue = new GenerationQueue(store, adapter, async (_job, { onThinking }) => {
    onThinking("A slow ");
    onThinking("push-in suits it.");
    await step.promise;
    return {
      prompt: "The camera pushes in.",
      thinking: "A slow push-in suits it.",
      model: "ai/text",
    };
  });
  try {
    const session = store.createSession("alice");
    const writing = { kind: "animate", theme: "cinematic" };
    const job = store.enqueue("alice", session.id, { prompt: "", writing }, "animate");
    assert.equal(job.status, "writing");
    await queue.tick();
    assert.deepEqual(submitted, []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(store.job("alice", job.id)?.progress, {
      thinking: "A slow push-in suits it.",
      prompt: "",
    });
    step.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await queue.tick();
    const written = store.job("alice", job.id)!;
    assert.deepEqual(submitted, [job.id]);
    assert.equal(written.input.prompt, "The camera pushes in.");
    assert.deepEqual(written.input.writing, {
      ...writing,
      prompt: "The camera pushes in.",
      model: "ai/text",
      thinking: "A slow push-in suits it.",
    });
    assert.equal(written.progress, undefined);
  } finally {
    await queue.stop();
    store.close();
  }
});

test("at most two prompts are written at once; the next waits in order", async () => {
  const { store, adapter } = fixture();
  const steps = new Map<string, ReturnType<typeof deferred>>();
  const queue = new GenerationQueue(store, adapter, async (job) => {
    const step = deferred();
    steps.set(job.id, step);
    await step.promise;
    return { prompt: "Written.", thinking: "", model: "ai/text" };
  });
  try {
    const session = store.createSession("alice");
    const writing = { kind: "request", request: "a fox" };
    const [first, second, third] = [1, 2, 3].map(() =>
      store.enqueue("alice", session.id, { prompt: "", writing }, "image"),
    );
    await queue.tick();
    assert.deepEqual([...steps.keys()], [first.id, second.id]);
    assert.equal(store.job("alice", third.id)?.reason, "Waiting for another prompt to be written.");
    steps.get(first.id)!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual([...steps.keys()], [first.id, second.id, third.id]);
    assert.equal(store.job("alice", third.id)?.reason, "");
    for (const step of steps.values()) step.resolve();
  } finally {
    await queue.stop();
    store.close();
  }
});

test("a writing failure fails the item with its reason; cancelling stops the writing", async () => {
  const { store, adapter, submitted, events } = fixture();
  let aborted = false;
  const queue = new GenerationQueue(store, adapter, (job, { signal }) =>
    job.input.prompt === "fail"
      ? Promise.reject(new Error("unusable reply"))
      : new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          }),
        ),
  );
  try {
    const session = store.createSession("alice");
    const writing = { kind: "animate" };
    const failing = store.enqueue("alice", session.id, { prompt: "fail", writing }, "animate");
    const cancelled = store.enqueue("alice", session.id, { prompt: "", writing }, "animate");
    await queue.tick();
    await queue.cancel("alice", cancelled.id);
    await queue.stop();
    assert.equal(store.job("alice", failing.id)?.status, "failed");
    assert.equal(
      store.job("alice", failing.id)?.reason,
      "Writing the prompt failed: unusable reply",
    );
    assert.equal(store.job("alice", cancelled.id)?.status, "cancelled");
    assert.ok(aborted);
    assert.deepEqual(submitted, []);
    assert.deepEqual(events.sort(), [`released:${cancelled.id}`, `released:${failing.id}`].sort());
    // A retry writes the prompt again.
    assert.equal(queue.retry("alice", failing.id)?.status, "writing");
  } finally {
    store.close();
  }
});
