import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chatBriefRemoval } from "./chat-brief-removal.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("chatBriefRemoval plans, then moves what taste can hold and removes each chat brief", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-brief-removal-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "preferences:a", {
    loras: true,
    chatBrief: { subjects: "Portraits", profiles: ["flux", "sdxl"], loras: ["film"] },
  });
  writeRuntimeDocument(dataDir, "taste:a", {
    avoid: ["blur"],
    signals: [],
    preferences: { models: ["sdxl", "wan"] },
  });
  writeRuntimeDocument(dataDir, "preferences:b", {
    chatBrief: { loras: ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"] },
  });
  writeRuntimeDocument(dataDir, "taste:b", { preferences: { loras: ["mine"] } });
  writeRuntimeDocument(dataDir, "preferences:c", {
    chatBrief: { rules: `Keep the outfit\n\n${"x".repeat(161)}` },
  });
  writeRuntimeDocument(dataDir, "preferences:d", { cloudModels: false, chatBrief: {} });
  writeRuntimeDocument(dataDir, "preferences:e", { cloudModels: false });

  const plan = { accounts: 4, dropped: 3 };
  assert.deepEqual(chatBriefRemoval(dataDir), { applied: false, ...plan });
  assert.ok(readRuntimeDocument(dataDir, "preferences:a").chatBrief);
  assert.deepEqual(chatBriefRemoval(dataDir, { apply: true }), { applied: true, ...plan });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), { loras: true });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:a"), {
    avoid: ["blur"],
    signals: [],
    preferences: { models: ["sdxl", "wan", "flux"], loras: ["film"] },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:b").preferences.loras, [
    "mine",
    "l1",
    "l2",
    "l3",
    "l4",
    "l5",
    "l6",
    "l7",
  ]);
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:c"), {});
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:c"), {
    preferences: { rules: ["Keep the outfit"] },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:d"), { cloudModels: false });
  assert.equal(readRuntimeDocument(dataDir, "taste:d"), undefined);
  assert.deepEqual(chatBriefRemoval(dataDir, { apply: true }), {
    applied: true,
    accounts: 0,
    dropped: 0,
  });
});
