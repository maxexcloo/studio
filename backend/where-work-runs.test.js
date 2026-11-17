import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { whereWorkRuns } from "./where-work-runs.js";

test("whereWorkRuns moves Prompt Assistant picks to Text's defaults and Videos tiers to Local, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-where-work-runs-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "preferences:a", {
    videos: "cloud",
    writingModel: "cloud/uncensored",
  });
  writeRuntimeDocument(dataDir, "preferences:b", { videos: "quality", writingModel: "local/auto" });
  writeRuntimeDocument(dataDir, "preferences:c", { videos: "cloud", loras: false });
  assert.deepEqual(whereWorkRuns(dataDir), { applied: false, accounts: 2 });
  assert.deepEqual(whereWorkRuns(dataDir, { apply: true }), { applied: true, accounts: 2 });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), {
    videos: "cloud",
    text: "cloud",
    textCloud: "cloud/uncensored",
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:b"), {
    videos: "local",
    text: "local",
    textLocal: "local/auto",
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:c"), {
    videos: "cloud",
    loras: false,
  });
  assert.deepEqual(whereWorkRuns(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
