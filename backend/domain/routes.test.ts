import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type { QueueCancelAllResponse } from "../../shared/queue.ts";
import { GenerationQueue, type JobObservation } from "./queue.ts";
import { registerRewriteRoutes } from "./routes.ts";
import { RewriteStore } from "./store.ts";
const { enforceMultiUserRequest } = await import(
  new URL("../multi-user-gate.js", import.meta.url).href
);

test("Cancel All isolates the owner and retains accepted work until cancellation or durable saving is confirmed", async () => {
  const store = new RewriteStore(":memory:");
  const alice = store.createSession("alice"),
    bob = store.createSession("bob");
  const pending = store.enqueue("alice", alice.id, {}, "image");
  const running = store.enqueue("alice", alice.id, {}, "image", undefined, "running");
  const saving = store.enqueue("alice", alice.id, {}, "image", undefined, "saving");
  const foreign = store.enqueue("bob", bob.id, {}, "image", undefined, "foreign");
  const completed = store.enqueue("alice", alice.id, {}, "image");
  store.save({ ...completed, status: "completed" });
  for (const job of [running, saving, foreign])
    store.save({
      ...job,
      status: job.id === saving.id ? "saving" : "running",
      providerJobId: `provider-${job.id}`,
    });
  const cancelled: string[] = [],
    released: string[] = [];
  const observations = new Map<string, JobObservation>([
    [saving.id, { status: "completed", outputs: [{ url: "/media/saved.png" }] }],
  ]);
  let writable = false;
  const queue = new GenerationQueue(store, {
    async submit() {
      throw new Error("Only pending cancellation should be needed.");
    },
    async observe(job) {
      return observations.get(job.id);
    },
    async cancel(job) {
      cancelled.push(job.id);
      if (job.id === saving.id) throw new Error("Provider cancellation unavailable");
      observations.set(job.id, { status: "cancelled" });
    },
    async saveOutputs() {
      if (!writable) throw new Error("Disk full");
    },
    async settled(job) {
      released.push(job.id);
    },
  });
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  app.use((req, res, next) =>
    enforceMultiUserRequest(req, res, next, {
      accountForRequest: () => ({ userId: "alice", role: "user" }),
    }),
  );
  registerRewriteRoutes(app as unknown as Parameters<typeof registerRewriteRoutes>[0], {
    store,
    queue,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue/cancel-all`,
      { method: "POST" },
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as QueueCancelAllResponse;
    assert.deepEqual(
      result.outcomes.map((outcome) => outcome.job.id),
      [pending.id, running.id, saving.id],
    );
    assert.equal(result.outcomes[0].job.status, "cancelled");
    assert.equal(result.outcomes[1].job.status, "running");
    assert.equal(result.outcomes[1].cancelRequested, true);
    assert.equal(result.outcomes[2].job.status, "saving");
    assert.equal(result.outcomes[2].cancelRequested, true);
    assert.match(result.outcomes[2].error || "", /could not be confirmed/);
    assert.deepEqual(cancelled, [running.id, saving.id]);
    assert.equal(store.job("bob", foreign.id)?.cancelRequested, undefined);
    await queue.tick();
    assert.equal(store.job("alice", running.id)?.status, "cancelled");
    assert.equal(store.job("alice", saving.id)?.status, "saving");
    assert.equal(released.includes(saving.id), false);
    writable = true;
    await queue.tick();
    assert.equal(store.job("alice", saving.id)?.status, "completed");
    assert.equal(released.includes(saving.id), true);
    assert.equal(store.job("bob", foreign.id)?.status, "running");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queue.stop();
    store.close();
  }
});
