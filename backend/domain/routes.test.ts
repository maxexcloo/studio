import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import type { QueueCancelAllResponse, UnfinishedJob } from "../../shared/queue.ts";
import { openDatabase } from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import { GenerationQueue, type JobObservation } from "./queue.ts";
import { registerMaintenanceRoutes, registerRewriteRoutes } from "./routes.ts";
import { Store, everyone } from "./store.ts";
const { enforceMultiUserRequest } = await import(
  new URL("../multi-user-gate.js", import.meta.url).href
);

test("Cancel All isolates the owner and retains accepted work until cancellation or durable saving is confirmed", async () => {
  const store = new Store(openDatabase(":memory:"));
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

test("Clearing takes only the owner's failed jobs out of the queue and keeps their records", async () => {
  const store = new Store(openDatabase(":memory:"));
  const alice = store.createSession("alice"),
    bob = store.createSession("bob");
  const [first, second, active] = [0, 1, 2].map(() =>
    store.enqueue("alice", alice.id, {}, "image"),
  );
  const foreign = store.enqueue("bob", bob.id, {}, "image");
  for (const job of [first, second, foreign]) store.save({ ...job, status: "failed" });
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  registerRewriteRoutes(app as unknown as Parameters<typeof registerRewriteRoutes>[0], {
    store,
    queue: new GenerationQueue(store, {} as never),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  const listed = async () =>
    ((await (await fetch(base)).json()) as { jobs: { id: string }[] }).jobs.map((job) => job.id);
  try {
    assert.equal((await fetch(`${base}/${active.id}/clear`, { method: "POST" })).status, 409);
    assert.equal((await fetch(`${base}/${first.id}/clear`, { method: "POST" })).status, 200);
    assert.deepEqual(await listed(), [second.id, active.id]);
    const response = await fetch(`${base}/clear-failed`, { method: "POST" });
    assert.deepEqual(await response.json(), { cleared: 1 });
    assert.deepEqual(await listed(), [active.id]);
    assert.equal(store.job("alice", first.id)?.status, "failed");
    assert.equal(store.job("bob", foreign.id)?.cleared, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("A run from an item records it as its source, only when the item is the owner's", async () => {
  const store = new Store(openDatabase(":memory:"));
  const session = store.createSession("alice");
  const items = new Map([
    ["/media/alice.png", "alice"],
    ["/media/bob.png", "bob"],
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  const queue = new GenerationQueue(store, {} as never);
  registerRewriteRoutes(app as unknown as Parameters<typeof registerRewriteRoutes>[0], {
    store,
    queue,
    admit: createGenerationAdmission({
      store,
      queue,
      validate: async () => ({ status: 200, payload: { ok: true } }),
      resourceFor: async () => "local-media",
      pendingItems: () => [],
      revision: () => 0,
    }),
    ownsItem: (ownerId, id) => items.get(id) === ownerId,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const run = (parentItemId: string, input: Record<string, unknown> = { prompt: "Again" }) =>
    fetch(`${base}/sessions/${session.id}/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, parentItemId }),
    });
  try {
    // Made outside the item's session, so with no parent run: the item alone is its source.
    const response = await run("/media/alice.png");
    assert.equal(response.status, 202);
    const { jobId } = (await response.json()) as { jobId: string };
    assert.equal(store.job("alice", jobId)?.parentItemId, "/media/alice.png");
    assert.equal(store.job("alice", jobId)?.parentJobId, undefined);
    assert.equal((await run("/media/bob.png")).status, 400);
    assert.equal(store.jobs("alice").length, 1);
    // The viewer reruns with the recorded input and a new prompt: that queues a new run.
    const { job } = (await (await fetch(`${base}/queue/${jobId}`)).json()) as {
      job: { input: Record<string, unknown> };
    };
    const rerun = await run("/media/alice.png", { ...job.input, prompt: "Warm low sunlight" });
    const { jobId: rerunId } = (await rerun.json()) as { jobId: string };
    assert.notEqual(rerunId, jobId);
    assert.equal(store.job("alice", rerunId)?.input.prompt, "Warm low sunlight");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("Unfinished Items lists every account's unfinished jobs and ends stuck ones for administrators", async () => {
  const store = new Store(openDatabase(":memory:"));
  const alice = store.createSession("alice"),
    bob = store.createSession("bob");
  // Accepted by a worker that is gone: nothing observes it and cancelling never confirms.
  const stuck = store.save({
    ...store.enqueue("alice", alice.id, { prompt: "a fox" }, "image", undefined, "gone"),
    status: "running",
    providerJobId: "lost",
  });
  const queued = store.enqueue("bob", bob.id, { prompt: "a hare" }, "image");
  const done = store.save({ ...store.enqueue("bob", bob.id, {}, "image"), status: "completed" });
  const settled: string[] = [];
  const queue = new GenerationQueue(store, {
    observe: async () => undefined,
    cancel: async () => undefined,
    settled: async (job: { id: string }) => void settled.push(job.id),
  } as never);
  let admin = false;
  const app = express();
  app.use(express.json());
  registerMaintenanceRoutes(app as unknown as Parameters<typeof registerMaintenanceRoutes>[0], {
    store,
    queue,
    adminRefusal: () => (admin ? null : { status: 403, payload: { error: "Admins only." } }),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/maintenance/unfinished`;
  const listed = async () =>
    ((await (await fetch(base)).json()) as { jobs: UnfinishedJob[] }).jobs.map((job) => [
      job.ownerId,
      job.input.prompt,
      job.status,
    ]);
  const act = (action: string, job: { ownerId: string; id: string }) =>
    fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: job.ownerId, id: job.id }),
    });
  try {
    assert.equal((await fetch(base)).status, 403);
    // Only administrators pause everyone's queue.
    const pauseAll = () =>
      fetch(base.replace("maintenance/unfinished", "queue/pause-all"), { method: "POST" });
    assert.equal((await pauseAll()).status, 403);
    assert.equal(store.pauses().size, 0);
    admin = true;
    assert.equal((await pauseAll()).status, 200);
    assert.deepEqual([...store.pauses()], [everyone]);
    store.setPaused(everyone, false);
    assert.deepEqual(await listed(), [
      ["alice", "a fox", "running"],
      ["bob", "a hare", "queued"],
    ]);

    assert.equal((await act("retry", stuck)).status, 202);
    assert.equal(
      store.job("alice", stuck.id)?.status,
      "cancelled",
      "ended despite no confirmation",
    );
    assert.deepEqual(settled, [stuck.id], "its gallery tiles and leases are released");
    assert.equal((await act("delete", queued)).status, 200);
    assert.equal(store.job("bob", queued.id)?.status, "cancelled");
    assert.deepEqual(
      (await listed()).map(([owner, prompt]) => [owner, prompt]),
      [["alice", "a fox"]],
      "the retry is queued afresh",
    );
    assert.equal(store.job("bob", done.id)?.status, "completed");

    // Every listed job at once, each once however often it is named.
    const bulk = (action: string, jobs: { ownerId: string; id: string }[]) =>
      fetch(`${base}/${action}-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: jobs.map(({ ownerId, id }) => ({ ownerId, id })) }),
      });
    const retried = store.openJobs()[0];
    const response = await bulk("retry", [retried, retried]);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { retried: 1 });
    assert.equal(store.openJobs().length, 1, "one retry for a job named twice");
    const hare = store.enqueue("bob", bob.id, { prompt: "a hare" }, "image");
    assert.equal((await bulk("cancel", store.openJobs())).status, 200);
    assert.equal(store.job("bob", hare.id)?.status, "cancelled");
    const owl = store.enqueue("bob", bob.id, { prompt: "an owl" }, "image");
    assert.equal((await bulk("delete", [owl])).status, 200);
    assert.equal(store.job("bob", owl.id)?.cleared, true);
    admin = false;
    assert.equal((await bulk("retry", [owl])).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queue.stop();
    store.close();
  }
});

test("The queue polled since a change sends only the jobs changed since then, with every listed ID", async () => {
  const store = new Store(openDatabase(":memory:"));
  const session = store.createSession("alice");
  const [done, running] = [0, 1].map(() => store.enqueue("alice", session.id, {}, "image"));
  store.save({ ...done, status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const changed = store.save({ ...running, status: "running" });
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  registerRewriteRoutes(app as unknown as Parameters<typeof registerRewriteRoutes>[0], {
    store,
    queue: new GenerationQueue(store, {} as never),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  try {
    const all = await (await fetch(base)).json();
    assert.deepEqual(
      all.jobs.map((job: { id: string }) => job.id),
      [done.id, running.id],
    );
    assert.equal(all.ids, undefined);
    const since = await (await fetch(`${base}?since=${changed.updatedAt}`)).json();
    assert.deepEqual(
      since.jobs.map((job: { id: string }) => job.id),
      [running.id],
    );
    assert.deepEqual(since.ids, [done.id, running.id]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
