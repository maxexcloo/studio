import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GenerationQueue, type QueueAdapter } from "./queue.ts";
import { RewriteStore } from "./store.ts";
import { createUpscaleQueueAdapter, withUpscaleAdapter } from "./upscale-adapter.ts";

const finishedTasks = () => new Promise<void>((resolve) => setImmediate(resolve));

test("recorded upscale resumes its own prompt and blocks switching until the output is durably saved", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-upscale-queue-"));
  const filename = path.join(directory, "studio.sqlite");
  let store = new RewriteStore(filename);
  const session = store.createSession("alice", "Existing Session", {
    prompt: "Keep these generation settings",
  });
  const job = store.enqueue(
    "alice",
    session.id,
    { galleryItemId: "source" },
    "upscale",
    undefined,
    "worker:gpu",
  );
  const next = store.enqueue("alice", session.id, {}, "image", undefined, "worker:gpu");
  const source: Record<string, any> = { id: "source", ownerId: "alice", type: "image" };
  const submitted: string[] = [];
  const released: string[] = [];
  let durable = false;
  const other: QueueAdapter = {
    async submit(job) {
      submitted.push(job.id);
      return { status: "running" };
    },
    async observe() {
      return undefined;
    },
    async cancel() {},
    async saveOutputs() {},
  };
  function adapter(restarting: boolean) {
    return createUpscaleQueueAdapter({
      store,
      jobs: new Map(),
      itemFor: (owner, id) => (owner === source.ownerId && id === source.id ? source : undefined),
      async execute(recorded, callbacks) {
        if (!restarting) {
          callbacks.onSubmitting();
          callbacks.onAccepted("accepted-upscale");
          throw Object.assign(new Error("Worker offline"), { lostConnection: true });
        }
        assert.equal(recorded.providerJobId, "accepted-upscale");
        source.upscale = {
          jobId: recorded.id,
          status: "done",
          url: "/media/owned-upscale.png",
          width: 1280,
          height: 1280,
        };
      },
      async cancelPrompt() {
        throw new Error("No cancellation expected");
      },
      async flushGallery() {
        if (!durable) throw new Error("Disk full");
      },
      async settled(recorded) {
        released.push(recorded.id);
      },
    });
  }
  let queue = new GenerationQueue(store, withUpscaleAdapter(other, adapter(false)));
  try {
    await queue.tick();
    await finishedTasks();
    assert.equal(store.job("alice", job.id)!.providerJobId, "accepted-upscale");
    assert.deepEqual(submitted, []);
    await queue.stop();
    store.close();
    store = new RewriteStore(filename);
    queue = new GenerationQueue(store, withUpscaleAdapter(other, adapter(true)));
    await queue.tick();
    await finishedTasks();
    await queue.tick();
    assert.equal(store.job("alice", job.id)!.status, "saving");
    assert.match(store.job("alice", job.id)!.reason, /Disk full/);
    assert.deepEqual(submitted, []);
    assert.deepEqual(released, []);
    durable = true;
    await queue.tick();
    assert.equal(store.job("alice", job.id)!.status, "completed");
    assert.deepEqual(
      store.job("alice", job.id)!.outputs.map((output) => output.url),
      ["/media/owned-upscale.png"],
    );
    assert.deepEqual(released, [job.id]);
    assert.deepEqual(submitted, [next.id]);
  } finally {
    await queue.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("only the owner's accepted upscale is cancelled, and admission stays held until it is confirmed stopped", async () => {
  const store = new RewriteStore(":memory:");
  const session = store.createSession("alice", "Image", { prompt: "Original input" });
  const job = store.enqueue(
    "alice",
    session.id,
    { galleryItemId: "source" },
    "upscale",
    undefined,
    "worker:gpu",
  );
  assert.equal(store.session("alice", session.id)!.inputs.prompt, "Original input");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cancelled: string[] = [];
  const released: string[] = [];
  const adapter = createUpscaleQueueAdapter({
    store,
    jobs: new Map(),
    itemFor: (owner) => (owner === "alice" ? { type: "image" } : undefined),
    async execute(_recorded, callbacks) {
      callbacks.onSubmitting();
      callbacks.onAccepted("own-upscale-prompt");
      await finished;
      throw Object.assign(new Error("Prompt no longer queued"), { droppedRun: true });
    },
    async cancelPrompt(id, backend) {
      cancelled.push(`${backend}:${id}`);
    },
    async flushGallery() {},
    async settled(recorded) {
      released.push(recorded.id);
    },
  });
  const queue = new GenerationQueue(store, adapter);
  try {
    await queue.tick();
    assert.equal(await queue.cancel("bob", job.id), undefined);
    await queue.cancel("alice", job.id);
    assert.deepEqual(cancelled, ["gpu:own-upscale-prompt"]);
    await queue.tick();
    assert.equal(store.job("alice", job.id)!.status, "running");
    assert.deepEqual(released, []);
    finish();
    await finishedTasks();
    await queue.tick();
    assert.equal(store.job("alice", job.id)!.status, "cancelled");
    assert.deepEqual(released, [job.id]);
  } finally {
    finish();
    await queue.stop();
    store.close();
  }
});

test("an explicitly refused upscale can retry, while a lost acknowledgement is never submitted twice", async () => {
  const store = new RewriteStore(":memory:");
  const session = store.createSession("alice");
  const job = store.enqueue(
    "alice",
    session.id,
    { galleryItemId: "source" },
    "upscale",
    undefined,
    "worker:gpu",
  );
  const submitted: string[] = [];
  const adapter = createUpscaleQueueAdapter({
    store,
    jobs: new Map(),
    itemFor: () => ({ type: "image" }),
    async execute(recorded, callbacks) {
      submitted.push(recorded.id);
      callbacks.onSubmitting();
      if (submitted.length === 1)
        throw Object.assign(new Error("Invalid graph"), { providerRejected: true });
      throw new Error("Connection interrupted before acknowledgement");
    },
    async cancelPrompt() {
      throw new Error("No accepted prompt ID was recorded");
    },
    async flushGallery() {},
  });
  const queue = new GenerationQueue(store, adapter);
  try {
    await queue.tick();
    await finishedTasks();
    await queue.tick();
    assert.equal(store.job("alice", job.id)!.status, "failed");
    const retry = queue.retry("alice", job.id)!;
    assert.notEqual(retry.id, job.id);
    await queue.tick();
    await finishedTasks();
    await queue.tick();
    await queue.tick();
    assert.equal(store.job("alice", retry.id)!.status, "running");
    assert.match(store.job("alice", retry.id)!.reason, /acknowledgement/);
    assert.deepEqual(submitted, [job.id, retry.id]);
    await queue.cancel("alice", retry.id);
    assert.equal(store.job("alice", retry.id)!.status, "running");
  } finally {
    await queue.stop();
    store.close();
  }
});
