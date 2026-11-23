import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cloudModelsPreference } from "./cloud-models-preference.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("cloudModelsPreference removes the retired Cloud Models preference, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-cloud-models-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "preferences:a", { cloudModels: false, images: "cloud" });
  writeRuntimeDocument(dataDir, "preferences:b", { loras: false });
  assert.deepEqual(cloudModelsPreference(dataDir), { applied: false, accounts: 1 });
  assert.deepEqual(cloudModelsPreference(dataDir, { apply: true }), { applied: true, accounts: 1 });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), { images: "cloud" });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:b"), { loras: false });
  assert.deepEqual(cloudModelsPreference(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
