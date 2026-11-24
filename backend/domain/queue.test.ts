import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pausedReason } from "../../shared/queue.ts";
import { openDatabase } from "../persistence/runtime.ts";
import { createGenerationQueueAdapter } from "./generation-adapter.ts";
import {
  GenerationQueue,
  type JobObservation,
  type QueueAdapter,
  goneOutputs,
  unreachableCancelReason,
} from "./queue.ts";
import { type OwnedJob, Store, everyone, listedFinishedJobs, queuePriority } from "./store.ts";

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

test("an MCP conversation goes on in the first of the sessions its earlier jobs split into", () => {
  const { store } = fixture();
  try {
    const chat = { conversationId: "librechat-conversation" };
    const [first, second] = ["A first turn", "A second turn"].map((prompt) => {
      const split = store.createSession("alice", prompt);
      store.enqueue("alice", split.id, { prompt, chat }, "image");
      return split;
    });
    const joined = store.mcpSession("alice", "A third turn", chat.conversationId);
    assert.equal(joined.id, first.id);
    assert.deepEqual(store.session("alice", first.id)?.mcp, chat);
    assert.equal(store.mcpSession("alice", "A fourth turn", chat.conversationId).id, first.id);
    assert.equal(store.session("alice", second.id)?.mcp, undefined);
    // Another account's conversation of the same name is its own session.
    assert.notEqual(store.mcpSession("bob", "A turn", chat.conversationId).id, first.id);
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
    const admittedAt = store.job("alice", image.id)?.admittedAt;
    assert.equal(typeof admittedAt, "number");
    assert.deepEqual(submitted, [image.id, cloud.id]);
    assert.equal(store.job("alice", refine.id)?.status, "waiting");
    observations.set(image.id, { status: "completed", outputs: [{ url: "/media/bird.png" }] });
    await queue.tick();
    const completed = store.job("alice", image.id)!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.admittedAt, admittedAt);
    assert.ok(completed.savingAt! >= admittedAt!);
    assert.deepEqual(events, [`saved:${image.id}`, `released:${image.id}`]);
    assert.deepEqual(submitted, [image.id, cloud.id, refine.id]);
  } finally {
    store.close();
  }
});

test("Waiting positions follow tier, model affinity and manual moves at dispatch", async (t) => {
  const { store, queue, submitted, observations } = fixture();
  t.after(() => store.close());
  const owner = "alice";
  const session = store.createSession(owner);
  const add = (model: string, priority: number = queuePriority.manual) =>
    store.enqueue(owner, session.id, { model }, "image", undefined, "worker:gpu", undefined, {
      priority,
    });
  const running = add("warm");
  await queue.tick();
  const cold = add("cold");
  const mcp = add("warm", queuePriority.mcp);
  const warm = add("warm");
  const later = add("warm");
  await queue.tick();

  assert.deepEqual(
    store.movable(owner).map(({ id }) => id),
    [cold.id, mcp.id, warm.id, later.id],
  );
  assert.deepEqual(
    [cold, mcp, warm, later].map(({ id }) => queue.queuePosition(id)),
    [3, 4, 1, 2],
  );
  assert.equal(store.move(owner, [later.id], 2), true);
  await queue.tick();
  assert.deepEqual(
    [cold, mcp, warm, later].map(({ id }) => queue.queuePosition(id)),
    [3, 4, 2, 1],
  );

  observations.set(running.id, { status: "completed" });
  await queue.tick();
  assert.deepEqual(submitted, [running.id, later.id]);
});

test("Waiting photos precede videos of the same priority on their worker", async (t) => {
  const { store, queue, submitted, observations } = fixture();
  t.after(() => store.close());
  const alice = store.createSession("alice");
  const bob = store.createSession("bob");
  const add = (
    owner: string,
    session: string,
    kind: "image" | "video",
    model: string,
    priority: number = queuePriority.manual,
  ) =>
    store.enqueue(owner, session, { kind, model }, "image", undefined, "worker:gpu", undefined, {
      priority,
    });

  const running = add("alice", alice.id, "image", "warm");
  await queue.tick();
  const video = add("alice", alice.id, "video", "warm");
  const photo = add("alice", alice.id, "image", "cold");
  const mcpPhoto = add("bob", bob.id, "image", "warm", queuePriority.mcp);
  await queue.tick();

  assert.deepEqual(submitted, [running.id]);
  assert.deepEqual(
    [photo, video, mcpPhoto].map(({ id }) => queue.queuePosition(id)),
    [1, 2, 3],
  );

  observations.set(running.id, { status: "completed" });
  await queue.tick();
  assert.deepEqual(submitted, [running.id, photo.id]);

  observations.set(photo.id, { status: "completed" });
  await queue.tick();
  assert.deepEqual(submitted, [running.id, photo.id, video.id]);
});

test("Waiting positions reflect the spare slot's reordered list during eligibility", async () => {
  const { store, queue, adapter, submitted } = fixture();
  const checking = deferred();
  const allow = deferred();
  adapter.slots = () => 2;
  const session = store.createSession("alice");
  const add = (model: string) =>
    store.enqueue("alice", session.id, { model }, "image", undefined, "worker:gpu");
  const first = add("a");
  const other = add("b");
  const same = add("a");
  adapter.eligible = async (job) => {
    if (job.id === same.id) {
      checking.resolve();
      await allow.promise;
    }
    return undefined;
  };
  const dispatch = queue.tick();
  try {
    await checking.promise;
    assert.deepEqual(submitted, [first.id]);
    assert.equal(queue.queuePosition(first.id), undefined);
    assert.equal(queue.queuePosition(same.id), 1);
    assert.equal(queue.queuePosition(other.id), 2);
  } finally {
    allow.resolve();
    await dispatch;
    store.close();
  }
  assert.deepEqual(submitted, [first.id, same.id]);
});

test("A worker restart keeps work ended when an in-flight provider response arrives", async (t) => {
  for (const stage of ["submit", "observe"] as const) {
    const { store, queue, adapter, events } = fixture();
    t.after(() => store.close());
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image");
    if (stage === "observe") await queue.tick();
    const requested = deferred();
    const respond = deferred();
    adapter[stage] = async () => {
      requested.resolve();
      await respond.promise;
      return { status: "completed", outputs: [{ url: "/media/old-run.png" }] };
    };
    const tick = queue.tick();
    await requested.promise;
    await queue.end("alice", job.id, "Worker restarted.");
    respond.resolve();
    await tick;
    assert.equal(store.job("alice", job.id)?.status, "failed", stage);
    assert.deepEqual(events, [`released:${job.id}`], stage);
  }
});

