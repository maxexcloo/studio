import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { comparisonSets } from "./comparison-sets.js";
import { closeRuntimeDatabase, writeRuntimeDocument } from "./persistence/runtime.ts";

test("comparisonSets makes old compare runs result sets, leaving chosen images and set results", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-comparison-sets-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const record = (id, jobIds, extra = {}) => ({ id, ownerId: "", jobIds, vote: null, ...extra });
  writeRuntimeDocument(dataDir, "comparisons", [
    record("run", ["a", "b"], { labels: ["Flux", "Qwen"] }),
    record("legacy", ["c", "d"]),
    record("selected", ["a", "b"], { itemIds: ["a-0", "b-0"] }),
    record("mcp", ["e", "f"]),
  ]);
  let items = [
    { id: "a-0", jobId: "a" },
    { id: "b-0", jobId: "b" },
    { id: "c-0", jobId: "c" },
    { id: "e-0", jobId: "e", resultSet: { id: "call", title: "Foxes", index: 0 } },
    { id: "f-0", jobId: "f", resultSet: { id: "call", title: "Foxes", index: 0 } },
  ];
  const gallery = {
    items: () => items,
    update: (jobId, patch) =>
      (items = items.map((item) => (item.jobId === jobId ? { ...item, ...patch } : item))),
  };

  assert.ok(comparisonSets(dataDir).skipped, "offline skips");
  const plan = comparisonSets(dataDir, { gallery });
  assert.deepEqual(
    { comparisons: plan.comparisons, items: plan.items, applied: plan.applied },
    { comparisons: 2, items: 3, applied: false },
  );
  assert.equal(comparisonSets(dataDir, { apply: true, gallery }).applied, true);
  assert.deepEqual(
    items.map((item) => item.resultSet),
    [
      { id: "run", title: "Comparison", index: 0, variation: "Flux" },
      { id: "run", title: "Comparison", index: 1, variation: "Qwen" },
      { id: "legacy", title: "Comparison", index: 0, variation: "Variant A" },
      { id: "call", title: "Foxes", index: 0 },
      { id: "call", title: "Foxes", index: 0 },
    ],
  );
  assert.equal(comparisonSets(dataDir, { gallery }).items, 0, "a second run finds nothing");
});
