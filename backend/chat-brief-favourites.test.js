import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chatBriefFavourites } from "./chat-brief-favourites.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("chatBriefFavourites plans, then moves the brief's favourites into the person's own taste", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-brief-favourites-"));
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
  writeRuntimeDocument(dataDir, "preferences:c", { chatBrief: { rules: "Keep the outfit" } });
  writeRuntimeDocument(dataDir, "preferences:", { chatBrief: { profiles: ["flux"] } });

  assert.deepEqual(chatBriefFavourites(dataDir), { applied: false, accounts: 3, dropped: 1 });
  assert.ok(readRuntimeDocument(dataDir, "preferences:a").chatBrief.profiles);
  assert.deepEqual(chatBriefFavourites(dataDir, { apply: true }), {
    applied: true,
    accounts: 3,
    dropped: 1,
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), {
    loras: true,
    chatBrief: { subjects: "Portraits" },
  });
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
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:"), { preferences: { models: ["flux"] } });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:c"), {
    chatBrief: { rules: "Keep the outfit" },
  });
  assert.equal(readRuntimeDocument(dataDir, "taste:c"), undefined);
  assert.deepEqual(chatBriefFavourites(dataDir, { apply: true }), {
    applied: true,
    accounts: 0,
    dropped: 0,
  });
});
