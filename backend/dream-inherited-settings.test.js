import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dreamInheritedSettings } from "./dream-inherited-settings.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("dreamInheritedSettings drops stored values equal to the old built-in defaults", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-inherited-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const settings = {
    enabled: true,
    paused: false,
    dailyImages: 40,
    dailyVideos: 8,
    images: true,
    videos: false,
    spicy: false,
    imageBackend: "cloud",
  };
  writeRuntimeDocument(dataDir, "dream:owner", { recent: ["a"], settings });
  writeRuntimeDocument(dataDir, "dream:fresh", { recent: [], settings: { enabled: true } });
  const plan = { accounts: 1, settings: 5 };
  assert.deepEqual(dreamInheritedSettings(dataDir), { applied: false, ...plan });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:owner").settings, settings);
  assert.deepEqual(dreamInheritedSettings(dataDir, { apply: true }), { applied: true, ...plan });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:owner"), {
    recent: ["a"],
    settings: { enabled: true, dailyVideos: 8, imageBackend: "cloud" },
  });
  assert.deepEqual(dreamInheritedSettings(dataDir, { apply: true }), {
    applied: true,
    accounts: 0,
    settings: 0,
  });
});
