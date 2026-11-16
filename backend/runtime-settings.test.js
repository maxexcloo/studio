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
import { runtimeSettings } from "./runtime-settings.js";

test("runtimeSettings plans, then drops only the settings from the runtime record", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-settings-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const kept = { desired: ["radiance"], operations: [{ id: "a" }] };
  writeRuntimeDocument(dataDir, "runtime-operations", {
    ...kept,
    settings: { automatic: true, parkIdleMinutes: 15, idleWorkload: "radiance" },
  });
  assert.deepEqual(runtimeSettings(dataDir), { applied: false, settings: 1 });
  assert.deepEqual(runtimeSettings(dataDir, { apply: true }), { applied: true, settings: 1 });
  assert.deepEqual(readRuntimeDocument(dataDir, "runtime-operations"), kept);
  assert.deepEqual(runtimeSettings(dataDir, { apply: true }), { applied: true, settings: 0 });
});
