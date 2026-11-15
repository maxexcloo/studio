import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dreamAnimationStars } from "./dream-animation-stars.js";
import { writeGalleryRows } from "./persistence/gallery-rows.ts";
import {
  closeRuntimeDatabase,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

const asset = (id) => `gallery:${Buffer.from(id).toString("base64url")}`;
const photo = (id, dream, extra = {}) => ({
  id,
  jobId: `job-${id}`,
  ownerId: "n",
  type: "image",
  status: "done",
  favorite: true,
  ...(dream ? { dream } : {}),
  ...extra,
});
const video = (id, source, at, extra = {}) => ({
  id,
  ownerId: "n",
  type: "video",
  status: "done",
  settings: { referenceAssets: [{ slot: "reference", assetId: asset(source) }] },
  dream: { state: "unseen", at },
  ...extra,
});

test("dreamAnimationStars unstars only the Dream results a Dream video starred", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-animation-stars-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const kept = (decidedAt) => ({ state: "kept", decidedAt });
  const items = [
    // Unseen until Dream's video starred it, which kept it at the same moment.
    photo("unseen", kept("2026-11-14T09:00:47.725Z")),
    video("v-unseen", "unseen", "2026-11-14T09:00:47.180Z"),
    // Liked earlier, starred when Dream animated it.
    photo("liked", kept("2026-11-12T01:22:50.000Z")),
    video("v-liked", "liked", "2026-11-14T06:16:14.000Z"),
    // Starred by the person after Dream animated it.
    photo("later", kept("2026-11-14T12:00:00.000Z")),
    video("v-later", "later", "2026-11-14T12:30:00.000Z"),
    // Super Liked but never animated, an own image Dream animated, another account's video of
    // someone's result, and a video from before Dream's videos starred their source.
    photo("super", kept("2026-11-14T13:00:00.000Z")),
    photo("own", null),
    video("v-own", "own", "2026-11-14T13:00:00.000Z"),
    photo("shared", kept("2026-11-14T13:00:00.000Z")),
    video("v-shared", "shared", "2026-11-14T13:05:00.000Z", { ownerId: "max" }),
    photo("old", kept("2026-11-04T00:00:00.000Z")),
    video("v-old", "old", "2026-11-04T00:10:00.000Z"),
  ];
  writeGalleryRows(runtimeDatabase(dataDir), items);
  writeRuntimeDocument(dataDir, "taste:n", {
    signals: [
      { kind: "star", jobId: "job-later", itemId: "later", at: "2026-11-15T02:37:58.963Z" },
      // The star Dream's video gave, recorded as it queued.
      { kind: "star", jobId: "job-liked", itemId: "liked", at: "2026-11-14T06:16:14.200Z" },
    ],
  });

  const plan = dreamAnimationStars(dataDir);
  assert.equal(plan.applied, false);
  assert.equal(plan.stars, 2);
  assert.equal(plan.owners.n.keptByStar, 1);
  assert.deepEqual(plan.owners.n.examples.map((example) => example.id).sort(), ["liked", "unseen"]);

  assert.equal(dreamAnimationStars(dataDir, { apply: true }).stars, 2);
  const starred = runtimeDatabase(dataDir)
    .prepare("SELECT value FROM studio_gallery")
    .all()
    .map((row) => JSON.parse(row.value))
    .filter((item) => item.favorite)
    .map((item) => item.id)
    .sort();
  assert.deepEqual(starred, ["later", "old", "own", "shared", "super"]);
  const states = Object.fromEntries(
    runtimeDatabase(dataDir)
      .prepare("SELECT value FROM studio_gallery")
      .all()
      .map((row) => JSON.parse(row.value))
      .filter((item) => item.dream && item.type === "image")
      .map((item) => [item.id, item.dream.state]),
  );
  assert.deepEqual(states, {
    unseen: "unseen",
    liked: "kept",
    later: "kept",
    super: "kept",
    shared: "kept",
    old: "kept",
  });
  assert.equal(dreamAnimationStars(dataDir).stars, 0, "a second run finds nothing");
});
