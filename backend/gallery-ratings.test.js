import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { galleryRatings } from "./gallery-ratings.js";
import { readGalleryRows, writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("galleryRatings turns stars into likes and Dream discards into dislikes, once", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-ratings-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const discard = { state: "discarded", prompt: "p" };
  writeGalleryRows(runtimeDatabase(dataDir), [
    { id: "starred", favorite: true },
    { id: "unstarred", favorite: false },
    { id: "discard", dream: discard },
    { id: "plain" },
  ]);
  writeRuntimeDocument(dataDir, "taste:alice", {
    signals: [{ kind: "star" }, { kind: "unstar" }, { kind: "keep" }],
  });
  const plan = { likes: 1, unstarred: 1, dislikes: 1, signals: 2 };
  assert.deepEqual(galleryRatings(dataDir), { applied: false, ...plan });
  assert.deepEqual(galleryRatings(dataDir, { apply: true }), { applied: true, ...plan });
  assert.deepEqual(
    readGalleryRows(runtimeDatabase(dataDir)).sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "discard", dream: discard, rating: "disliked" },
      { id: "plain" },
      { id: "starred", rating: "liked" },
      { id: "unstarred" },
    ],
  );
  assert.deepEqual(
    readRuntimeDocument(dataDir, "taste:alice").signals.map((signal) => signal.kind),
    ["like", "unlike", "keep"],
  );
  assert.deepEqual(galleryRatings(dataDir), {
    applied: false,
    likes: 0,
    unstarred: 0,
    dislikes: 0,
    signals: 0,
  });
});
