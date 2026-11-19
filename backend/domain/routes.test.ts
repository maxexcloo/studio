import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import type {
  QueueCancelAllResponse,
  QueueResponse,
  QueueRetryResponse,
  QueueStatus,
  UnfinishedJob,
} from "../../shared/queue.ts";
import { openDatabase } from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import { GenerationQueue, type JobObservation } from "./queue.ts";
import { registerMaintenanceRoutes, registerQueueRoutes } from "./routes.ts";
import { Store, everyone, listedFinishedJobs } from "./store.ts";
const { enforceMultiUserRequest } = await import(
  new URL("../multi-user-gate.js", import.meta.url).href
);

/** What a test that sends no generations gives the routes. */
const unused = {
  admit: async () => ({ status: 500, payload: { error: "Not in this test." } }),
  media: () => [],
  ownsItem: () => false,
};

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
  registerQueueRoutes(app, { store, queue, ...unused });
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
    queue.stop();
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
  registerQueueRoutes(app, { store, queue: new GenerationQueue(store, {} as never), ...unused });
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

test("Retry admits distinct owned failures in order and leaves refused jobs available", async (t) => {
  const store = new Store(openDatabase(":memory:"));
  const alice = store.createSession("alice");
  const bob = store.createSession("bob");
  const failed = (id: string, owner = "alice", session = alice.id) =>
    store.save({
      ...store.enqueue(owner, session, { prompt: id }, "image", undefined, undefined, id),
      status: "failed",
    });
  const first = failed("first");
  const second = failed("second");
  const blocked = failed("blocked");
  const foreign = failed("foreign", "bob", bob.id);
  const waiting = store.enqueue("alice", alice.id, {}, "image");
  store.db.exec(`
    CREATE TRIGGER refuse_retry BEFORE UPDATE ON studio_queue WHEN OLD.id = 'blocked'
    BEGIN SELECT RAISE(ABORT, 'Cannot update blocked job'); END;
  `);
  const queue = new GenerationQueue(store, {} as never);
  const tick = t.mock.method(queue, "tick", async () => {});
  const removeRetryTiles = t.mock.fn();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const account = { userId: "alice", role: "user" };
    Object.assign(req, { studioAccount: account });
    enforceMultiUserRequest(req, res, next, { accountForRequest: () => account });
  });
  registerQueueRoutes(app, { store, queue, ...unused, removeRetryTiles });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  const request = (path: string, body = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const retry = async (ids: string[]) => {
    const response = await request("/retry", { ids });
    assert.equal(response.status, 202);
    return ((await response.json()) as QueueRetryResponse).outcomes;
  };
  try {
    const outcomes = await retry([
      second.id,
      blocked.id,
      second.id,
      foreign.id,
      first.id,
      waiting.id,
    ]);
    const [, nextSecond, nextFirst] = store.openJobs("alice");
    assert.deepEqual(
      store.openJobs("alice").map((job) => job.id),
      [waiting.id, nextSecond.id, nextFirst.id],
    );
    assert.deepEqual(outcomes, [
      { id: second.id, replacement: nextSecond.id },
      { id: blocked.id, error: "Could not queue the retry." },
      { id: foreign.id, error: "Only your failed generations can be retried." },
      { id: first.id, replacement: nextFirst.id },
      { id: waiting.id, error: "Only your failed generations can be retried." },
    ]);
    assert.equal(nextSecond.input.prompt, second.input.prompt);
    assert.equal(nextFirst.galleryAt, first.createdAt);
    assert.equal(tick.mock.callCount(), 1);
    assert.deepEqual(removeRetryTiles.mock.calls[0].arguments, [
      "alice",
      new Set([second.id, first.id]),
    ]);
    assert.equal(store.job("alice", first.id)?.cleared, true);
    assert.equal(store.job("alice", blocked.id)?.cleared, undefined);
    assert.equal(store.job("bob", foreign.id)?.cleared, undefined);

    store.db.exec("DROP TRIGGER refuse_retry");
    const [batch, overlap, single] = await Promise.all([
      retry([blocked.id, first.id]),
      retry([blocked.id, second.id]),
      request(`/${first.id}/retry`),
    ]);
    assert.deepEqual(batch[0], overlap[0]);
    assert.deepEqual(batch[1], outcomes[3]);
    assert.deepEqual(overlap[1], outcomes[0]);
    assert.equal((await single.json()).job.id, nextFirst.id);
    assert.equal(store.openJobs("alice").length, 4);
    assert.equal(store.job("alice", blocked.id)?.cleared, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    queue.stop();
    store.close();
  }
});

