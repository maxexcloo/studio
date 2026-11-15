import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { legacyShapes } from "./legacy-shapes.js";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("legacyShapes records old Dream results' arm and moves a taste summary to its note, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-legacy-shapes-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeGalleryRows(runtimeDatabase(dataDir), [
    { id: "old", dream: { prompt: "p" } },
    { id: "new", dream: { prompt: "p", arm: "explore:light" } },
    { id: "plain" },
  ]);
  writeRuntimeDocument(dataDir, "taste:alice", { signals: [], summary: "Likes fog." });
  writeRuntimeDocument(dataDir, "taste:bob", { signals: [], note: "Likes rain." });
  assert.deepEqual(legacyShapes(dataDir), { applied: false, arms: 1, notes: 1 });
  assert.deepEqual(legacyShapes(dataDir, { apply: true }), { applied: true, arms: 1, notes: 1 });
  assert.deepEqual(
    readGalleryRows(runtimeDatabase(dataDir)).sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "new", dream: { prompt: "p", arm: "explore:light" } },
      { id: "old", dream: { prompt: "p", arm: "exploit" } },
      { id: "plain" },
    ],
  );
  assert.deepEqual(readRuntimeDocument(dataDir, "taste:alice"), {
    signals: [],
    note: "Likes fog.",
  });
  assert.deepEqual(legacyShapes(dataDir, { apply: true }), { applied: true, arms: 0, notes: 0 });
});