test("one local video runs at a time across workers; images and cloud videos go alongside", async () => {
  const { store, queue, submitted, observations } = fixture();
  try {
    const session = store.createSession("alice");
    const video = { kind: "video" as const };
    const first = store.enqueue("alice", session.id, video, "image", undefined, "worker:primary");
    const second = store.enqueue(
      "alice",
      session.id,
      video,
      "image",
      undefined,
      "worker:secondary",
    );
    const image = store.enqueue("alice", session.id, {}, "image", undefined, "worker:secondary");
    const cloud = store.enqueue("alice", session.id, video, "image", undefined, "cloud");
    await queue.tick();
    assert.deepEqual([...submitted].sort(), [first.id, image.id, cloud.id].sort());
    observations.set(image.id, { status: "completed" });
    await queue.tick();
    assert.equal(store.job("alice", second.id)?.reason, "Waiting for another video to finish.");
    assert.deepEqual([...submitted].sort(), [first.id, image.id, cloud.id].sort());
    observations.set(first.id, { status: "completed" });
    await queue.tick();
    assert.equal(submitted.at(-1), second.id);
  } finally {
    store.close();
  }
});

test("waiting transitions persist once, change their reason and resume when ready", async (t) => {
  for (const occupied of [false, true])
    await t.test(occupied ? "occupied worker" : "worker readiness", async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "studio-wait-"));
      const filename = path.join(dir, "studio.sqlite");
      const f = fixture(filename);
      let reason: string | undefined = "Worker is starting.";
      if (!occupied) f.adapter.eligible = async () => reason;
      try {
        const session = f.store.createSession("alice");
        const active = occupied ? f.store.enqueue("alice", session.id, {}, "image") : undefined;
        if (active) {
          await f.queue.tick();
          f.observations.set(active.id, { status: "running" });
        }
        const waiting = f.store.enqueue("alice", session.id, {}, "image");
        const save = f.store.save.bind(f.store);
        let writes = 0;
        f.store.save = (job) => {
          if (job.id === waiting.id) writes++;
          return save(job);
        };
        await f.queue.tick();
        assert.equal(writes, 1);
        assert.equal(f.store.job("alice", waiting.id)?.status, "waiting");
        await f.queue.tick();
        assert.equal(writes, 1);
        if (!occupied) {
          reason = "Worker is loading its model.";
          await f.queue.tick();
          assert.equal(writes, 2);
        }
        const persisted = new Store(openDatabase(filename));
        try {
          assert.equal(persisted.job("alice", waiting.id)?.status, "waiting");
          assert.equal(
            persisted.job("alice", waiting.id)?.reason,
            occupied ? "Waiting for earlier work to finish and save its outputs." : reason,
          );
        } finally {
          persisted.close();
        }
        reason = undefined;
        if (active) f.observations.set(active.id, { status: "completed" });
        await f.queue.tick();
        assert.ok(f.submitted.includes(waiting.id));
        assert.equal(f.store.job("alice", waiting.id)?.status, "running");
      } finally {
        f.store.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
});

test("a worker with two slots runs two jobs at once, the third waiting for one to finish", async () => {
  const { store, adapter, submitted, observations } = fixture();
  const queue = new GenerationQueue(store, {
    ...adapter,
    slots: (resource) => (resource === "worker:radiance" ? 2 : 1),
  });
  try {
    const session = store.createSession("alice");
    const enqueue = () =>
      store.enqueue("alice", session.id, {}, "image", undefined, "worker:radiance").id;
    const [first, second, third] = [enqueue(), enqueue(), enqueue()];
    await queue.tick();
    assert.deepEqual(submitted, [first, second]);
    assert.equal(store.job("alice", third)?.status, "waiting");
    assert.equal(queue.loads().get("worker:radiance")?.busy, true);
    observations.set(first, { status: "completed", outputs: [] });
    await queue.tick();
    assert.deepEqual(submitted, [first, second, third]);
  } finally {
    store.close();
  }
});

test("accepted observations persist changes without rewriting unchanged provider state", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-observe-"));
  const filename = path.join(dir, "studio.sqlite");
  const { store, queue, adapter, submitted, observations } = fixture(filename);
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image", undefined, "worker:primary");
    await queue.tick();
    const save = store.save.bind(store);
    let writes = 0;
    store.save = (next) => {
      writes++;
      return save(next);
    };
    const running: JobObservation = {
      status: "running",
      backend: "primary",
      providerJobId: "recorded-provider-id",
      progress: { value: 1, max: 8, phase: "sampling" },
      items: [{ url: "/media/preview.png" }],
      outputs: [],
    };
    const counts: number[] = [];
    const beforeChanges = Number(store.db.prepare("SELECT total_changes() AS count").get()!.count);
    for (const state of ["running", "recovering", "error"]) {
      adapter.observe = async () => {
        if (state === "error") throw new Error("Worker unavailable");
        // Each poll returns freshly decoded objects, as real adapters do.
        return state === "running" ? structuredClone(running) : undefined;
      };
      const before = writes;
      for (let tick = 0; tick < 100; tick++) await queue.tick();
      counts.push(writes - before);
    }
    t.diagnostic(`300 observations: ${counts.join(" + ")} = ${writes} queue record writes`);
    assert.equal(
      Number(store.db.prepare("SELECT total_changes() AS count").get()!.count) - beforeChanges,
      writes,
    );
    assert.deepEqual(counts, [1, 1, 1]);
    const persisted = new Store(openDatabase(filename));
    try {
      const latest = persisted.job("alice", job.id)!;
      assert.equal(latest.reason, "Waiting for the recorded generation: Worker unavailable");
      assert.equal(latest.providerJobId, running.providerJobId);
      assert.deepEqual(latest.progress, running.progress);
      const unchanged = latest.updatedAt;
      await queue.tick();
      assert.equal(store.job("alice", job.id)?.updatedAt, unchanged);
    } finally {
      persisted.close();
    }
    adapter.observe = async () => {
      throw new Error("Worker restarting");
    };
    await queue.tick();
    assert.equal(writes, 4);
    assert.match(store.job("alice", job.id)!.reason, /Worker restarting/);
    adapter.observe = async () => structuredClone(running);
    await queue.tick();
    assert.equal(writes, 5);
    assert.equal(store.job("alice", job.id)?.reason, "");
    const changed: JobObservation = {
      ...running,
      backend: "secondary",
      providerJobId: "recovered-provider-id",
      progress: { phase: "sampling", max: 8, value: 2 },
      items: [{ url: "/media/new-preview.png" }],
      outputs: [{ url: "/media/partial.png" }],
    };
    adapter.observe = async () => structuredClone(changed);
    await queue.tick();
    assert.equal(writes, 6);
    for (const [key, value] of Object.entries(changed))
      assert.deepEqual(store.job("alice", job.id)![key as keyof OwnedJob], value);
    adapter.observe = async () => ({
      ...changed,
      progress: { value: 2, max: 8, phase: "sampling" },
    });
    await queue.tick();
    assert.equal(writes, 6);
    adapter.observe = async () => ({ ...changed, progress: undefined, items: [], outputs: [] });
    await queue.tick();
    await queue.tick();
    assert.equal(writes, 7);
    assert.equal(store.job("alice", job.id)?.progress, undefined);
    assert.deepEqual(store.job("alice", job.id)?.items, []);
    adapter.observe = async () => {
      await queue.cancel("alice", job.id);
      return { ...changed, status: "running" as const };
    };
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.cancelRequested, true);
    adapter.observe = async () => observations.get(job.id);
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "cancelled");
    assert.deepEqual(submitted, [job.id]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run without progress for 10 minutes is stopped, failed and queued once on a free worker", async () => {
  const { store, adapter, submitted, observations, events } = fixture();
  const queue = new GenerationQueue(store, {
    ...adapter,
    alternatives: () => ["worker:primary", "worker:secondary"],
  });
  let at = 0;
  queue.now = () => at;
  try {
    const session = store.createSession("alice");
    const hung = store.enqueue(
      "alice",
      session.id,
      { kind: "image" },
      "image",
      undefined,
      "worker:primary",
      undefined,
      { priority: queuePriority.dream },
    ).id;
    await queue.tick();
    const stuck = { status: "running" as const, progress: { value: 7, max: 8 } };
    observations.set(hung, stuck);
    await queue.tick();
    at = 9 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", hung)?.status, "running");
    observations.set(hung, { ...stuck, progress: { value: 8, max: 8 } });
    await queue.tick();
    at = 10 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", hung)?.status, "running");
    at = 19 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", hung)?.status, "failed");
    assert.equal(store.job("alice", hung)?.reason, "Stopped: no progress for 10 min.");
    assert.ok(events.includes(`released:${hung}`));
    const retry = store.jobs("alice").find((job) => job.id !== hung)!;
    assert.deepEqual(
      [retry.resource, retry.priority, retry.retried],
      ["worker:secondary", queuePriority.dream, true],
    );
    await queue.tick();
    assert.deepEqual(submitted, [hung, retry.id]);
    // A retry that stalls too only fails.
    observations.set(retry.id, stuck);
    await queue.tick();
    at = 30 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", retry.id)?.status, "failed");
    assert.equal(store.jobs("alice").length, 2);
  } finally {
    store.close();
  }
});