test("Clear Failed Set clears only the owner's failed members of an all-failed set", async () => {
  const store = new Store(openDatabase(":memory:"));
  const alice = store.createSession("alice");
  const bob = store.createSession("bob");
  const result = { id: "failed-tile", status: "failed" };
  const member = (ownerId: string, sessionId: string, queueSet: string, status: QueueStatus) => {
    const job = store.enqueue(ownerId, sessionId, {}, "image", undefined, undefined, undefined, {
      queueSet,
    });
    return store.save({ ...job, status, items: [result] });
  };
  const oldCompleted = member("alice", alice.id, "mixed", "completed");
  for (let index = 0; index < listedFinishedJobs; index++)
    member("alice", alice.id, "older-history", "completed");
  const mixed = member("alice", alice.id, "mixed", "failed");
  const activeFailed = member("alice", alice.id, "active", "failed");
  member("alice", alice.id, "active", "running");
  const [first, second, cancelled] = [
    member("alice", alice.id, "set", "failed"),
    member("alice", alice.id, "set", "failed"),
    member("alice", alice.id, "set", "cancelled"),
  ];
  const foreign = member("bob", bob.id, "set", "failed");
  const foreignOnly = member("bob", bob.id, "foreign-only", "failed");
  const account = { userId: "alice", role: "user" };
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: account });
    next();
  });
  app.use((req, res, next) =>
    enforceMultiUserRequest(req, res, next, { accountForRequest: () => account }),
  );
  registerQueueRoutes(app, { store, queue: new GenerationQueue(store, {} as never), ...unused });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  const listed = async (query = "") => (await (await fetch(base + query)).json()) as QueueResponse;
  const clearSet = (set: string) => fetch(`${base}/sets/${set}/clear-failed`, { method: "POST" });
  try {
    const { jobs, clearableFailedSets } = await listed();
    assert.ok(!jobs.some((job) => job.id === oldCompleted.id));
    assert.deepEqual(clearableFailedSets, ["set"]);
    assert.deepEqual((await listed("?since=2099-01-01")).clearableFailedSets, ["set"]);
    assert.equal((await clearSet("mixed")).status, 409);
    assert.equal((await clearSet("active")).status, 409);
    assert.equal((await clearSet("foreign-only")).status, 409);
    assert.equal((await fetch(`${base}/sets/set/delete`, { method: "POST" })).status, 403);
    const success = await clearSet("set");
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { cleared: 2 });
    assert.deepEqual((await listed()).clearableFailedSets, []);
    assert.deepEqual(
      (await listed()).jobs.filter((job) => job.status === "failed").map(({ id }) => id),
      [mixed.id, activeFailed.id],
    );
    for (const { ownerId, id } of [first, second]) {
      const saved = store.job(ownerId, id);
      assert.equal(saved?.status, "failed");
      assert.equal(saved.cleared, true);
      assert.deepEqual(saved.items, [result]);
    }
    for (const { ownerId, id } of [cancelled, foreign, foreignOnly, mixed])
      assert.equal(store.job(ownerId, id)?.cleared, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("The queue hydrates full and changed results and logs one aggregate poll profile", async (t) => {
  const store = new Store(openDatabase(":memory:"));
  const session = store.createSession("alice");
  const own = { id: "own", url: "/media/own.png" };
  const [saved, bare] = [0, 1].map(() =>
    store.save({
      ...store.enqueue("alice", session.id, {}, "image"),
      status: "completed",
      items: [own],
      outputs: [own],
    }),
  );
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  const record = { id: "record", url: "/media/record.png", prompt: "a fox" };
  registerQueueRoutes(app, {
    store,
    queue: new GenerationQueue(store, {} as never),
    ...unused,
    media: (_ownerId, jobId) => (jobId === saved.id ? [record] : []),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  try {
    const log = t.mock.method(console, "log", () => {});
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { jobs } = (await (await fetch(base)).json()) as QueueResponse;
    const shown = new Map(jobs.map((job) => [job.id, job]));
    assert.deepEqual(shown.get(saved.id)?.items, [record]);
    assert.deepEqual(shown.get(saved.id)?.outputs, []);
    assert.deepEqual(shown.get(bare.id)?.items, [own]);
    const delta = (await (await fetch(`${base}?since=2099-01-01`)).json()) as QueueResponse;
    assert.deepEqual(delta.jobs, []);
    assert.deepEqual(
      delta.ids,
      jobs.map((job) => job.id),
    );

    assert.equal(log.mock.callCount(), 0);
    t.mock.timers.tick(60_000);
    assert.equal(log.mock.callCount(), 1);
    const line = String(log.mock.calls[0].arguments[0]);
    const prefix = "Queue poll profile ";
    assert.ok(line.includes(prefix));
    const data = JSON.parse(line.split(prefix)[1]);
    const { requests, deltaRequests, listedJobs, returnedJobs, slowest, ...timings } = data;
    assert.deepEqual(
      { requests, deltaRequests, listedJobs, returnedJobs },
      {
        requests: 2,
        deltaRequests: 1,
        listedJobs: 4,
        returnedJobs: 2,
      },
    );
    assert.deepEqual(Object.keys(timings), ["totalListMs", "totalHydrateMs", "totalJsonSendMs"]);
    assert.deepEqual(Object.keys(slowest), ["totalMs", "listMs", "hydrateMs", "jsonSendMs"]);
    assert.ok(
      [...Object.values(timings), ...Object.values(slowest)].every(
        (value) => Number.isFinite(value) && Number(value) >= 0,
      ),
    );
    t.mock.timers.tick(60_000);
    assert.equal(log.mock.callCount(), 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("A queue delta updates positions of unchanged rows without listing other accounts' jobs", async (t) => {
  const store = new Store(openDatabase(":memory:"));
  t.after(() => store.close());
  const enqueue = (owner: string) =>
    store.enqueue(owner, store.createSession(owner).id, {}, "image");
  const first = enqueue("bob");
  const second = enqueue("alice");
  const queue = new GenerationQueue(store, {
    eligible: async () => "Waiting for the worker.",
  } as never);
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { studioAccount: { userId: "alice" } });
    next();
  });
  registerQueueRoutes(app, { store, queue, ...unused });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
  const get = async (suffix = "") => (await (await fetch(base + suffix)).json()) as QueueResponse;
  await queue.tick();
  const full = await get();
  assert.deepEqual(full.queuePositions, { [second.id]: 2 });
  assert.deepEqual(full.queueOrder, [second.id]);
  await queue.cancel("bob", first.id);
  await queue.tick();
  const delta = await get("?since=2099-01-01");
  assert.deepEqual(delta.jobs, []);
  assert.deepEqual(delta.queuePositions, { [second.id]: 1 });
  assert.deepEqual(delta.queueOrder, [second.id]);
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
  registerQueueRoutes(app, {
    store,
    queue,
    media: unused.media,
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

test("Unfinished Items puts working jobs first, keeps queue order and lets administrators end stuck jobs", async (t) => {
  const store = new Store(openDatabase(":memory:"));
  const alice = store.createSession("alice"),
    bob = store.createSession("bob");
  const awaitingPrompt = store.enqueue(
    "alice",
    alice.id,
    { prompt: "awaiting a prompt", writing: { kind: "animate" } },
    "animate",
  );
  const queued = store.enqueue("bob", bob.id, { prompt: "a hare" }, "image");
  // Accepted by a worker that is gone: nothing observes it and cancelling never confirms.
  const stuck = store.save({
    ...store.enqueue("alice", alice.id, { prompt: "a fox" }, "image", undefined, "gone"),
    status: "running",
    providerJobId: "lost",
  });
  const waiting = store.save({
    ...store.enqueue("bob", bob.id, { prompt: "an owl" }, "image"),
    status: "waiting",
  });
  assert.equal(store.move("bob", [waiting.id], 0), true);
  const writing = store.enqueue(
    "alice",
    alice.id,
    { prompt: "writing a prompt", writing: { kind: "animate" } },
    "animate",
  );
  const done = store.save({ ...store.enqueue("bob", bob.id, {}, "image"), status: "completed" });
  const settled: string[] = [];
  const queue = new GenerationQueue(store, {
    observe: async () => undefined,
    cancel: async () => undefined,
    settled: async (job: { id: string }) => void settled.push(job.id),
  } as never);
  t.mock.method(queue, "isWriting", (id: string) => id === writing.id);
  t.mock.method(queue, "queuePosition", (id: string) =>
    id === queued.id ? 1 : id === waiting.id ? 2 : undefined,
  );
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
    assert.deepEqual(await listed(), [
      ["alice", "a fox", "running"],
      ["alice", "writing a prompt", "writing"],
      ["bob", "a hare", "queued"],
      ["bob", "an owl", "waiting"],
      ["alice", "awaiting a prompt", "writing"],
    ]);
    for (const job of [waiting, writing, awaitingPrompt])
      store.save({ ...job, status: "cancelled" });
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
    queue.stop();
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
  registerQueueRoutes(app, { store, queue: new GenerationQueue(store, {} as never), ...unused });
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
