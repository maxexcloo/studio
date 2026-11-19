import assert from "node:assert/strict";
import test from "node:test";

import type { QueueJob } from "../../types";
import { jobsInDispatchOrder, moveWaitingJobs } from "./queueOrder.ts";

const job = (
  id: string,
  status: QueueJob["status"] = "queued",
  backend = "radiance",
): QueueJob => ({
  id,
  jobId: id,
  sessionId: "session",
  operation: "image",
  status,
  reason: "",
  input: {} as QueueJob["input"],
  items: [],
  outputs: [],
  backend,
  createdAt: "",
  updatedAt: "",
});

const ids = (jobs: QueueJob[]) => jobs.map(({ id }) => id);

test("running work leads and waiting rows follow the server order across resource slots", () => {
  const cold = job("cold");
  const parallel = job("parallel", "queued", "comfy");
  const warm = job("warm");
  const active = job("active", "running");
  const writing = job("writing", "writing");
  const nextPrompt = job("next-prompt", "writing");
  const failed = job("failed", "failed");
  const saved = [cold, parallel, failed, warm, active, nextPrompt, writing];
  assert.deepEqual(ids(jobsInDispatchOrder(saved, ["warm", "parallel", "cold", "next-prompt"])), [
    "active",
    "writing",
    "warm",
    "parallel",
    "cold",
    "next-prompt",
    "failed",
  ]);
  assert.deepEqual(ids(saved), [
    "cold",
    "parallel",
    "failed",
    "warm",
    "active",
    "next-prompt",
    "writing",
  ]);
});

test("a visible drop lands after its saved destination block and preserves the moved set's order", () => {
  const first = job("first");
  const second = job("second");
  const cold = job("cold");
  const other = job("other");
  const saved = [first, cold, other, second];
  const moved = moveWaitingJobs(saved, [second, first], [cold], true);
  assert.ok(moved);
  assert.equal(moved.at, 1);
  assert.deepEqual(ids(moved.order), ["cold", "first", "second", "other"]);
});
