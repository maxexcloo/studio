import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../persistence/runtime.ts";
import { createGenerationAdmission } from "./admission.ts";
import type { GenerationQueue } from "./queue.ts";
import { Store } from "./store.ts";

test("a profile that can't batch queues Count as separate seeded runs in one set", async () => {
  const store = new Store(openDatabase(":memory:"));
  const admit = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async () => ({ status: 200, payload: { ok: true } }),
    resourceFor: async () => "local-media",
    pendingItems: () => [],
    revision: () => 0,
    separateRuns: (input) => input.profileId === "single",
  });
  const run = async (profileId: string, seed: string) => {
    const done = await admit({ kind: "image", prompt: "p", profileId, count: 3, seed } as never, {
      userId: "alice",
      role: "user",
    });
    return store.jobs("alice").filter((job) => job.sessionId === done.payload.sessionId);
  };
  const split = await run("single", "10");
  assert.deepEqual(split.map((job) => [job.input.count, job.input.seed]).sort(), [
    [1, "10"],
    [1, "11"],
    [1, "12"],
  ]);
  assert.equal(new Set(split.map((job) => job.queueSet)).size, 1);
  assert.ok(split[0].queueSet);
  const random = await run("single", "");
  assert.deepEqual(
    random.map((job) => job.input.seed),
    ["", "", ""],
  );
  const batched = await run("batch", "10");
  assert.deepEqual(
    batched.map((job) => job.input.count),
    [3],
  );
});

test("a Count whose derived ID is taken queues nothing, then and on retry", async () => {
  const store = new Store(openDatabase(":memory:"));
  const admit = createGenerationAdmission({
    store,
    queue: { tick: async () => undefined } as unknown as GenerationQueue,
    validate: async () => ({ status: 200, payload: { ok: true } }),
    resourceFor: async () => "local-media",
    pendingItems: () => [],
    revision: () => 0,
    separateRuns: () => true,
  });
  store.enqueue("bob", store.createSession("bob").id, {}, "image", undefined, undefined, "run-2");
  const request = (clientJobId: string) =>
    admit({ kind: "image", prompt: "p", count: 3, clientJobId } as never, {
      userId: "alice",
      role: "user",
    });
  assert.equal((await request("run")).status, 409);
  assert.deepEqual(store.jobs("alice"), []);
  assert.deepEqual(store.sessions("alice"), []);
  assert.equal((await request("run")).status, 409);
  assert.deepEqual(store.jobs("alice"), []);
  assert.equal((await request("other")).status, 200);
  assert.deepEqual(
    store.jobs("alice").map((job) => job.id),
    ["other", "other-2", "other-3"],
  );
});
