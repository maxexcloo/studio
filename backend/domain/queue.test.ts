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
async function drain({ store, queue, observations }: ReturnType<typeof fixture>) {
  for (let pass = 0; pass < 20; pass++) {
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