test("work nothing reports on for 30 minutes ends: a lost recovery fails, an unconfirmed Stop cancels", async () => {
  const { store, queue, adapter, observations } = fixture();
  let at = 0;
  queue.now = () => at;
  try {
    const session = store.createSession("alice");
    const lost = store.enqueue(
      "alice",
      session.id,
      { kind: "video" },
      "animate",
      undefined,
      "worker:primary",
    ).id;
    const stopping = store.enqueue("alice", session.id, {}, "image", undefined, "worker:other").id;
    await queue.tick();
    observations.delete(lost);
    observations.set(stopping, { status: "running" });
    adapter.cancel = async () => {};
    await queue.cancel("alice", stopping);
    await queue.tick();
    at = 29 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", lost)?.status, "running");
    at = 30 * 60_000;
    await queue.tick();
    assert.equal(store.job("alice", lost)?.status, "failed");
    assert.equal(store.job("alice", lost)?.reason, "Stopped: no progress for 30 min.");
    assert.equal(store.job("alice", stopping)?.status, "cancelled");
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
    adapter.saveOutputs = async () => ({ status: "failed", reason: "Studio couldn't join it." });
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "failed");
    assert.equal(store.job("alice", job.id)?.reason, "Studio couldn't join it.");
    assert.deepEqual(events, [`released:${job.id}`]);
  } finally {
    store.close();
  }
});

