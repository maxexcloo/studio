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
import { spicyPrompts } from "./spicy-prompts.js";

test("spicyPrompts plans, then drops Spicy Prompts and keeps each account's Uncensored Models", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-spicy-prompts-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "preferences:a", { spicyPrompts: true, images: "cloud" });
  writeRuntimeDocument(dataDir, "preferences:b", { spicyPrompts: false, uncensoredModels: false });
  writeRuntimeDocument(dataDir, "preferences:c", { loras: false });
  assert.deepEqual(spicyPrompts(dataDir), { applied: false, accounts: 2 });
  assert.equal(readRuntimeDocument(dataDir, "preferences:a").spicyPrompts, true);
  assert.deepEqual(spicyPrompts(dataDir, { apply: true }), { applied: true, accounts: 2 });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), { images: "cloud" });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:b"), { uncensoredModels: false });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:c"), { loras: false });
  assert.deepEqual(spicyPrompts(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
