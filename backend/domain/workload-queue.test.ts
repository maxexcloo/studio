import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../persistence/runtime.ts";
import { GenerationQueue, type QueueAdapter } from "./queue.ts";
import { Store } from "./store.ts";
import { workloadQueue } from "./workload-queue.ts";

function fixture() {
  const store = new Store(openDatabase(":memory:"));
  const settled: string[] = [];
  const adapter: QueueAdapter = {
    submit: async () => ({ status: "running" }),
    observe: async () => undefined,
    // Radiance can't stop accepted work; it finishes or ends with a restart.
    cancel: async () => undefined,
    saveOutputs: async () => undefined,
    settled: async (job) => {
      settled.push(`${job.id} ${job.status}`);
    },
  };
  const session = store.createSession("artist").id;
  const job = (id: string, worker: string, patch: Record<string, unknown> = {}) => {
    const queued = store.enqueue(
      "artist",
      session,
      { prompt: `Prompt ${id}` },
      "image",
      undefined,
      `worker:${worker}`,
      id,
    );
    return Object.keys(patch).length ? store.save({ ...queued, ...patch }) : queued;
  };
  const released: string[] = [];
  const leases = new Map(
    ["queued", "running", "gone", "admitting"].map((id) => [
      id,
      { release: () => released.push(id) },
    ]),
  );
  const admitting = new Set(["admitting"]);
  const ended: string[] = [];
  // The queue takes in the work already accepted when it starts.
  const work = () =>
    workloadQueue({
      queue: new GenerationQueue(store, adapter),
      leases,
      admitting,
      workloads: (item) => [String(item.backend)],
      endRun: (item, status) => ended.push(`${item.id} ${status}`),
    });
  return { store, job, work, leases, released, settled, ended };
}

test("Settings › Workers lists a workload's accepted work, drops stale leases and ends work after a forced restart", async () => {
  const { store, job, work: start, leases, released, settled, ended } = fixture();
  job("queued", "radiance");
  job("admitting", "radiance", { status: "waiting" });
  job("running", "radiance", { status: "running", providerJobId: "radiance-running" });
  job("cancelling", "radiance", { status: "running", cancelRequested: true });
  job("saving", "radiance", { status: "saving" });
  job("elsewhere", "comfyui", { status: "running" });
  const work = start();
  const load = work.load("radiance");
  assert.deepEqual(
    load.jobs.map((item) => [item.id, item.status, item.title, item.cancelling ?? false]),
    [
      ["running", "running", "Prompt running", false],
      ["cancelling", "running", "Prompt cancelling", true],
      ["saving", "saving", "Prompt saving", false],
    ],
  );
  assert.equal(load.queued, 2);
  // A lease for work not yet accepted, or for a job gone from the queue, holds nothing back.
  work.releaseStale();
  assert.deepEqual(released, ["queued", "gone"]);
  assert.deepEqual([...leases.keys()], ["running", "admitting"]);
  await work.end("radiance");
  assert.deepEqual(ended, ["running failed", "cancelling cancelled"]);
  assert.deepEqual(settled, ["running failed", "cancelling cancelled"]);
  const failed = store.job("artist", "running")!;
  assert.equal(failed.reason, "Its worker was restarted while it ran.");
  assert.equal(store.job("artist", "saving")!.status, "saving");
  assert.equal(store.job("artist", "elsewhere")!.status, "running");
});

test("Cancel Queue cancels queued work at once and asks running work to stop", async () => {
  const { store, job, work, settled } = fixture();
  job("queued", "radiance");
  job("running", "radiance", { status: "running", providerJobId: "radiance-running" });
  job("elsewhere", "comfyui");
  assert.deepEqual(await work().cancel("radiance"), { cancelled: 1, cancelling: 1 });
  assert.equal(store.job("artist", "queued")!.status, "cancelled");
  const running = store.job("artist", "running")!;
  assert.deepEqual([running.status, running.cancelRequested], ["running", true]);
  assert.equal(store.job("artist", "elsewhere")!.status, "queued");
  assert.deepEqual(settled, ["queued cancelled"]);
});
