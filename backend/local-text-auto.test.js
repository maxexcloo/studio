import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { localTextAuto } from "./local-text-auto.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("localTextAuto moves Text Local defaults from local/uncensored to local/auto, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-local-text-auto-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "preferences:a", { text: "local", textLocal: "local/uncensored" });
  writeRuntimeDocument(dataDir, "preferences:b", { textLocal: "local/qwen3.8-27b-uncensored" });
  assert.deepEqual(localTextAuto(dataDir), { applied: false, accounts: 1 });
  assert.deepEqual(localTextAuto(dataDir, { apply: true }), { applied: true, accounts: 1 });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), {
    text: "local",
    textLocal: "local/auto",
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:b"), {
    textLocal: "local/qwen3.8-27b-uncensored",
  });
  assert.deepEqual(localTextAuto(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
