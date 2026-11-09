import assert from "node:assert/strict";
import test from "node:test";
import { earliest, listSchedule } from "./eta.ts";

test("waiting work goes to whichever worker frees first, in queue order", () => {
  const freeAt = new Map<string, number | null>([
    ["worker:a", 100],
    ["worker:b", 40],
  ]);
  const both = ["worker:a", "worker:b"];
  const { endsAt, freeAt: after } = listSchedule(freeAt, [
    { id: "1", resources: both, ms: 50 },
    { id: "2", resources: both, ms: 30 },
    // An explicit pick waits for its own worker.
    { id: "3", resources: ["worker:b"], ms: 10 },
  ]);
  assert.deepEqual(Object.fromEntries(endsAt), { "1": 90, "2": 120, "3": 130 });
  assert.equal(earliest(after, both), 100);
});

test("an unknown length leaves its worker's time unknown; the other still answers", () => {
  const freeAt = new Map<string, number | null>([
    ["worker:a", 0],
    ["worker:b", 20],
    ["worker:c", null],
  ]);
  const { endsAt, freeAt: after } = listSchedule(freeAt, [
    { id: "1", resources: ["worker:a"], ms: null },
    { id: "2", resources: ["worker:a", "worker:b"], ms: 10 },
    { id: "3", resources: ["worker:c"], ms: 10 },
  ]);
  assert.deepEqual(Object.fromEntries(endsAt), { "1": null, "2": 30, "3": null });
  assert.equal(earliest(after, ["worker:a", "worker:b", "worker:c"]), 30);
  assert.equal(earliest(after, ["worker:a", "worker:c"]), null);
});
