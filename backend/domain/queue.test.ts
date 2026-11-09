import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../persistence/runtime.ts";
import { createGenerationQueueAdapter } from "./generation-adapter.ts";
import {
  GenerationQueue,
  type JobObservation,
  type QueueAdapter,
  unreachableCancelReason,
} from "./queue.ts";
import { pausedReason } from "../../shared/queue.ts";
import { everyone, type OwnedJob, queuePriority, Store } from "./store.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(filename = ":memory:") {
  const store = new Store(openDatabase(filename));
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

test("an MCP conversation goes on in the first of the Chats its earlier jobs split into", () => {
  const { store } = fixture();
  try {
    const chat = { conversationId: "librechat-conversation" };
    const [first, second] = ["A first turn", "A second turn"].map((prompt) => {
      const split = store.createSession("alice", prompt);
      store.enqueue("alice", split.id, { prompt, chat }, "image");
      return split;
    });
    const joined = store.mcpSession("alice", "A third turn", {}, chat.conversationId);
    assert.equal(joined.id, first.id);
    assert.deepEqual(store.session("alice", first.id)?.mcp, chat);
    assert.equal(store.mcpSession("alice", "A fourth turn", {}, chat.conversationId).id, first.id);
    assert.equal(store.session("alice", second.id)?.mcp, undefined);
    // Another account's conversation of the same name is its own Chat.
    assert.notEqual(store.mcpSession("bob", "A turn", {}, chat.conversationId).id, first.id);
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

test("a save that fails the job (an unjoinable Extend) settles it as failed", async () => {
  const { store, queue, adapter, observations, events } = fixture();
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "animate");
    await queue.tick();
    observations.set(job.id, { status: "completed", outputs: [{ url: "/media/a.mp4" }] });
    adapter.saveOutputs = async () => ({ status: "failed", reason: "Studio couldn’t join it." });
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "failed");
    assert.equal(store.job("alice", job.id)?.reason, "Studio couldn’t join it.");
    assert.deepEqual(events, [`released:${job.id}`]);
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
      store.enqueue("alice", session.id, {}, "image", undefined, undefined, undefined, origin).id;
    const order = [enqueue(mcp("a")), enqueue(mcp("b")), enqueue(), enqueue()];
    await drain(queue);
    assert.deepEqual(queue.submitted, [order[2], order[3], order[0], order[1]]);
  } finally {
    store.close();
  }
});

test("direct and finishing work admitted after a waiting Dream job run first; Dream still runs", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const enqueue = (ownerId: string, origin = {}) =>
      store.enqueue(
        ownerId,
        store.createSession(ownerId).id,
        {},
        "image",
        undefined,
        undefined,
        undefined,
        origin,
      ).id;
    const dream = enqueue("alice", { priority: queuePriority.dream });
    const finishing = enqueue("carol", { priority: queuePriority.finishing });
    const direct = enqueue("bob");
    await drain(queue);
    assert.deepEqual(queue.submitted, [direct, finishing, dream]);
    assert.equal(store.job("alice", dream)?.status, "completed");
  } finally {
    store.close();
  }
});

test("an idle worker takes waiting work, but background work only while no manual work waits", async () => {
  const queue = fixture();
  const { store, observations } = queue;
  queue.adapter.alternatives = () => ["worker:primary", "worker:video"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string, origin = {}) =>
      store.enqueue("alice", session.id, {}, "image", undefined, resource, undefined, origin).id;
    const [manual1, manual2] = [enqueue("worker:primary"), enqueue("worker:primary")];
    const [mcp1, mcp2] = [enqueue("worker:video", mcp("a")), enqueue("worker:video", mcp("b"))];
    const where = (id: string) => store.job("alice", id)!;
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [manual1, mcp1]);
    // The video worker frees up: the waiting manual job moves there ahead of the MCP job.
    observations.set(mcp1, { status: "completed" });
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [manual1, mcp1, manual2]);
    assert.equal(where(manual2).backend, "video");
    assert.equal(where(mcp2).status, "waiting");
    // The primary worker frees up with no manual work waiting: it takes the MCP job.
    observations.set(manual1, { status: "completed" });
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [manual1, mcp1, manual2, mcp2]);
    assert.equal(where(mcp2).resource, "worker:primary");
  } finally {
    store.close();
  }
});

