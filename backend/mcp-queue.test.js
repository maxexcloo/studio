// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenerationAdmission } from "./domain/admission.ts";
import { GenerationQueue } from "./domain/queue.ts";
import { RewriteStore } from "./domain/store.ts";
import { McpMedia } from "./mcp-media.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(t, beforeAcknowledgement) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-mcp-sets-"));
  const filename = path.join(dir, "studio.sqlite");
  let store = new RewriteStore(filename);
  let queue = new GenerationQueue(store, {
    async submit() {
      throw new Error("Admission must not execute work in this fixture");
    },
    async observe() {},
    async cancel() {},
    async saveOutputs() {},
  });
  await queue.stop();
  t.after(async () => {
    await queue.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const admit = createGenerationAdmission({
    store,
    queue,
    async validate() {
      return { status: 200, payload: {} };
    },
    async resourceFor() {
      return "gpu:chosen";
    },
    pendingItems() {
      return [];
    },
    revision() {
      return 0;
    },
    jobLimit: 100,
  });
  const requests = [];
  const prepared = new Set();
  const allPrepared = deferred();
  const media = new McpMedia({
    dataDir: dir,
    baseUrl: "http://127.0.0.1:8790",
    publicUrl: "https://studio.example.test",
    async domainRequest(method, route, body, owner) {
      if (method === "GET" && route === "/api/models?cached=1") {
        prepared.add(owner);
        if (prepared.size === 3) allPrepared.resolve();
        return {
          status: 200,
          payload: {
            profiles: [
              {
                id: "chosen",
                kind: "image",
                model: "exact-model",
                workflow: "family:flux",
                defaults: { width: 512, height: 512 },
              },
            ],
          },
        };
      }
      assert.equal(method, "POST");
      assert.equal(route, "/api/generate");
      requests.push({ owner, body });
      const refusal = await beforeAcknowledgement?.(requests.length, body, owner);
      if (refusal) return refusal;
      const account = { userId: owner, role: "user" };
      const response = await admit(body, account);
      // The same recorded client id must remain idempotent through real domain admission.
      assert.deepEqual(await admit(body, account), response);
      return response;
    },
  });
  return {
    media,
    requests,
    allPrepared,
    jobs: () => store.jobs(),
    async execute({ failFirst = false, firstStarted, releaseFirst } = {}) {
      store.close();
      store = new RewriteStore(filename);
      const executed = [];
      const saved = [];
      queue = new GenerationQueue(store, {
        async submit(job) {
          executed.push({ owner: job.ownerId, prompt: job.input.prompt, seed: job.input.seed });
          if (executed.length === 1 && firstStarted) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          return failFirst && executed.length === 1
            ? { status: "failed", reason: "Provider rejected the first accepted job" }
            : { status: "completed", outputs: [{ url: `/media/${job.id}.png` }] };
        },
        async observe() {},
        async cancel() {},
        async saveOutputs(job) {
          saved.push(job.id);
        },
      });
      const tick = queue.tick();
      return { executed, saved, tick };
    },
  };
}

const args = (prompt) => ({ profile_id: "chosen", prompts: [prompt], count: 2, seed: 10 });

test("parallel MCP sets persist and execute as whole FIFO sets across restart while preparation stays concurrent", async (t) => {
  const entered = deferred();
  const acknowledge = deferred();
  const f = await fixture(t, async (index) => {
    if (index === 1) {
      entered.resolve();
      await acknowledge.promise;
    }
  });
  const a = f.media.queue("alice", args("A"));
  await entered.promise;
  const b = f.media.queue("bob", args("B"));
  const c = f.media.queue("carol", args("C"));
  await f.allPrepared.promise;
  assert.equal(f.requests.length, 1, "other sets prepare but cannot interleave acknowledgements");
  acknowledge.resolve();
  const results = await Promise.all([a, b, c]);
  assert.deepEqual(
    results.map((result) => result.jobs.length),
    [2, 2, 2],
  );
  assert.equal(new Set(results.flatMap((result) => result.jobs.map((job) => job.job_id))).size, 6);
  const expected = ["A", "A", "B", "B", "C", "C"];
  assert.deepEqual(
    f.jobs().map((job) => job.input.prompt),
    expected,
  );
  for (const [index, job] of f.jobs().entries())
    assert.equal(f.media.state.jobs[job.id], ["alice", "bob", "carol"][Math.floor(index / 2)]);
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const execution = await f.execute({ firstStarted, releaseFirst });
  await firstStarted.promise;
  assert.equal(execution.executed.length, 1, "a delayed provider holds its resource");
  releaseFirst.resolve();
  await execution.tick;
  assert.deepEqual(
    execution.executed.map((job) => job.prompt),
    expected,
  );
  assert.deepEqual(
    execution.executed.map((job) => job.seed),
    ["10", "11", "10", "11", "10", "11"],
  );
  assert.equal(execution.saved.length, 6);
  assert.ok(f.jobs().every((job) => job.status === "completed"));
});

for (const failureAt of [1, 2])
  test(`MCP set refusal at acknowledgement ${failureAt} releases later sets and durable execution survives first provider failure`, async (t) => {
    const entered = deferred();
    const release = deferred();
    const f = await fixture(t, async (index) => {
      if (index === 1) {
        entered.resolve();
        await release.promise;
      }
      if (index === failureAt)
        return { status: 400, payload: { error: "Fixture submission refused" } };
    });
    // Attach rejection handling before releasing the first acknowledgement.
    const first = f.media.queue("alice", args("A")).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await entered.promise;
    const next = f.media.queue("bob", args("B"));
    release.resolve();
    const [outcome, second] = await Promise.all([first, next]);
    if (failureAt === 1) assert.match(outcome.error.message, /Fixture submission refused/);
    else {
      assert.equal(outcome.value.status, "partially_queued");
      assert.equal(outcome.value.jobs.length, 1);
    }
    assert.equal(second.status, "queued");
    const expected = failureAt === 1 ? ["B", "B"] : ["A", "B", "B"];
    assert.deepEqual(
      f.jobs().map((job) => job.input.prompt),
      expected,
    );
    const execution = await f.execute({ failFirst: true });
    await execution.tick;
    assert.deepEqual(
      execution.executed.map((job) => job.prompt),
      expected,
    );
    assert.deepEqual(
      f.jobs().map((job) => job.status),
      expected.map((_, index) => (index ? "completed" : "failed")),
    );
    assert.equal(execution.saved.length, expected.length - 1);
  });

test("uncertain MCP acknowledgement retains its owned ID and releases the next complete set without resubmitting", async (t) => {
  const entered = deferred();
  const release = deferred();
  const f = await fixture(t, async (index) => {
    if (index === 1) {
      entered.resolve();
      await release.promise;
      throw new Error("Fixture connection lost");
    }
  });
  const first = f.media.queue("alice", args("A"));
  await entered.promise;
  const next = f.media.queue("bob", args("B"));
  release.resolve();
  const [uncertain, queued] = await Promise.all([first, next]);
  assert.equal(uncertain.status, "partially_queued");
  assert.equal(uncertain.jobs[0].status, "unknown");
  assert.equal(f.media.state.jobs[uncertain.jobs[0].job_id], "alice");
  assert.match(uncertain.error, /do not resubmit/);
  assert.equal(queued.jobs.length, 2);
  assert.deepEqual(
    f.requests.map(({ body }) => body.prompt),
    ["A", "B", "B"],
  );
  assert.deepEqual(
    f.jobs().map((job) => job.ownerId),
    ["bob", "bob"],
  );
});
