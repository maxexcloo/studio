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
import { whereWorkRunsServerWide } from "./work-defaults-migration.js";

function folder(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-where-work-runs-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  writeRuntimeDocument(dataDir, "accounts", {
    accounts: [
      { id: "admin", role: "administrator" },
      { id: "bob", role: "user" },
    ],
  });
  return dataDir;
}

test("whereWorkRunsServerWide moves the administrator's choices to Studio's and clears every account's, once", (t) => {
  const dataDir = folder(t);
  writeRuntimeDocument(dataDir, "settings", {
    STUDIO_DEFAULT_VIDEO_PROFILE: "kept-video",
    STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND: "cloud",
    STUDIO_FACE_CHECK: "0",
  });
  writeRuntimeDocument(dataDir, "preferences:admin", {
    tileCaptions: true,
    images: "cloud",
    imageCloud: "grok-image",
    imageLocal: "flux",
    videos: "local",
    videoLocal: "wan",
    imageAspect: "16:9",
    imageCount: 2,
  });
  writeRuntimeDocument(dataDir, "preferences:bob", {
    images: "local",
    imageLocal: "sdxl",
    loras: false,
  });
  writeRuntimeDocument(dataDir, "dream:admin", {
    recent: [],
    settings: { enabled: true, imageBackend: "local", videoBackend: "local", videoSeconds: 8 },
  });
  writeRuntimeDocument(dataDir, "dream:bob", { settings: { videoBackend: "cloud" } });

  const plan = whereWorkRunsServerWide(dataDir);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.settings, {
    // The override applied to everyone, so it wins over the administrator's own Dream choice.
    STUDIO_DREAM_VIDEO_BACKEND: "cloud",
    STUDIO_IMAGE_ASPECT: "16:9",
    STUDIO_IMAGE_COUNT: "2",
    STUDIO_DEFAULT_IMAGE_PROFILE: "grok-image",
    STUDIO_DREAM_IMAGE_BACKEND: "local",
    STUDIO_VIDEO_SECONDS: "8",
  });
  assert.deepEqual(plan.accounts, ["admin", "bob"]);
  assert.deepEqual(plan.dreams, ["admin", "bob"]);

  assert.equal(whereWorkRunsServerWide(dataDir, { apply: true }).applied, true);
  assert.deepEqual(readRuntimeDocument(dataDir, "settings"), {
    STUDIO_DEFAULT_VIDEO_PROFILE: "kept-video",
    STUDIO_FACE_CHECK: "0",
    ...plan.settings,
  });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:admin"), { tileCaptions: true });
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:bob"), { loras: false });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:admin"), {
    recent: [],
    settings: { enabled: true },
  });
  const again = whereWorkRunsServerWide(dataDir);
  assert.deepEqual(
    [again.settings, again.accounts, again.dreams, again.retiredOverrides],
    [{}, [], [], []],
  );
});

test("whereWorkRunsServerWide applies nothing when administrators chose differently", (t) => {
  const dataDir = folder(t);
  writeRuntimeDocument(dataDir, "accounts", {
    accounts: [
      { id: "admin", role: "administrator" },
      { id: "second", role: "administrator" },
    ],
  });
  writeRuntimeDocument(dataDir, "preferences:admin", { imageAspect: "16:9" });
  writeRuntimeDocument(dataDir, "preferences:second", { imageAspect: "1:1" });
  const result = whereWorkRunsServerWide(dataDir, { apply: true });
  assert.equal(result.applied, false);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:second"), { imageAspect: "1:1" });
});