test("an idle worker takes waiting manual work before background work", async () => {
  const queue = fixture();
  const { store, observations } = queue;
  queue.adapter.alternatives = () => ["worker:primary", "worker:video"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string, origin = {}) =>
      store.enqueue("alice", session.id, {}, "image", undefined, resource, undefined, origin).id;
    const manual1 = enqueue("worker:primary");
    const [mcp1, mcp2] = [enqueue("worker:video", mcp("a")), enqueue("worker:video", mcp("b"))];
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [manual1, mcp1]);
    const manual2 = enqueue("worker:video");
    observations.set(manual1, { status: "completed" });
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [manual1, mcp1, manual2]);
    assert.equal(store.job("alice", mcp2)!.resource, "worker:video");
  } finally {
    store.close();
  }
});

test("a started MCP set stays ahead of other MCP work but not manual work, across a restart", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-queue-"));
  const filename = path.join(dir, "studio.sqlite");
  const first = fixture(filename);
  const session = first.store.createSession("alice");
  const enqueue = (store: Store, origin = {}) =>
    store.enqueue("alice", session.id, {}, "image", undefined, undefined, undefined, origin).id;
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
    assert.deepEqual(restored.submitted, [manual, a2, b1]);
  } finally {
    restored.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Enqueues an image job loading `model` (and optional LoRAs) with an optional queue origin. */
const loading =
  (store: Store, sessionId: string) =>
  (model: string, origin = {}, loras?: unknown[]) =>
    store.enqueue(
      "alice",
      sessionId,
      { model, ...(loras ? { loras } : {}) },
      "image",
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

test("a tick reads unfinished work and only the finished jobs it still weighs", () => {
  const store = new Store(openDatabase(":memory:"));
  try {
    const session = store.createSession("alice");
    const enqueue = (minute: number, status: string, origin = {}) => {
      const job = store.enqueue(
        "alice",
        session.id,
        {},
        "image",
        undefined,
        undefined,
        undefined,
        origin,
      );
      store.save({ ...job, status: status as OwnedJob["status"] });
      store.db
        .prepare("UPDATE studio_queue SET created_at = ? WHERE id = ?")
        .run(`2026-11-04T10:0${minute}:00.000Z`, job.id);
      return job.id;
    };
    enqueue(1, "completed");
    const setDone = enqueue(2, "completed", mcp("a"));
    const open = enqueue(3, "queued", mcp("a"));
    const later = enqueue(4, "failed");
    assert.deepEqual(
      store.schedulable().map((job) => job.id),
      [setDone, open, later],
    );
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
  let store = new Store(openDatabase(filename));
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
    store = new Store(openDatabase(filename));
    assert.deepEqual(store.presets("alice"), [updated]);
    assert.equal(store.deletePreset("bob", preset.id), false);
    assert.equal(store.deletePreset("alice", preset.id), true);
    assert.deepEqual(store.presets("alice"), []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
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
      model: "local/text",
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
      model: "local/text",
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
    return { prompt: "Written.", thinking: "", model: "local/text" };
  });
  try {
    const session = store.createSession("alice");
    const writing = { kind: "animate", theme: "living", source: "a fox" };
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

test("a paused queue holds only its owner's pending work, survives a restart and resumes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-queue-pause-"));
  const filename = path.join(directory, "studio.sqlite");
  let queue = fixture(filename);
  try {
    const alice = queue.store.createSession("alice");
    const bob = queue.store.createSession("bob");
    const running = queue.store.enqueue("alice", alice.id, {}, "image", undefined, "alice-gpu");
    await queue.queue.tick();
    queue.store.setPaused("alice", true);
    const held = queue.store.enqueue("alice", alice.id, {}, "image");
    const free = queue.store.enqueue("bob", bob.id, {}, "image");
    await queue.queue.tick();
    // Alice's started job runs on; her new one waits as Paused while Bob's runs on the same worker.
    assert.deepEqual(queue.submitted, [running.id, free.id]);
    assert.equal(queue.store.job("alice", running.id)?.status, "running");
    const paused = queue.store.job("alice", held.id);
    assert.deepEqual([paused?.status, paused?.reason], ["queued", pausedReason]);
    queue.store.close();
    queue = fixture(filename);
    queue.store.setPaused(everyone, true);
    const later = queue.store.enqueue("bob", bob.id, {}, "image", undefined, "bob-gpu");
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, []);
    assert.equal(queue.store.job("bob", later.id)?.reason, pausedReason);
    queue.store.setPaused(everyone, false);
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [later.id]);
    assert.equal(queue.store.job("alice", held.id)?.reason, pausedReason);
    queue.store.setPaused("alice", false);
    await drain(queue);
    assert.equal(queue.store.job("alice", held.id)?.status, "completed");
  } finally {
    queue.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("moves reorder only the owner's pending items, within their tiers and others' places", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const alice = store.createSession("alice");
    const bob = store.createSession("bob");
    const enqueue = (owner: string, session: string, origin = {}) =>
      store.enqueue(owner, session, {}, "image", undefined, undefined, undefined, origin).id;
    const a1 = enqueue("alice", alice.id);
    const b1 = enqueue("bob", bob.id);
    const a2 = enqueue("alice", alice.id);
    const aMcp = enqueue("alice", alice.id, mcp("set"));
    const b2 = enqueue("bob", bob.id);
    assert.equal(store.move("alice", aMcp, 0), true);
    assert.equal(store.move("alice", a1, 2), true);
    assert.equal(store.move("bob", a2, 0), false);
    // Alice's items trade places among themselves; Bob's keep theirs.
    assert.deepEqual(
      store.jobs().map((job) => job.id),
      [aMcp, b1, a2, a1, b2],
    );
    // Moved to the top, MCP work still runs after every account's manual work.
    await drain(queue);
    assert.deepEqual(queue.submitted, [b1, a2, a1, b2, aMcp]);
  } finally {
    store.close();
  }
});

test("a running job whose worker refuses connections cancels at once; one that times out stays recorded", async () => {
  const store = new Store(openDatabase(":memory:"));
  const live = new Map<string, Record<string, unknown>>();
  const released: string[] = [];
  // What comfy/queue.js cancelPrompt answers for a refused connection; anything else throws.
  let worker = async () => "unreachable";
  const queue = new GenerationQueue(
    store,
    createGenerationQueueAdapter({
      async submitGeneration(job) {
        live.set(job.id, { status: "running", promptId: `p-${job.id}`, ownerId: "alice" });
        return { status: 200, payload: { ok: true } };
      },
      jobs: live,
      gallery: () => [],
      accountForOwner: () => ({ authenticated: true }),
      flushGallery: async () => undefined,
      cancelPrompt: () => worker(),
      settled: async (job) => {
        released.push(job.id);
      },
    }),
  );
  try {
    const session = store.createSession("alice");
    const parked = store.enqueue("alice", session.id, { prompt: "A bird" }, "image");
    await queue.tick();
    assert.equal(store.job("alice", parked.id)?.status, "running");
    const cancelled = await queue.cancel("alice", parked.id);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.reason, unreachableCancelReason);
    assert.deepEqual(released, [parked.id]);

    worker = async () => {
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    };
    const busy = store.enqueue("alice", session.id, { prompt: "A fish" }, "image");
    await queue.tick();
    await assert.rejects(queue.cancel("alice", busy.id), /timed out/);
    assert.equal(store.job("alice", busy.id)?.status, "running");
    assert.equal(store.job("alice", busy.id)?.cancelRequested, true);
  } finally {
    store.close();
  }
});
