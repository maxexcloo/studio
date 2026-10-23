import assert from "node:assert/strict";
import test from "node:test";
import { generationRecord } from "./generation-record.js";

test("a run's record is read under Studio's name, or HEISS UI's for runs queued before the rename", () => {
  assert.deepEqual(generationRecord({ studio_generation: { jobId: "new" } }), { jobId: "new" });
  assert.deepEqual(generationRecord({ heiss_generation: { jobId: "old" } }), { jobId: "old" });
  assert.deepEqual(
    generationRecord({ studio_generation: { jobId: "new" }, heiss_generation: { jobId: "old" } }),
    { jobId: "new" },
  );
  assert.deepEqual(generationRecord(undefined), {});
});
