import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dreamOwnership } from "./dream-ownership.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("Dream answers on other accounts' records are cleared once; the owner's stay", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-ownership-"));
  const mark = (state) => ({ prompt: "p", why: "", at: "2026-10-01T00:00:00Z", state });
  const item = (id, ownerId, dream) => ({
    id,
    jobId: `job-${id}`,
    ownerId,
    ...(dream ? { dream } : {}),
  });
  fs.writeFileSync(
    path.join(dataDir, "gallery.json"),
    JSON.stringify([
      item("mine", "n", mark("kept")),
      item("seen", "n"),
      item("theirs", "m", mark("discarded")),
      item("old", "m"),
    ]),
  );
  writeRuntimeDocument(dataDir, "dream:n", { recent: [], judged: ["old", "seen"] });
  const signal = (kind, id) => ({ at: "2026-10-01T00:00:00Z", kind, jobId: `job-${id}` });
  writeRuntimeDocument(dataDir, "taste:n", {
    summary: "Foxes.",
    source: "studio",
    updatedAt: "",
    signals: [signal("calibrate-like", "old"), signal("keep", "mine"), signal("star", "old")],
    since: 2,
  });

  const plan = dreamOwnership(dataDir, { owner: "n" });
  assert.deepEqual(
    [plan.marks, plan.marksByState, plan.judged, plan.signals],
    [1, { discarded: 1 }, 1, 1],
  );
  dreamOwnership(dataDir, { owner: "n", apply: true });
  const gallery = JSON.parse(fs.readFileSync(path.join(dataDir, "gallery.json"), "utf8"));
  assert.deepEqual(
    gallery.map((entry) => [entry.id, entry.dream?.state]),
    [
      ["mine", "kept"],
      ["seen", undefined],
      ["theirs", undefined],
      ["old", undefined],
    ],
  );
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:n").judged, ["seen"]);
  const taste = readRuntimeDocument(dataDir, "taste:n");
  assert.deepEqual(
    [taste.summary, taste.since, taste.signals.map((entry) => entry.kind)],
    ["Foxes.", 1, ["keep", "star"]],
  );
  const again = dreamOwnership(dataDir, { owner: "n" });
  assert.deepEqual([again.marks, again.judged, again.signals], [0, 0, 0]);
  closeRuntimeDatabase(dataDir);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
