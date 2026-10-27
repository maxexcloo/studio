import assert from "node:assert/strict";
import test from "node:test";
import { generationRecord } from "./generation-record.js";

test("a run's record is read from Studio's extra data", () => {
  assert.deepEqual(generationRecord({ studio_generation: { jobId: "new" } }), { jobId: "new" });
  assert.deepEqual(generationRecord(undefined), {});
});