test("a save that finds its outputs gone fails after three tries; other failures keep trying", async () => {
  const { store, queue, adapter, observations, events } = fixture();
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image");
    await queue.tick();
    observations.set(job.id, { status: "completed", outputs: [{ url: "/media/a.png" }] });
    adapter.saveOutputs = async () => {
      throw goneOutputs("Its outputs are no longer on its worker.");
    };
    await queue.tick();
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "saving");
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "failed");
    assert.equal(store.job("alice", job.id)?.reason, "Its outputs are no longer on its worker.");
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
  const warm = first.store.enqueue(
    "alice",
    session.id,
    { profileId: "loaded-model" },
    "image",
    undefined,
    "worker:idle",
  );
  first.store.save({ ...warm, status: "completed" });
  const accepted = first.store.enqueue("alice", session.id, {}, "image");
  const queued = first.store.enqueue("alice", session.id, {}, "refine");
  await first.queue.tick();
  first.store.close();
  const restored = fixture(filename);
  try {
    await restored.queue.restoreLoaded();
    assert.equal(restored.queue.loads().get("worker:idle")?.model, "loaded-model");
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

test("stopping leaves a running job to its worker, and a restart follows it to the end", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-queue-"));
  const filename = path.join(dir, "studio.sqlite");
  const first = fixture(filename);
  const session = first.store.createSession("alice");
  const job = first.store.enqueue("alice", session.id, {}, "image");
  await first.queue.tick();
  // The worker stops answering: the next observation never returns.
  first.adapter.observe = () => new Promise(() => {});
  void first.queue.tick();
  first.queue.stop();
  first.store.close();
  const restored = fixture(filename);
  try {
    restored.observations.set(job.id, { status: "completed", outputs: [{ url: "/media/a.png" }] });
    await restored.queue.tick();
    assert.equal(restored.store.job("alice", job.id)?.status, "completed");
    assert.deepEqual(restored.submitted, []);
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

test("direct and MCP work admitted after a waiting Dream job run first; Dream still runs", async () => {
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
    const chat = enqueue("carol", { priority: queuePriority.mcp });
    const direct = enqueue("bob");
    await drain(queue);
    assert.deepEqual(queue.submitted, [direct, chat, dream]);
    assert.equal(store.job("alice", dream)?.status, "completed");
  } finally {
    store.close();
  }
});

test("Dream rechecks the owner's idle delay before dispatching a prepared job", async () => {
  const { store, queue, adapter, submitted } = fixture();
  try {
    const session = store.createSession("alice");
    const job = store.enqueue(
      "alice",
      session.id,
      { kind: "video" },
      "animate",
      undefined,
      undefined,
      undefined,
      { priority: queuePriority.dream },
    );
    let cutoff = "";
    adapter.dreamIdleWait = ({ ownerId }) =>
      store.hasRecentGenerationRequest(ownerId, cutoff) ? "Waiting for idle time." : undefined;
    adapter.eligible = async () => {
      const request = store.enqueue("alice", session.id, { kind: "image" }, "image");
      store.save({ ...request, status: "completed" });
    };
    await queue.tick();
    assert.deepEqual(submitted, []);
    assert.equal(store.job("alice", job.id)?.reason, "Waiting for idle time.");
    cutoff = new Date(Date.now() + 1).toISOString();
    adapter.eligible = undefined;
    await queue.tick();
    assert.deepEqual(submitted, [job.id]);
  } finally {
    store.close();
  }
});

test("Dream reuses a loaded model but waits for an empty queue before loading another", async (t) => {
  const { store, queue, adapter, submitted, observations } = fixture();
  t.after(() => store.close());
  let now = 0;
  queue.now = () => now;
  adapter.dreamImageSwitchMinutes = () => 2;
  const session = store.createSession("alice").id;
  const enqueue = (model: string, priority: number = queuePriority.manual) =>
    store.enqueue(
      "alice",
      session,
      { kind: "image", model },
      "image",
      undefined,
      "worker:gpu",
      undefined,
      {
        priority,
      },
    );
  const manual = enqueue("warm");
  await queue.tick();

  now += 180_000;
  const cold = enqueue("cold", queuePriority.dream);
  const warm = enqueue("warm", queuePriority.dream);
  observations.set(manual.id, { status: "completed" });
  await queue.tick();
  assert.deepEqual(submitted, [manual.id, warm.id]);
  assert.match(queue.dreamModelWait(cold) || "", /idle/);

  observations.set(warm.id, { status: "completed" });
  await queue.tick();
  now += 120_000;
  let interveningRequest: OwnedJob | undefined;
  adapter.eligible = async (job) => {
    if (job.id === cold.id) interveningRequest = enqueue("warm");
  };
  await queue.tick();
  assert.ok(interveningRequest);
  assert.deepEqual(submitted, [manual.id, warm.id]);
  adapter.eligible = undefined;
  await queue.tick();
  assert.deepEqual(submitted, [manual.id, warm.id, interveningRequest.id]);

  observations.set(interveningRequest.id, { status: "completed" });
  await queue.tick();
  now += 119_000;
  await queue.tick();
  assert.match(store.job("alice", cold.id)?.reason || "", /idle/);
  now += 1_000;
  await queue.tick();
  assert.deepEqual(submitted, [manual.id, warm.id, interveningRequest.id, cold.id]);
});

test("Dream can reuse a loaded photo setup immediately but waits the shared switch delay for changed LoRAs", async (t) => {
  const { store, queue, adapter, submitted, observations } = fixture();
  t.after(() => store.close());
  let now = 0;
  let minutes = 3;
  queue.now = () => now;
  adapter.dreamImageSwitchMinutes = () => minutes;
  const session = store.createSession("alice").id;
  const stack = [
    { name: "grain", strength: 0.5 },
    { name: "lighting", strength: 1 },
  ];
  const enqueue = (loras: typeof stack, priority: number) =>
    store.enqueue(
      "alice",
      session,
      { kind: "image", model: "warm", loras },
      "image",
      undefined,
      "worker:gpu",
      undefined,
      { priority },
    );
  const foreground = enqueue(stack, queuePriority.manual);
  await queue.tick();
  const changed = enqueue([{ ...stack[0], strength: 0.75 }, stack[1]], queuePriority.dream);
  const same = enqueue([...stack].reverse(), queuePriority.dream);
  observations.set(foreground.id, { status: "completed" });
  await queue.tick();
  assert.deepEqual(submitted, [foreground.id, same.id]);

  observations.set(same.id, { status: "completed" });
  await queue.tick();
  now = 120_000;
  await queue.tick();
  assert.match(store.job("alice", changed.id)?.reason || "", /3 minutes.*LoRAs/);
  assert.deepEqual(submitted, [foreground.id, same.id]);
  minutes = 0;
  await queue.tick();
  assert.deepEqual(submitted, [foreground.id, same.id, changed.id]);
});

test("Dream only bypasses a wait on its verified worker, and yields to new foreground work", async (t) => {
  const { store, queue, adapter, submitted, observations } = fixture();
  t.after(() => store.close());
  const session = store.createSession("alice").id;
  const enqueue = (profileId: string, resource: string, priority: number) =>
    store.enqueue(
      "alice",
      session,
      { kind: "image", profileId },
      "image",
      undefined,
      resource,
      undefined,
      { priority },
    );
  const warm = enqueue("warm-profile", "worker:gpu", queuePriority.manual);
  await queue.tick();
  observations.set(warm.id, { status: "completed" });
  const other = enqueue("another-profile", "worker:gpu", queuePriority.manual);
  await queue.tick();
  observations.set(other.id, { status: "completed" });
  await queue.tick();

  assert.equal(queue.usedProfile(warm.input, "worker:gpu"), true);
  assert.equal(queue.usedProfile(warm.input, "worker:other"), false);
  assert.equal(
    queue.usedProfile({ ...warm.input, profileId: "same-model-different-profile" }, "worker:gpu"),
    false,
  );
  assert.equal(
    queue.usedProfile({ ...warm.input, loras: [{ name: "grain", strength: 0.5 }] }, "worker:gpu"),
    false,
  );

  const dream = enqueue("warm-profile", "worker:gpu", queuePriority.dream);
  adapter.dreamIdleWait = () => "Dream waits after a request.";
  await queue.tick();
  assert.equal(store.job("alice", dream.id)?.status, "waiting");
  let intervening: OwnedJob | undefined;
  adapter.dreamResidentModel = async (job) => {
    intervening ??= enqueue("warm-profile", "worker:other", queuePriority.manual);
    return queue.usedProfile(job.input, job.resource) ? "engine-warm-model" : undefined;
  };
  await queue.tick();
  assert.match(store.job("alice", dream.id)?.reason || "", /user work/);
  assert.ok(intervening);
  await queue.tick();
  observations.set(intervening.id, { status: "completed" });

  const submit = adapter.submit;
  adapter.submit = async (job, model) => {
    if (job.id === dream.id) {
      assert.equal(model, "engine-warm-model");
      return { status: "waiting", deferredBeforeSubmission: true, reason: "It was unloaded." };
    }
    return submit(job);
  };
  await queue.tick();
  assert.equal(store.job("alice", dream.id)?.reason, "It was unloaded.");
  assert.deepEqual(submitted, [warm.id, other.id, intervening.id]);
  adapter.submit = submit;
  await queue.tick();
  assert.deepEqual(submitted, [warm.id, other.id, intervening.id, dream.id]);
  queue.unload("worker:gpu");
  assert.equal(queue.usedProfile(warm.input, "worker:gpu"), false);
});

test("an idle worker takes waiting work, manual work first", async () => {
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

test("work goes to an idle worker with its model loaded until that worker goes offline", async () => {
  const queue = fixture();
  const { store, observations } = queue;
  queue.adapter.alternatives = () => ["worker:primary", "worker:video"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string) =>
      store.enqueue("alice", session.id, { profileId: "flux" }, "image", undefined, resource).id;
    const where = (id: string) => store.job("alice", id)!.resource;
    const first = enqueue("worker:video");
    await queue.queue.tick();
    observations.set(first, { status: "completed" });
    await queue.queue.tick();
    // Both workers are idle; the video worker has the model loaded.
    const second = enqueue("worker:primary");
    await queue.queue.tick();
    assert.deepEqual(queue.submitted, [first, second]);
    assert.equal(where(second), "worker:video");
    observations.set(second, { status: "completed" });
    await queue.queue.tick();
    queue.queue.unload("worker:video");
    const third = enqueue("worker:primary");
    await queue.queue.tick();
    assert.equal(where(third), "worker:primary");
  } finally {
    store.close();
  }
});

test("a waiting job moves to the idle worker with its model loaded, manual work first", async () => {
  const queue = fixture();
  const { store, observations } = queue;
  queue.adapter.alternatives = () => ["worker:a", "worker:b", "worker:c"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string, profileId: string, origin = {}) =>
      store.enqueue(
        "alice",
        session.id,
        { profileId },
        "image",
        undefined,
        resource,
        undefined,
        origin,
      ).id;
    const where = (id: string) => store.job("alice", id)!;
    const loads = [enqueue("worker:b", "sdxl"), enqueue("worker:c", "flux")];
    await queue.queue.tick();
    for (const id of loads) observations.set(id, { status: "completed" });
    await queue.queue.tick();
    // Worker a gets busy with a model no idle worker has loaded, so it stays there.
    enqueue("worker:a", "wan");
    await queue.queue.tick();
    const background = enqueue("worker:a", "flux", mcp("a"));
    const manual = enqueue("worker:a", "flux");
    await queue.queue.tick();
    // The manual job skips the idle worker b for c, which has flux loaded; background work takes b.
    assert.equal(where(manual).resource, "worker:c");
    assert.equal(where(background).resource, "worker:b");
  } finally {
    store.close();
  }
});

test("split Count reserves one worker, moves together before starting and survives completion and restart", async () => {
  const { store, adapter, observations, submitted } = fixture();
  adapter.alternatives = () => ["worker:a", "worker:b"];
  let queue = new GenerationQueue(store, adapter);
  try {
    const session = store.createSession("alice");
    const enqueue = (id: string, batch?: string) =>
      store.enqueue(
        "alice",
        session.id,
        { count: 1, profileId: "model" },
        "image",
        undefined,
        "worker:a",
        id,
        { queueSet: "request", ...(batch ? { queueBatch: batch } : {}) },
      );
    enqueue("busy");
    await queue.tick();
    enqueue("first", "first");
    enqueue("second", "first");
    await queue.tick();
    assert.equal(store.job("alice", "first")?.resource, "worker:b");
    assert.equal(store.job("alice", "second")?.resource, "worker:b");
    assert.deepEqual(submitted, ["busy", "first"]);
    observations.set("busy", { status: "completed" });
    await queue.tick();
    assert.equal(store.job("alice", "second")?.status, "waiting");
    // A different prompt/comparison in the same request can use the idle worker.
    enqueue("variant");
    await queue.tick();
    assert.deepEqual(submitted, ["busy", "first", "variant"]);
    observations.set("first", { status: "completed" });
    await queue.tick();
    assert.equal(store.job("alice", "second")?.resource, "worker:b");
    assert.equal(store.job("alice", "second")?.status, "running");
    // A later sibling still follows the completed first job, even after a process restart.
    store.enqueue("alice", session.id, { count: 1 }, "image", undefined, "worker:b", "third", {
      queueSet: "request",
      queueBatch: "first",
    });
    queue = new GenerationQueue(store, adapter);
    observations.set("variant", { status: "completed" });
    await queue.tick();
    assert.equal(store.job("alice", "third")?.resource, "worker:b");
    assert.equal(store.job("alice", "third")?.status, "waiting");
    observations.set("second", { status: "completed" });
    await queue.tick();
    assert.equal(store.job("alice", "third")?.status, "running");
    assert.equal(new Set(submitted).size, submitted.length);
  } finally {
    store.close();
  }
});

test("waiting siblings leave an unavailable reserved worker together without moving or resubmitting accepted work", async () => {
  const { store, adapter, observations, submitted } = fixture();
  adapter.alternatives = () => ["worker:a", "worker:b"];
  let queue = new GenerationQueue(store, adapter);
  try {
    const session = store.createSession("alice");
    for (const id of ["first", "second"])
      store.enqueue("alice", session.id, {}, "image", undefined, "worker:a", id, {
        queueSet: "set",
        queueBatch: "first",
      });
    await queue.tick();
    assert.deepEqual(submitted, ["first"]);
    await queue.cancel("alice", "first");
    await queue.tick();
    // Second has started only after the cancelled first released its slot.
    assert.deepEqual(submitted, ["first", "second"]);
    store.enqueue("alice", session.id, {}, "image", undefined, "worker:a", "third", {
      queueSet: "set",
      queueBatch: "first",
    });
    adapter.alternatives = () => ["worker:b"];
    adapter.eligible = async () => "Waiting for a worker.";
    observations.set("second", { status: "cancelled" });
    queue = new GenerationQueue(store, adapter);
    await queue.tick();
    assert.equal(store.job("alice", "second")?.resource, "worker:a");
    assert.equal(store.job("alice", "third")?.resource, "worker:b");
    await queue.cancel("alice", "third");
    await queue.tick();
    assert.equal(store.job("alice", "third")?.status, "cancelled");
    assert.deepEqual(submitted, ["first", "second"]);
  } finally {
    store.close();
  }
});

test("an idle worker with another model loaded takes work waiting behind a busy worker", async () => {
  const queue = fixture();
  const { store, observations, submitted } = queue;
  queue.adapter.alternatives = () => ["worker:primary", "worker:secondary"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string, profileId: string, origin = {}) =>
      store.enqueue(
        "alice",
        session.id,
        { profileId },
        "image",
        undefined,
        resource,
        undefined,
        origin,
      ).id;
    const where = (id: string) => store.job("alice", id)!;
    // Primary last ran krea; secondary is busy with kroma.
    const warm = enqueue("worker:primary", "krea");
    await queue.queue.tick();
    observations.set(warm, { status: "completed" });
    await queue.queue.tick();
    const busy = enqueue("worker:secondary", "kroma");
    await queue.queue.tick();
    const waiting = Array.from({ length: 5 }, (_, index) =>
      enqueue("worker:secondary", "kroma", mcp(`set-${index}`)),
    );
    // A manual job elsewhere does not keep the idle worker from background work.
    store.enqueue("alice", session.id, {}, "image", undefined, "cloud");
    queue.adapter.eligible = async (job) =>
      job.resource === "cloud" ? "Waiting for the provider." : undefined;
    await queue.queue.tick();
    assert.equal(where(waiting[0]).resource, "worker:primary");
    assert.deepEqual(submitted.slice(-1), [waiting[0]]);
    assert.equal(where(busy).resource, "worker:secondary");
    for (const id of waiting.slice(1)) assert.equal(where(id).status, "waiting");
  } finally {
    store.close();
  }
});

test("waiting work stays put rather than moving behind work of its tier on a freed worker", async () => {
  const queue = fixture();
  const { store, observations, submitted } = queue;
  queue.adapter.alternatives = () => ["worker:primary", "worker:secondary"];
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string, origin = {}) =>
      store.enqueue("alice", session.id, {}, "image", undefined, resource, undefined, origin).id;
    const busy = enqueue("worker:primary");
    await queue.queue.tick();
    // Secondary is free with its own job waiting, which it starts first.
    const theirs = enqueue("worker:secondary", mcp("b"));
    const mine = enqueue("worker:primary", mcp("a"));
    await queue.queue.tick();
    assert.deepEqual(submitted, [busy, theirs]);
    assert.equal(store.job("alice", mine)!.resource, "worker:primary");
    observations.set(busy, { status: "completed" });
    await queue.queue.tick();
    assert.deepEqual(submitted, [busy, theirs, mine]);
    assert.equal(store.job("alice", mine)!.resource, "worker:primary");
  } finally {
    store.close();
  }
});

