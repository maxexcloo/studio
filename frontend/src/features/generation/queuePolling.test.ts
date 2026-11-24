import assert from "node:assert/strict";
import test from "node:test";

import { queuePollInterval } from "./queuePolling.ts";

test("queue polling follows the nearest finish across jobs", () => {
  const queued = { status: "queued" } as const;
  const running = { status: "running" } as const;
  const steps = { steps: true, value: 3, max: 10 };
  assert.equal(queuePollInterval([{ status: "completed" }]), 3000);
  assert.equal(queuePollInterval([queued, { status: "waiting" }]), 2000);
  assert.equal(queuePollInterval([{ ...running, progress: steps }, queued]), 1500);
  assert.equal(
    queuePollInterval([{ ...running, progress: { phase: "Upscaling", value: 9, max: 10 } }]),
    1500,
  );
  assert.equal(queuePollInterval([queued, { ...running, progress: { ...steps, value: 9 } }]), 750);
  assert.equal(
    queuePollInterval([{ ...running, progress: { ...steps, value: 9, estimated: true } }]),
    1500,
  );
  assert.equal(queuePollInterval([{ ...running, progress: { phase: "Decoding" } }]), 750);
  assert.equal(queuePollInterval([{ ...running, progress: { phase: "Saving" } }]), 750);
  assert.equal(queuePollInterval([{ status: "saving" }]), 750);
});
