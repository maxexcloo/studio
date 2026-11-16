import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dreamDefaultChoices } from "./dream-default-choices.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("dreamDefaultChoices saves old defaults as the choices accounts lacked, then drops them", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-default-choices-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "settings", {
    STUDIO_DREAM_ENABLED: "1",
    STUDIO_DREAM_DAILY_IMAGES: "12",
    STUDIO_DREAM_IMAGE_BACKEND: "cloud",
    STUDIO_GALLERY_CAPTIONS: "0",
  });
  writeRuntimeDocument(dataDir, "accounts", { accounts: [{ id: "a" }, { id: "b" }] });
  writeRuntimeDocument(dataDir, "dream:a", { recent: ["x"], settings: { enabled: false } });
  assert.deepEqual(dreamDefaultChoices(dataDir), { applied: false, settings: 3, accounts: 2 });
  assert.equal(readRuntimeDocument(dataDir, "dream:b"), undefined);
  assert.deepEqual(dreamDefaultChoices(dataDir, { apply: true }), {
    applied: true,
    settings: 3,
    accounts: 2,
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:a"), {
    recent: ["x"],
    settings: { enabled: false, dailyImages: 12, imageBackend: "cloud" },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:b"), {
    settings: { enabled: true, dailyImages: 12, imageBackend: "cloud" },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "settings"), { STUDIO_GALLERY_CAPTIONS: "0" });
  assert.deepEqual(dreamDefaultChoices(dataDir, { apply: true }), {
    applied: true,
    settings: 0,
    accounts: 0,
  });
});