test("work routed to a worker that can't take it moves to one that can, and Dream waits for it", async () => {
  const queue = fixture();
  const { store, submitted } = queue;
  // Primary isn't reachable: only secondary is ready.
  queue.adapter.alternatives = () => ["worker:secondary"];
  try {
    const session = store.createSession("alice");
    const dream = store.enqueue(
      "alice",
      session.id,
      { profileId: "krea" },
      "image",
      undefined,
      "worker:secondary",
      undefined,
      { priority: queuePriority.dream },
    ).id;
    const mine = store.enqueue(
      "alice",
      session.id,
      { profileId: "krea" },
      "image",
      undefined,
      "worker:primary",
    ).id;
    await queue.queue.tick();
    assert.equal(store.job("alice", mine)!.resource, "worker:secondary");
    assert.deepEqual(submitted, [mine]);
    assert.notEqual(store.job("alice", dream)!.status, "starting");
  } finally {
    store.close();
  }
});

test("a job is not observed while its submission is in flight, and a cancel then reaches it", async () => {
  const { store, queue, adapter, submitted } = fixture();
  const started = deferred();
  const release = deferred();
  const observed: string[] = [];
  const cancelled: string[] = [];
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image");
    adapter.submit = async (submittedJob) => {
      submitted.push(submittedJob.id);
      started.resolve();
      await release.promise;
      return { status: "running", providerJobId: "prompt-1" };
    };
    adapter.observe = async (observedJob) => {
      observed.push(observedJob.id);
      return { status: "running" };
    };
    adapter.cancel = async (cancelledJob) => {
      cancelled.push(cancelledJob.id);
    };
    const first = queue.tick();
    await started.promise;
    await queue.cancel("alice", job.id);
    await queue.tick();
    assert.deepEqual(observed, []);
    release.resolve();
    await first;
    assert.deepEqual(cancelled, [job.id, job.id]);
    await queue.tick();
    assert.deepEqual(observed, [job.id]);
  } finally {
    release.resolve();
    queue.stop();
    store.close();
  }
});

