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
import { tasteDislikes } from "./taste-dislikes.js";

test("tasteDislikes plans, then folds Always Avoid into the person's own Dislikes", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-taste-dislikes-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const learnt = { likes: [], avoid: ["Crowds", "blur"], signals: [] };
  writeRuntimeDocument(dataDir, "taste:a", {
    ...learnt,
    preferences: {},
    addedAvoid: ["clowns", "crowds"],
  });
  writeRuntimeDocument(dataDir, "taste:b", {
    ...learnt,
    preferences: { avoid: ["fog"] },
    addedAvoid: ["clowns"],
  });
  writeRuntimeDocument(dataDir, "taste:c", { ...learnt, preferences: {}, addedAvoid: [] });
  writeRuntimeDocument(dataDir, "taste:d", { ...learnt, preferences: {} });
  assert.deepEqual(tasteDislikes(dataDir), { applied: false, accounts: 3 });
  assert.ok(readRuntimeDocument(dataDir, "taste:a").addedAvoid);
  assert.deepEqual(tasteDislikes(dataDir, { apply: true }), { applied: true, accounts: 3 });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:a"), {
    ...learnt,
    preferences: { avoid: ["clowns", "crowds", "blur"] },
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:b").preferences, {
    avoid: ["clowns", "fog"],
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:c"), { ...learnt, preferences: {} });
  assert.deepEqual(tasteDislikes(dataDir, { apply: true }), { applied: true, accounts: 0 });
});
