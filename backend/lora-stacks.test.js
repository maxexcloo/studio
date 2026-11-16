import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loraStacks } from "./lora-stacks.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("loraStacks plans, then keeps only each account's LoRA ratings", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-stacks-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const ratings = { "fox.safetensors": "up", "ink.safetensors": "down" };
  writeRuntimeDocument(dataDir, "lora-stacks:a", {
    stacks: { flux: [{ name: "fox.safetensors", strength: 0.8 }] },
    library: { strengths: { flux: { "fox.safetensors": 0.8 } }, ratings, recents: ["x"] },
  });
  // Older documents are the stacks alone.
  writeRuntimeDocument(dataDir, "lora-stacks:b", { flux: [{ name: "fox.safetensors" }] });
  writeRuntimeDocument(dataDir, "lora-stacks:c", { library: { ratings } });
  assert.deepEqual(loraStacks(dataDir), { applied: false, accounts: 2 });
  assert.ok(readRuntimeDocument(dataDir, "lora-stacks:a").stacks);
  assert.deepEqual(loraStacks(dataDir, { apply: true }), { applied: true, accounts: 2 });
  assert.deepEqual(readRuntimeDocument(dataDir, "lora-stacks:a"), { library: { ratings } });
  assert.deepEqual(readRuntimeDocument(dataDir, "lora-stacks:b"), { library: null });
  assert.deepEqual(readRuntimeDocument(dataDir, "lora-stacks:c"), { library: { ratings } });
  assert.deepEqual(loraStacks(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