test("each resource's load names its running job and counts queued work and the model it last ran", async () => {
  const queue = fixture();
  const { store } = queue;
  try {
    const session = store.createSession("alice");
    const enqueue = (resource: string) =>
      store.enqueue("alice", session.id, { profileId: "flux" }, "image", undefined, resource).id;
    const running = enqueue("worker:primary");
    enqueue("worker:primary");
    await queue.queue.tick();
    assert.deepEqual(queue.queue.loads().get("worker:primary"), {
      busy: true,
      current: running,
      queued: 1,
      model: "flux",
    });
    assert.equal(queue.queue.loads().get("worker:video"), undefined);
    // A job a restart left running is its worker's current work before this process accepts it.
    const recovered = store.save({
      ...store.job("alice", enqueue("worker:secondary"))!,
      status: "running",
    });
    assert.equal(queue.queue.loads().get("worker:secondary")?.current, recovered.id);
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

test("queued work reusing the loaded model and LoRAs runs first within its tier, then its model alone", async () => {
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
    assert.deepEqual(queue.submitted, [first, reuse, withLora, other]);
  } finally {
    store.close();
  }
});

test("a worker with two slots fills them with one model before loading another", async () => {
  const { store, adapter, submitted, observations } = fixture();
  const queue = new GenerationQueue(store, { ...adapter, slots: () => 2 });
  try {
    const enqueue = loading(store, store.createSession("alice").id);
    const [first, other, same] = [enqueue("a"), enqueue("b"), enqueue("a")];
    await queue.tick();
    assert.deepEqual(submitted, [first, same]);
    observations.set(first, { status: "completed", outputs: [] });
    await queue.tick();
    assert.deepEqual(submitted, [first, same, other]);
  } finally {
    store.close();
  }
});

test("Radiance fills spare slots with the comparison's warm model and drains before switching", async () => {
  const { store, adapter, submitted, observations } = fixture();
  const queue = new GenerationQueue(store, {
    ...adapter,
    slots: () => 2,
    async slotWait(job, active) {
      if (active.some((other) => other.input.model !== job.input.model)) return "Finish first.";
    },
  });
  try {
    const enqueue = loading(store, store.createSession("alice").id);
    const comparison = { queueSet: "comparison" };
    const [first, other, same] = [
      enqueue("base", comparison),
      enqueue("klein", comparison),
      enqueue("base", comparison),
    ];
    await queue.tick();
    assert.deepEqual(submitted, [first, same]);
    observations.set(first, { status: "completed" });
    await queue.tick();
    assert.deepEqual(submitted, [first, same]);
    assert.equal(store.job("alice", other)?.reason, "Finish first.");
    observations.set(same, { status: "completed" });
    await queue.tick();
    assert.deepEqual(submitted, [first, same, other]);
  } finally {
    store.close();
  }
});

test("beside a running video, a worker's other slot takes only work for the video's model", async () => {
  const { store, adapter, submitted, observations } = fixture();
  const queue = new GenerationQueue(store, { ...adapter, slots: () => 2 });
  try {
    const session = store.createSession("alice").id;
    const enqueue = (input: Record<string, unknown>) =>
      store.enqueue("alice", session, input, "image", undefined, "worker:radiance").id;
    const video = enqueue({ model: "wan", kind: "video" });
    await queue.tick();
    const other = enqueue({ model: "flux" });
    await queue.tick();
    assert.deepEqual(submitted, [video]);
    assert.equal(
      store.job("alice", other)?.reason,
      "Waiting for the running video to finish before loading another model.",
    );
    const same = enqueue({ model: "wan" });
    await queue.tick();
    assert.deepEqual(submitted, [video, same]);
    observations.set(video, { status: "completed", outputs: [] });
    await queue.tick();
    assert.deepEqual(submitted, [video, same, other]);
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
    const waiting = enqueue(4, "waiting");
    // Started since the oldest waiting job of its tier, but older than the newest two of them.
    enqueue(5, "completed");
    enqueue(6, "cancelled");
    const newer = enqueue(7, "failed");
    const newest = enqueue(8, "completed");
    const otherTier = enqueue(9, "completed", mcp("b"));
    assert.deepEqual(
      store.schedulable(2).map((job) => job.id),
      [setDone, open, waiting, newer, newest, otherTier],
    );
  } finally {
    store.close();
  }
});

test("narrow reads: unfinished jobs and jobs since a time", () => {
  const store = new Store(openDatabase(":memory:"));
  try {
    const sessions = { alice: store.createSession("alice").id, bob: store.createSession("bob").id };
    const enqueue = (owner: "alice" | "bob", minute: number, status: string, cleared = false) => {
      const job = store.enqueue(owner, sessions[owner], {}, "image");
      store.save({ ...job, status: status as OwnedJob["status"], ...(cleared ? { cleared } : {}) });
      store.db
        .prepare("UPDATE studio_queue SET created_at = ? WHERE id = ?")
        .run(`2026-11-04T10:0${minute}:00.000Z`, job.id);
      return job.id;
    };
    enqueue("alice", 1, "completed");
    const waiting = enqueue("alice", 2, "waiting");
    const failed = enqueue("alice", 3, "failed");
    const cleared = enqueue("alice", 4, "failed", true);
    const running = enqueue("alice", 5, "running");
    const recent = enqueue("alice", 6, "cancelled");
    const bobs = enqueue("bob", 7, "queued");
    enqueue("bob", 8, "completed");
    const ids = (jobs: OwnedJob[]) => jobs.map((job) => job.id);
    assert.deepEqual(ids(store.openJobs()), [waiting, running, bobs]);
    assert.deepEqual(ids(store.openJobs("alice")), [waiting, running]);
    // Older than a day: only the unfinished and uncleared failed jobs still list.
    assert.deepEqual(ids(store.queueJobs("alice")), [waiting, failed, running]);
    assert.deepEqual(ids(store.jobsSince("alice", "2026-11-04T10:04:00.000Z")), [
      cleared,
      running,
      recent,
    ]);
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
    // The retry keeps the failed run's place in the gallery, however often it is retried.
    assert.equal(retry.galleryAt, failed.createdAt);
    await queue.tick();
    assert.equal(queue.retry("alice", retry.id)?.galleryAt, failed.createdAt);
    assert.equal(await queue.cancel("bob", retry.id), undefined);
  } finally {
    store.close();
  }
});

test("a manual retry and Radiance recovery share one durable replacement in either order", async (t) => {
  for (const automaticFirst of [false, true]) {
    await t.test(automaticFirst ? "recovery first" : "manual first", () => {
      const { store, queue, adapter, submitted } = fixture();
      try {
        const session = store.createSession("alice");
        const parent = store.enqueue("alice", session.id, {}, "image");
        const origin = {
          priority: automaticFirst ? queuePriority.dream : queuePriority.mcp,
          ...(automaticFirst
            ? { dream: { prompt: "A bird", why: "Explore birds", at: parent.createdAt } }
            : { queueSet: "set", queueBatch: "batch" }),
          parentItemId: "source-result",
          faceRedo: true as const,
        };
        const failed = store.save({
          ...store.enqueue(
            "alice",
            session.id,
            { prompt: "A bird" },
            "refine",
            parent.id,
            "worker:radiance",
            undefined,
            origin,
          ),
          status: "failed",
          reason: "Radiance: host memory cannot be pinned.",
          items: [{ createdAt: "2026-11-19T01:00:00.000Z" }],
        });
        const manual = () => queue.retry("alice", failed.id, true)!;
        const recover = () => queue.again(failed)!;
        const first = automaticFirst ? recover() : manual();
        assert.equal(store.job("alice", failed.id)?.cleared, automaticFirst ? undefined : true);
        const second = automaticFirst ? manual() : recover();
        assert.equal(second.id, first.id);
        assert.equal(second.retried, automaticFirst ? true : undefined);
        assert.equal(second.resource, "worker:radiance");
        assert.equal(second.sessionId, session.id);
        assert.equal(second.parentJobId, parent.id);
        assert.equal(second.galleryAt, failed.items[0].createdAt);
        assert.equal(second.input.clientJobId, second.id);
        for (const [key, value] of Object.entries(origin))
          assert.deepEqual(second[key as keyof OwnedJob], value, key);
        assert.equal(store.job("alice", failed.id)?.replacementJobId, second.id);
        assert.equal(store.job("alice", failed.id)?.cleared, true);

        const restored = new GenerationQueue(store, adapter);
        assert.equal(restored.retry("alice", failed.id, true)?.id, second.id);
        assert.equal(restored.again(failed)?.id, second.id);
        assert.deepEqual(
          store.openJobs("alice").map((job) => job.id),
          [parent.id, second.id],
        );
        assert.deepEqual(submitted, []);
      } finally {
        store.close();
      }
    });
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
    queue.stop();
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
    queue.stop();
    store.close();
  }
});

test("stopping while readiness is pending leaves the job queued for restart", async () => {
  const { store, queue, adapter, submitted } = fixture();
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
    queue.stop();
    ready.resolve();
    await tick;
    assert.deepEqual(submitted, []);
    assert.equal(store.job("alice", job.id)?.status, "queued");
  } finally {
    ready.resolve();
    store.close();
  }
});

test("stopping while a spare slot is checked skips worker admission", async () => {
  const { store, queue, adapter, submitted } = fixture();
  const checking = deferred();
  const ready = deferred();
  try {
    const session = store.createSession("alice");
    adapter.slots = () => 2;
    const first = store.enqueue("alice", session.id, {}, "image");
    await queue.tick();
    const next = store.enqueue("alice", session.id, {}, "image");
    adapter.slotWait = async () => {
      checking.resolve();
      await ready.promise;
      return undefined;
    };
    const eligibility = [] as string[];
    adapter.eligible = async (job) => {
      eligibility.push(job.id);
      return undefined;
    };
    const tick = queue.tick();
    await checking.promise;
    queue.stop();
    ready.resolve();
    await tick;
    assert.deepEqual(eligibility, []);
    assert.deepEqual(submitted, [first.id]);
    assert.equal(store.job("alice", next.id)?.status, "queued");
  } finally {
    ready.resolve();
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
    queue.stop();
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
    queue.stop();
    store.close();
  }
});

test("a writing failure fails the item with its reason, a discard sets it aside; cancelling stops the writing", async () => {
  const { store, adapter, submitted, events } = fixture();
  let aborted = false;
  const queue = new GenerationQueue(store, adapter, (job, { signal }) =>
    job.input.prompt === "fail"
      ? Promise.reject(new Error("unusable reply"))
      : job.input.prompt === "discard"
        ? Promise.reject(Object.assign(new Error("unusable idea"), { discard: true }))
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
    const discarded = store.enqueue("alice", session.id, { prompt: "discard", writing }, "animate");
    const cancelled = store.enqueue("alice", session.id, { prompt: "", writing }, "animate");
    await queue.tick();
    await queue.cancel("alice", cancelled.id);
    queue.stop();
    assert.equal(store.job("alice", failing.id)?.status, "failed");
    assert.equal(
      store.job("alice", failing.id)?.reason,
      "Writing the prompt failed: unusable reply",
    );
    assert.equal(store.job("alice", cancelled.id)?.status, "cancelled");
    // A writer's discard sets the job aside without failing it.
    assert.equal(store.job("alice", discarded.id)?.status, "cancelled");
    assert.ok(aborted);
    assert.deepEqual(submitted, []);
    assert.deepEqual(
      events.sort(),
      [`released:${cancelled.id}`, `released:${failing.id}`, `released:${discarded.id}`].sort(),
    );
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
    assert.equal(store.move("alice", [aMcp], 0), true);
    assert.equal(store.move("alice", [a1], 2), true);
    assert.equal(store.move("bob", [a2], 0), false);
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

test("a set's items move together in their order among the owner's other pending items", () => {
  const { store } = fixture();
  try {
    const session = store.createSession("alice");
    const enqueue = (origin = {}) =>
      store.enqueue("alice", session.id, {}, "image", undefined, undefined, undefined, origin).id;
    const [a, s1, b, s2] = [enqueue(), enqueue(mcp("s")), enqueue(), enqueue(mcp("s"))];
    assert.equal(store.move("alice", [s1, s2], 0), true);
    assert.deepEqual(
      store.jobs().map((job) => job.id),
      [s1, s2, a, b],
    );
    assert.equal(store.move("alice", [s2, s1], 1), true);
    assert.deepEqual(
      store.jobs().map((job) => job.id),
      [a, s1, s2, b],
    );
    assert.equal(store.move("alice", [s1, "missing"], 0), false);
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
      items: () => [],
      accountForOwner: () => ({ authenticated: true }),
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

test("The queue lists unfinished and failed work and only the latest finished jobs, keeping every record", () => {
  const store = new Store(openDatabase(":memory:"));
  const session = store.createSession("alice");
  const failed = store.save({
    ...store.enqueue("alice", session.id, {}, "image"),
    status: "failed",
  });
  const cleared = store.save({
    ...store.enqueue("alice", session.id, {}, "image"),
    status: "failed",
    cleared: true,
  });
  const finished = Array.from({ length: listedFinishedJobs + 5 }, () =>
    store.save({ ...store.enqueue("alice", session.id, {}, "image"), status: "completed" }),
  );
  const open = store.enqueue("alice", session.id, {}, "image");
  const listed = store.queueJobs("alice").map((job) => job.id);
  assert.equal(listed.length, listedFinishedJobs + 2);
  assert.deepEqual(listed.slice(0, 1), [failed.id]);
  assert.equal(listed.at(-1), open.id);
  assert.ok(!listed.includes(finished[0].id) && !listed.includes(cleared.id));
  assert.ok(listed.includes(finished.at(-1)!.id));
  assert.equal(store.job("alice", finished[0].id)?.id, finished[0].id);
});

test("Only someone's own unfinished work, not Dream's or finished work, counts as open", () => {
  const store = new Store(openDatabase(":memory:"));
  const session = store.createSession("alice");
  const queue = (priority: number) =>
    store.enqueue("alice", session.id, {}, "image", undefined, undefined, undefined, { priority });
  const dream = queue(queuePriority.dream);
  assert.equal(store.hasOpenOwnWork(), false);
  const own = queue(queuePriority.mcp);
  assert.equal(store.hasOpenOwnWork(true), true);
  // Waiting work a paused queue holds doesn't hold back Dream or idle work for others.
  store.setPaused("alice", true);
  assert.equal(store.hasOpenOwnWork(), false);
  store.setPaused("alice", false);
  store.setPaused(everyone, true);
  assert.equal(store.hasOpenOwnWork(true), false);
  store.setPaused(everyone, false);
  assert.deepEqual(
    store.openDreamJobs(undefined, true).map((job) => job.id),
    [dream.id],
  );
  store.save({ ...dream, status: "running" });
  store.save({ ...own, status: "running" });
  assert.equal(store.hasOpenOwnWork(), true);
  assert.equal(store.hasOpenOwnWork(true), false);
  assert.deepEqual(store.openDreamJobs(undefined, true), []);
  assert.deepEqual(
    store.openDreamJobs("alice").map((job) => job.id),
    [dream.id],
  );
  store.saveProviderRecord("alice", own.id, { outputs: [] });
  store.save({ ...own, status: "completed" });
  assert.equal(store.hasOpenOwnWork(), false);
  // A finished job's provider journal goes with it.
  assert.equal(store.providerRecord("alice", own.id), undefined);
});

test("Only a refusal marked permanent fails a generation for good", async () => {
  const answers = [
    { status: 409, payload: { error: "Radiance isn't ready." } },
    { status: 400, payload: { error: "Staging failed." } },
    { status: 403, payload: { permanent: true, error: "LoRAs are off for this account." } },
  ];
  const adapter = createGenerationQueueAdapter({
    submitGeneration: async () => answers.shift()!,
    jobs: new Map(),
    items: () => [],
    accountForOwner: () => ({ authenticated: true }),
    cancelPrompt: async () => undefined,
  });
  const job = { id: "j", ownerId: "alice" } as OwnedJob;
  assert.equal((await adapter.submit(job)).permanent, undefined);
  assert.equal((await adapter.submit(job)).permanent, undefined);
  assert.equal((await adapter.submit(job)).permanent, true);
});
